/**
 * uptime-check.mjs — lightweight, dependency-free uptime + scoring-credential probe.
 *
 * Runs on the GitHub Actions runner (the sandbox egress to the branded domain is
 * policy-blocked, so all live verification runs runner-side, per the repo's
 * staged-secrets pattern). Intended to be scheduled frequently — it makes NO DB
 * writes and needs no npm install (uses Node's global fetch).
 *
 * Asserts four things, each mapped to a real failure mode:
 *   1. GET https://xpelevator.com/api/health   -> 200 + { ok: true }   (app is up)
 *   2. GET https://xpelevator-sim.pages.dev/api/health -> 200           (alias is up)
 *   3. GET /api/branding/<nonexistent-slug> -> 404 on both hosts        (DB read path is up)
 *      This is the early-warning for the DB-DOWN failure mode that health can't
 *      see: on 2026-07-14 a driver swap (#78) made EVERY DB read 500 while
 *      /api/health stayed 200 (health touches no DB) and the Groq credential
 *      stayed valid — so this monitor went green and the outage was SILENT until
 *      the 6-hourly scoring canary. `/api/branding/[slug]` is a PUBLIC single-
 *      query route: a valid-but-nonexistent slug runs a real `SELECT` and returns
 *      404 (query ran, no row) when the DB path is healthy, or 500 when the driver
 *      /connection fails. A cheap, auth-free canary for exactly that class.
 *   4. GET https://api.groq.com/openai/v1/models with GROQ_API_KEY -> 200
 *      This is the CHEAP early-warning for live-issue #1: the original outage was
 *      an EXPIRED Groq key that made every session score null. /api/health only
 *      checks that the env var is PRESENT, not that it still authenticates — so
 *      we probe the credential directly here every cycle.
 *   5. POST /api/telnyx/webhook (valid JSON, NO signature) -> 401 on both hosts
 *      The PHONE-modality reachability + fail-closed canary. The scoring canary
 *      (check above) only drives the CHAT path, so the entire phone webhook was
 *      unmonitored — on 2026-07-19 (#125) the signature verifier read the signing
 *      key from `process.env` (undefined in the deployed Worker) and fail-closed
 *      EVERY Telnyx webhook, taking phone dark, and nothing caught it. This probe
 *      closes part of that blind spot from the outside:
 *        401 → the route is deployed + reachable and its own signature verifier
 *              ran and rejected an unsigned body (fail-closed working). HEALTHY.
 *        200 → a fail-OPEN regression: the verifier accepted an UNSIGNED webhook.
 *              Anyone could then forge call events — a security alert, not a warn.
 *        404 → the webhook route was dropped from the deploy (routing regression).
 *        500 → the route threw before verifying (a module-import/init crash).
 *        000 → the host was unreachable / timed out.
 *      Limit (honest): a valid Telnyx signature needs Telnyx's PRIVATE key, which
 *      we don't hold, so no black-box probe can positively prove a signed webhook
 *      still verifies (the exact #125 always-401 key bug is indistinguishable from
 *      a healthy fail-closed here). That runtime-binding key resolution is covered
 *      by the auth-api unit tests instead; this probe guards reachability + the
 *      fail-open direction, both of which were previously unmonitored.
 *
 * On any failure it writes a human-readable reason to ./monitor-failure.md (the
 * workflow's alert step reads it) and exits non-zero.
 *
 * Env: GROQ_API_KEY (required for check 3).
 */
import { writeFileSync } from 'node:fs';

const BRANDED = 'https://xpelevator.com';
const ALIAS = 'https://xpelevator-sim.pages.dev';
const GROQ_KEY = process.env.GROQ_API_KEY?.replace(/\r/g, '').trim();

// A slug no real org can hold: slugify() (src/lib/org-hierarchy.ts) only ever
// produces [a-z0-9-], so a value with underscores can never match an existing
// row. GET /api/branding/[slug] runs a real `SELECT ... WHERE slug = $1`, so this
// value guarantees a 0-row result — i.e. a 404 when the DB read path is healthy.
const DB_CANARY_SLUG = '__uptime_db_canary_nonexistent__';

const failures = [];
const log = (m) => console.log(m);

// One fetch with a hard timeout + a small retry, returning { status, body }.
async function probe(url, opts = {}, attempts = 3) {
  let last = { status: 0, body: '' };
  for (let i = 1; i <= attempts; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch(url, { ...opts, signal: ctrl.signal });
      clearTimeout(t);
      let body = '';
      try { body = await res.text(); } catch { /* ignore */ }
      last = { status: res.status, body };
      if (res.status >= 200 && res.status < 500) return last; // 5xx is retryable
    } catch (e) {
      last = { status: 0, body: String(e?.message || e) };
    }
    if (i < attempts) await new Promise((r) => setTimeout(r, 5000));
  }
  return last;
}

async function checkHealth(base, { requireOk }) {
  const url = `${base}/api/health`;
  const { status, body } = await probe(url);
  let json = {};
  try { json = JSON.parse(body); } catch { /* non-JSON */ }
  const ok = status === 200 && (!requireOk || json?.ok === true);
  log(`${ok ? '✓' : '✗'} GET ${url} -> HTTP ${status} ${body.slice(0, 120)}`);
  if (!ok) {
    failures.push(
      `**${url}** returned HTTP ${status}` +
        (requireOk ? ` (expected 200 with \`ok:true\`)` : ` (expected 200)`) +
        `\n\n\`\`\`\n${body.slice(0, 300)}\n\`\`\``,
    );
  }
}

