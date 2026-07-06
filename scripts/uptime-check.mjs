/**
 * uptime-check.mjs — lightweight, dependency-free uptime + scoring-credential probe.
 *
 * Runs on the GitHub Actions runner (the sandbox egress to the branded domain is
 * policy-blocked, so all live verification runs runner-side, per the repo's
 * staged-secrets pattern). Intended to be scheduled frequently — it makes NO DB
 * writes and needs no npm install (uses Node's global fetch).
 *
 * Asserts three things, each mapped to a real failure mode:
 *   1. GET https://xpelevator.com/api/health   -> 200 + { ok: true }   (app is up)
 *   2. GET https://xpelevator-sim.pages.dev/api/health -> 200           (alias is up)
 *   3. GET https://api.groq.com/openai/v1/models with GROQ_API_KEY -> 200
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
