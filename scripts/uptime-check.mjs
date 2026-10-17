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
import {
  MAX_REALISM_STREAM_ATTEMPTS,
  isTransientEmptyStream,
  evaluateRealismStreamProbe,
} from './lib/stream-probe-eval.mjs';

const BRANDED = 'https://xpelevator.com';
const ALIAS = 'https://xpelevator-sim.pages.dev';
const GROQ_KEY = process.env.GROQ_API_KEY?.replace(/\r/g, '').trim();

// The exact Groq model ids the app calls on the scoring + live-turn hot paths
// (mirror of CUSTOMER_MODEL_REALISM / CUSTOMER_MODEL_FAST in src/lib/ai.ts). A
// valid key that lists /v1/models is NOT enough — the models themselves can be
// decommissioned out from under the app while the key still authenticates, which
// is exactly what happened on ~2026-08-17 (#248): `llama-3.3-70b-versatile` +
// `llama-3.1-8b-instant` were removed, every scoring completion 400'd, scores went
// null, and this monitor stayed green because it only checked the key. We now
// assert BOTH ids are still present in the model list, so a future decommission
// opens an alert in ≤15 min instead of silently nulling scores. Keep in sync with
// src/lib/ai.ts when the tiers change.
const REQUIRED_GROQ_MODELS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'];

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
    return; // no model list to inspect if the credential itself was rejected
  }

  // Credential is live — now verify the models the app ACTUALLY calls are still
  // offered. A decommissioned model (the #248 outage) leaves the key valid and
  // this endpoint 200, but drops the model from the list, so every scoring
  // completion 400s and scores go null while the check above stays green.
  let ids = [];
  try {
    const parsed = JSON.parse(body);
    ids = Array.isArray(parsed?.data)
      ? parsed.data.map((m) => m?.id).filter((s) => typeof s === 'string')
      : [];
  } catch {
    ids = [];
  }
  const missing = REQUIRED_GROQ_MODELS.filter((m) => !ids.includes(m));
  const modelsOk = missing.length === 0;
  log(
    `${modelsOk ? '✓' : '✗'} Groq models present [${REQUIRED_GROQ_MODELS.join(', ')}] -> ` +
      `${modelsOk ? 'ALL LIVE' : `MISSING: ${missing.join(', ')}`}`,
  );
  if (!modelsOk) {
    failures.push(
      `**Scoring model DECOMMISSIONED** — the Groq model(s) the app calls are no longer ` +
        `offered by \`/v1/models\`: \`${missing.join('`, `')}\`. The \`GROQ_API_KEY\` is VALID ` +
        `(the check above passed), but every chat/scoring completion against a decommissioned ` +
        `model 400s — the customer turn falls back to a canned line and sessions score NULL. ` +
        `This is the 2026-08-17 #248 failure mode. Fix: update the model ids in \`src/lib/ai.ts\` ` +
        `(and \`REQUIRED_GROQ_MODELS\` here) to Groq's current replacements ` +
        `(console.groq.com/docs/deprecations).`,
    );
  }
}

// Probe ONE model with a live STREAMING completion that mirrors the app's exact
// request (src/lib/ai.ts streamResponse → groq-fetch openStream): stream + the
// include_usage option. Returns what arrived so the caller can classify.
async function probeGroqStream(model) {
  let status = 0;
  let errBody = '';
  let content = '';
  let usageTop = false;
  let usageXGroq = false;
  let terminalKeys = '';
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You are a terse customer. Reply in one short sentence.' },
          { role: 'user', content: 'Hello, I need help with my order.' },
        ],
        temperature: 0.75,
        max_tokens: 400,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    status = res.status;
    if (res.status !== 200 || !res.body) {
      try { errBody = await res.text(); } catch { /* ignore */ }
    } else {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]' || !data) continue;
          let p;
          try { p = JSON.parse(data); } catch { continue; }
          const c = p.choices?.[0]?.delta?.content;
          if (typeof c === 'string') content += c;
          if (p.usage && typeof p.usage.total_tokens === 'number') usageTop = true;
          if (p.x_groq?.usage && typeof p.x_groq.usage.total_tokens === 'number') usageXGroq = true;
          if (!c && (Array.isArray(p.choices) ? p.choices.length === 0 : true)) {
            terminalKeys = Object.keys(p).join(',');
          }
        }
      }
    }
  } catch (e) {
    errBody = String(e?.message || e);
  }
  const contentOk = content.trim().length > 0;
  const usageOk = usageTop || usageXGroq;
  log(
    `${status === 200 && contentOk ? '✓' : '✗'} Groq streaming completion [${model}] -> HTTP ${status}; ` +
      `content=${contentOk ? `${content.length}b` : 'NONE'}; usage: top=${usageTop} x_groq=${usageXGroq}` +
      (terminalKeys ? `; terminal-chunk keys=[${terminalKeys}]` : '') +
      (errBody ? `; err=${errBody.slice(0, 200)}` : ''),
  );
  return { status, errBody, contentOk, usageOk, terminalKeys };
}