// Public DB-read canary. 404 = the branding query ran and found no row => the
// DB read path completed. Any other code is a failure with a targeted hint:
//   500 → the query threw: DB driver/connection down at runtime (the #78 mode).
//   401 → the /api/branding public-route prefix regressed in middleware.
//   0   → the host was unreachable / timed out.
async function checkDbRead(base) {
  const url = `${base}/api/branding/${DB_CANARY_SLUG}`;
  const { status, body } = await probe(url);
  const ok = status === 404;
  log(`${ok ? '✓' : '✗'} GET ${url} -> HTTP ${status} (DB read path ${ok ? 'HEALTHY' : 'UNHEALTHY'})`);
  if (!ok) {
    const hint =
      status === 500
        ? ' A 500 means the public branding query threw — the DB driver/connection is failing at runtime. This is the 2026-07-14 #78 failure mode: every DB read 500s while `/api/health` stays 200.'
        : status === 401
          ? ' A 401 means the `/api/branding` public-route prefix regressed in `middleware.ts`.'
          : status === 0
            ? ' The host was unreachable or the request timed out.'
            : '';
    failures.push(
      `**DB read path DOWN** — public branding canary \`GET ${url}\` returned HTTP ${status} (expected 404).` +
        hint +
        `\n\n\`\`\`\n${body.slice(0, 300)}\n\`\`\``,
    );
  }
}

// Phone-modality webhook reachability + fail-closed canary. POSTs a well-formed
// JSON body with NO Telnyx signature headers. The route parses JSON first (400
// only on malformed JSON), then runs its own Ed25519 signature verification and
// returns 401 when the signature is absent — BEFORE any event processing, so this
// probe triggers no DB writes, no Groq calls, and no Telnyx API calls. The
// webhook is a middleware-public route (PUBLIC_EXACT_ROUTES), so the 401 comes
// from the route's OWN verifier, not from NextAuth — which is what makes 200 a
// meaningful fail-open signal rather than a middleware artifact.
async function checkWebhookReachability(base) {
  const url = `${base}/api/telnyx/webhook`;
  const { status, body } = await probe(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Valid JSON so we pass the route's 400 (bad-JSON) gate and reach the
    // signature verifier; no telnyx-signature-ed25519 / telnyx-timestamp headers.
    body: JSON.stringify({ data: { event_type: '__uptime_reachability_canary__' } }),
  });
  const ok = status === 401;
  log(`${ok ? '✓' : '✗'} POST ${url} -> HTTP ${status} (phone webhook ${ok ? 'REACHABLE + fail-closed' : 'UNHEALTHY'})`);
  if (!ok) {
    const hint =
      status === 200
        ? ' A 200 means the verifier ACCEPTED an unsigned webhook — a fail-OPEN regression. Forged Telnyx call events would be processed. Treat as a security incident.'
        : status === 404
          ? ' A 404 means the /api/telnyx/webhook route was dropped from the deploy — the phone modality is dark (no webhook to drive calls).'
          : status === 500
            ? ' A 500 means the route threw before verifying — a module-import/init crash in the webhook path (the phone modality is dark).'
            : status === 0
              ? ' The host was unreachable or the request timed out.'
              : ` Expected 401 (fail-closed rejection of the unsigned probe); got ${status}.`;
    failures.push(
      `**Phone webhook UNHEALTHY** — \`POST ${url}\` (unsigned) returned HTTP ${status} (expected 401).` +
        hint +
        `\n\n\`\`\`\n${body.slice(0, 300)}\n\`\`\``,
    );
  }
}

async function checkGroqCredential() {
  if (!GROQ_KEY) {
    log('✗ GROQ_API_KEY not present in env — cannot probe scoring credential');
    failures.push('**Groq credential** — `GROQ_API_KEY` is not set in the monitor env; cannot verify the scoring engine credential.');
    return;
  }
  const { status, body } = await probe('https://api.groq.com/openai/v1/models', {
    headers: { Authorization: `Bearer ${GROQ_KEY}` },
  });
  const ok = status === 200;
  log(`${ok ? '✓' : '✗'} Groq /v1/models -> HTTP ${status} (scoring credential ${ok ? 'LIVE' : 'REJECTED'})`);
  if (!ok) {
    failures.push(
      `**Scoring credential DOWN** — Groq \`/v1/models\` returned HTTP ${status}. ` +
        `This is the live-issue #1 failure mode (an expired/invalid \`GROQ_API_KEY\` ` +
        `makes every session score null). \`/api/health\` will still be 200 because it ` +
        `only checks the var is present, not that it authenticates.` +
        `\n\n\`\`\`\n${body.slice(0, 300)}\n\`\`\``,
    );
  }
}

async function main() {
  log(`=== xpelevator uptime + scoring-credential probe ===\n`);
  await checkHealth(BRANDED, { requireOk: true });
  await checkHealth(ALIAS, { requireOk: false });
  await checkDbRead(BRANDED);
  await checkDbRead(ALIAS);
  await checkWebhookReachability(BRANDED);
  await checkWebhookReachability(ALIAS);
  await checkGroqCredential();

  if (failures.length > 0) {
    const report =
      `### 🔴 Uptime / scoring-credential check failed\n\n` +
      failures.map((f) => `- ${f}`).join('\n\n');
    writeFileSync('monitor-failure.md', report);
    console.error(`\n✗ ${failures.length} check(s) failed — see monitor-failure.md`);
    process.exit(1);
  }
  log('\n✅ All uptime + scoring-credential checks passed.');
}

main().catch((e) => {
  writeFileSync('monitor-failure.md', `### 🔴 Uptime monitor crashed\n\n\`\`\`\n${e?.stack || String(e)}\n\`\`\``);
  console.error('unexpected error', e);
  process.exit(1);
});
