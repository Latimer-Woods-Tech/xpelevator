/**
 * verify-latency-summary.mjs — R-067 post-deploy proof that the response-speed
 * read surface (`GET /api/analytics/latency`) is live, authenticated, and reads
 * the persisted per-turn telemetry (R-066) against the freshly-promoted LWT build.
 *
 * Two things this asserts end-to-end:
 *   1. anon `GET /api/analytics/latency` → 401 (Phase-2 read-auth holds on the
 *      new route — no un-authenticated read of tenant timing).
 *   2. after driving ONE real authenticated chat turn (which persists a CUSTOMER
 *      reply row with telemetry), the authenticated summary → 200 with a numeric
 *      `avgTtftMs` / `p95TtftMs`, `measuredTurns >= 1`, and a non-empty `byModel`
 *      — proving the aggregation reads the stored rows, not an empty shell.
 *
 * Runs in the deploy job AFTER promotion (BASE = the pages.dev alias), so the new
 * build is guaranteed live. Seeds a throwaway self-owned (org-less) user + session
 * and cleans everything up in a finally block. Env: BASE_URL, DATABASE_URL,
 * AUTH_SECRET. Auth: mints a valid Auth.js v5 JWT session cookie from the staged
 * AUTH_SECRET, exactly as scripts/verify-turn-telemetry.mjs does.
 */
import { neon } from '@neondatabase/serverless';
import { encode } from 'next-auth/jwt';

const BASE = (process.env.BASE_URL || '').replace(/\/$/, '');
const AUTH_SECRET = process.env.AUTH_SECRET?.replace(/\r/g, '');
const DB = process.env.DATABASE_URL?.replace(/\r/g, '');
if (!BASE || !AUTH_SECRET || !DB) {
  console.error('Missing BASE_URL / AUTH_SECRET / DATABASE_URL');
  process.exit(1);
}
const sql = neon(DB);
const TAG = `r067-latency-${Date.now()}`;
const EMAIL = `${TAG}@xpelevator.internal`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fail = (msg, extra) => {
  console.error(`\n✗ LATENCY-SUMMARY CHECK FAILED: ${msg}`);
  if (extra !== undefined) console.error(extra);
  process.exitCode = 1;
};

async function drain(res) {
  try { return await res.text(); } catch { return ''; }
}

async function mintCookieHeader(userId) {
  const token = { name: 'R067 Latency', email: EMAIL, sub: userId, id: userId };
  const maxAge = 30 * 24 * 60 * 60;
  const parts = [];
  for (const salt of ['__Secure-authjs.session-token', 'authjs.session-token']) {
    parts.push(`${salt}=${await encode({ token, secret: AUTH_SECRET, salt, maxAge })}`);
  }
  return parts.join('; ');
}