// The gap /v1/models cannot see: a model id can be LISTED yet fail an actual
// `/chat/completions` call (org-level block, bad param, decommission-in-progress).
// That is exactly how `openai/gpt-oss-20b` (the fast tier) went dark — HTTP 403
// "blocked at the organization level" — while the credential stayed valid and the
// id stayed in /v1/models, so this monitor and scoring both looked green while
// every easy/medium live turn threw and served the canned CUSTOMER_TURN_FALLBACK
// with NO token usage (R-132 / #155). (Fixed in the app by #301's fallback ladder.)
//
// What the app actually requires: the REALISM model (gpt-oss-120b) must answer —
// it is the scoring model AND the fast tier's fallback target (model-fallback.ts),
// so if it works, every tier can produce a real turn (fast degrades UP to it). We
// therefore HARD-FAIL only when realism is down (a true core-loop outage), and
// WARN — without failing — when the fast model is blocked but realism carries it,
// because #301's fallback ladder turns that into a graceful cost-tier degradation,
// not an outage. Hard-failing on the still-org-blocked fast model would leave this
// monitor permanently red (alert fatigue that masks the next real failure). The
// warning still surfaces the block so the founder can re-enable the cheaper model
// (console.groq.com/settings/limits).
async function checkGroqCompletion() {
  if (!GROQ_KEY) return; // credential check already recorded the missing key
  const REALISM = 'openai/gpt-oss-120b'; // scoring + fast-tier fallback floor
  const FAST = 'openai/gpt-oss-20b'; // CUSTOMER_MODEL_FAST — the cheap live-turn tier

  // Reopen the realism stream on a TRANSIENT empty-200 flap, bounded to mirror
  // production's `GroqFetchClient.MAX_STREAM_ATTEMPTS` (src/lib/groq-fetch.ts). A
  // single empty-200 self-recovers on the next attempt (#304, #315) and the live
  // turn path already retries it, so paging on the first blip is alert fatigue.
  // Only the empty-200 class is reopened; a non-200 (auth/org-block/5xx/transport)
  // is a hard failure production does not absorb, so it is decided immediately.
  const realismAttempts = [];
  for (let attempt = 1; attempt <= MAX_REALISM_STREAM_ATTEMPTS; attempt++) {
    const r = await probeGroqStream(REALISM);
    realismAttempts.push(r);
    if (!isTransientEmptyStream(r)) break; // streamed content OR hard non-200 → decided
    if (attempt < MAX_REALISM_STREAM_ATTEMPTS) {
      log(
        `⚠️  realism empty-200 stream [${REALISM}] (transient #304/#315 flap) — reopening ` +
          `(attempt ${attempt + 1}/${MAX_REALISM_STREAM_ATTEMPTS}), mirroring production MAX_STREAM_ATTEMPTS`,
      );
    }
  }
  const verdict = evaluateRealismStreamProbe(realismAttempts);
  const realism = verdict.final;
  if (verdict.down) {
    failures.push(
      `**Live customer-turn generation DOWN** — the Groq STREAMING \`/chat/completions\` call for the ` +
        `scoring + fallback-floor model \`${REALISM}\` returned HTTP ${realism.status}` +
        `${realism.contentOk ? '' : ' with NO streamed content'}` +
        ` on ${verdict.attempts} attempt(s) (reopened to mirror production's empty-stream retry — this is ` +
        `a SUSTAINED failure, not a single transient flap). Every live turn throws and serves the ` +
        `canned \`CUSTOMER_TURN_FALLBACK\` with NO token usage (R-132 / #155), and sessions can no longer ` +
        `degrade to a working model. /v1/models cannot see this (the id is listed; the completion fails).` +
        (realism.errBody ? `\n\n\`\`\`\n${realism.errBody.slice(0, 400)}\n\`\`\`` : ''),
    );
  } else if (verdict.usageMissing) {
    failures.push(
      `**Groq streaming usage missing** — \`${REALISM}\` streamed content but emitted NO token usage at ` +
        `top-level \`usage\` or \`x_groq.usage\` (terminal keys: [${realism.terminalKeys || 'none seen'}]). ` +
        `Per-turn spend (R-132 / #155) cannot be recorded; Groq may have moved the usage block.`,
    );
  }

  // Fast tier: informational. A block here is absorbed by the fallback ladder
  // (degrades to realism), so it is a cost-tier warning, NOT a monitor failure —
  // UNLESS realism is also down, already failed above.
  const fast = await probeGroqStream(FAST);
  if ((fast.status !== 200 || !fast.contentOk) && realism.status === 200 && realism.contentOk) {
    log(
      `⚠️  fast tier degraded — \`${FAST}\` returned HTTP ${fast.status} (likely org-blocked at ` +
        `console.groq.com/settings/limits). The app's model-fallback ladder degrades these turns UP to ` +
        `\`${REALISM}\` (real reply + usage preserved), so this is a COST impact (every easy/medium turn ` +
        `uses the pricier model), not an outage. Re-enable \`${FAST}\` to restore the cheap tier.` +
        (fast.errBody ? ` err=${fast.errBody.slice(0, 160)}` : ''),
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
  await checkGroqCompletion();

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
