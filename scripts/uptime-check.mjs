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