async function req(method, path, cookie, body) {
  const headers = cookie ? { cookie } : {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  return fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function main() {
  console.log(`=== R-067 latency read-surface check → ${BASE} ===\n`);

  // 1) anon must be rejected — the route is a tenant-scoped read.
  const anon = await req('GET', '/api/analytics/latency');
  if (anon.status !== 401) {
    fail(`anon GET /api/analytics/latency expected 401, got ${anon.status}`, await drain(anon));
  } else {
    console.log('✓ anon GET /api/analytics/latency → 401');
  }

  const scenarios = await sql`
    SELECT id, job_title_id AS "jobTitleId" FROM scenarios ORDER BY created_at LIMIT 1
  `;
  if (scenarios.length === 0) throw new Error('no scenarios in DB to drive a turn against');
  const scenario = scenarios[0];

  let userId;
  let sessionId;
  try {
    const [user] = await sql`
      INSERT INTO users (id, email, name, role, created_at)
      VALUES (gen_random_uuid(), ${EMAIL}, 'R067 Latency', 'MEMBER', NOW())
      ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
      RETURNING id`;
    userId = user.id;
    const cookie = await mintCookieHeader(userId);

    const sess = await req('GET', '/api/auth/session', cookie);
    const sessTxt = await drain(sess);
    if (sess.status !== 200 || !sessTxt.includes(EMAIL)) {
      throw new Error(`minted cookie did not authenticate (HTTP ${sess.status})`);
    }

    // Create a CHAT session, fire one [START] turn → a CUSTOMER reply row with
    // persisted telemetry, which the summary must then read back.
    const createRes = await req('POST', '/api/simulations', cookie, {
      jobTitleId: scenario.jobTitleId,
      scenarioId: scenario.id,
      type: 'CHAT',
    });
    const createTxt = await drain(createRes);
    if (createRes.status !== 201) throw new Error(`POST /api/simulations -> ${createRes.status}: ${createTxt.slice(0, 200)}`);
    sessionId = JSON.parse(createTxt).id;
    console.log(`✓ session created: ${sessionId}`);

    let started = false;
    for (let attempt = 1; attempt <= 5 && !started; attempt++) {
      const startRes = await req('POST', '/api/chat', cookie, { sessionId, content: '[START]' });
      const startTxt = await drain(startRes);
      if (startRes.status === 200 && /"timing"/.test(startTxt)) {
        started = true;
        break;
      }
      console.log(`  [START] attempt ${attempt}: HTTP ${startRes.status}, no timing yet — retrying...`);
      await sleep(3000);
    }
    if (!started) throw new Error('chat [START] never produced an instrumented turn');
    console.log('✓ one live customer turn streamed');

    // Read the authenticated summary; retry — the reply INSERT lands as the SSE
    // stream closes, so the very first read can race ahead of the row.
    let summary;
    for (let i = 1; i <= 5; i++) {
      const res = await req('GET', '/api/analytics/latency', cookie);
      const txt = await drain(res);
      if (res.status !== 200) {
        console.log(`  summary attempt ${i}: HTTP ${res.status} — retrying...`);
        await sleep(2000);
        continue;
      }
      const body = JSON.parse(txt);
      if (typeof body.measuredTurns === 'number' && body.measuredTurns >= 1) {
        summary = body;
        break;
      }
      console.log(`  summary attempt ${i}: measuredTurns=${body.measuredTurns} — retrying...`);
      await sleep(2000);
    }
    if (!summary) throw new Error('authenticated latency summary never reported a measured turn');

    console.log('Summary:', JSON.stringify({
      measuredTurns: summary.measuredTurns,
      avgTtftMs: summary.avgTtftMs,
      p95TtftMs: summary.p95TtftMs,
      slowPct: summary.slowPct,
      models: summary.byModel?.length,
    }));

    if (typeof summary.avgTtftMs !== 'number') fail('avgTtftMs is null / not a number', summary.avgTtftMs);
    else console.log(`  ✓ avgTtftMs = ${summary.avgTtftMs}`);
    if (typeof summary.p95TtftMs !== 'number') fail('p95TtftMs is null / not a number', summary.p95TtftMs);
    else console.log(`  ✓ p95TtftMs = ${summary.p95TtftMs}`);
    if (!Array.isArray(summary.byModel) || summary.byModel.length === 0) fail('byModel is empty', summary.byModel);
    else console.log(`  ✓ byModel has ${summary.byModel.length} group(s), top = ${summary.byModel[0].key}`);
    if (!summary.tierBreakdown || typeof summary.tierBreakdown.realtime !== 'number') {
      fail('tierBreakdown missing / malformed', summary.tierBreakdown);
    } else {
      console.log(`  ✓ tierBreakdown = ${JSON.stringify(summary.tierBreakdown)}`);
    }
  } finally {
    if (sessionId) {
      await sql`DELETE FROM scores WHERE session_id = ${sessionId}`;
      await sql`DELETE FROM chat_messages WHERE session_id = ${sessionId}`;
      await sql`DELETE FROM simulation_sessions WHERE id = ${sessionId}`;
    }
    if (userId) await sql`DELETE FROM users WHERE id = ${userId}`;
    console.log('\n(cleaned up seeded user/session/messages)');
  }

  if (process.exitCode === 1) {
    console.error('\n✗ the latency read surface did not behave as expected.');
    return;
  }
  console.log('\n✅ R-067 VERIFIED — anon 401 + authenticated summary reads persisted turn telemetry (avg/p95/byModel).');
}

main().catch((e) => {
  console.error('\n✗ unexpected error:', e?.stack || String(e));
  process.exit(1);
});
