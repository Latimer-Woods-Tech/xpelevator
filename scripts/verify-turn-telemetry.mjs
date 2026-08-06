/**
 * verify-turn-telemetry.mjs — R-066 post-deploy proof that per-turn latency
 * telemetry is PERSISTED, end-to-end, against the freshly-promoted LWT build.
 *
 * R-057/R-058 measure a turn's latency (log line) and R-060 shows it live in the
 * chat header, but until R-066 nothing stored it — so there was no historical
 * record to tune the founder-flagged "half-speed" feel against. This drives ONE
 * real authenticated chat turn on the live deploy and asserts the CUSTOMER reply
 * row carries non-null `ttft_ms` / `total_ms` / `latency_tier` / `model` /
 * `route_reason` — proving both the migration applied AND the write path works.
 *
 * Runs in the deploy job AFTER promotion (BASE = the pages.dev alias), so the new
 * build is guaranteed live — no build-propagation race (unlike the merge-triggered
 * scoring canary). Seeds a throwaway self-owned user + session, and cleans
 * everything up in a finally block. Env: BASE_URL, DATABASE_URL, AUTH_SECRET.
 *
 * Auth: mints a valid Auth.js v5 JWT session cookie from the staged AUTH_SECRET,
 * exactly as scripts/phase1-canary.mjs + scripts/phase2-isolation-check.mjs do.
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
const TAG = `r066-telemetry-${Date.now()}`;
const EMAIL = `${TAG}@xpelevator.internal`;
const VALID_TIERS = new Set(['realtime', 'acceptable', 'slow']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fail = (msg, extra) => {
  console.error(`\n✗ TELEMETRY CHECK FAILED: ${msg}`);
  if (extra !== undefined) console.error(extra);
  process.exitCode = 1;
};

async function drain(res) {
  try { return await res.text(); } catch { return ''; }
}

async function mintCookieHeader(userId) {
  const token = { name: 'R066 Telemetry', email: EMAIL, sub: userId, id: userId };
  const maxAge = 30 * 24 * 60 * 60;
  const parts = [];
  for (const salt of ['__Secure-authjs.session-token', 'authjs.session-token']) {
    parts.push(`${salt}=${await encode({ token, secret: AUTH_SECRET, salt, maxAge })}`);
  }
  return parts.join('; ');
}

async function req(method, path, cookie, body) {
  const headers = { cookie };
  if (body !== undefined) headers['content-type'] = 'application/json';
  return fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function main() {
  console.log(`=== R-066 turn-telemetry persistence check → ${BASE} ===\n`);

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
      VALUES (gen_random_uuid(), ${EMAIL}, 'R066 Telemetry', 'MEMBER', NOW())
      ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
      RETURNING id`;
    userId = user.id;
    const cookie = await mintCookieHeader(userId);

    // The minted cookie must actually authenticate (else a later status is meaningless).
    const sess = await req('GET', '/api/auth/session', cookie);
    const sessTxt = await drain(sess);
    if (sess.status !== 200 || !sessTxt.includes(EMAIL)) {
      throw new Error(`minted cookie did not authenticate (HTTP ${sess.status})`);
    }

    // Create a CHAT session, then fire one [START] turn — the customer opener is
    // persisted as a CUSTOMER row carrying this turn's telemetry.
    const createRes = await req('POST', '/api/simulations', cookie, {
      jobTitleId: scenario.jobTitleId,
      scenarioId: scenario.id,
      type: 'CHAT',
    });
    const createTxt = await drain(createRes);
    if (createRes.status !== 201) throw new Error(`POST /api/simulations -> ${createRes.status}: ${createTxt.slice(0, 200)}`);
    sessionId = JSON.parse(createTxt).id;
    console.log(`✓ session created: ${sessionId}`);

    // Retry the opener a few times in case of an edge cold-start; the SSE body must
    // be fully drained so the server-side reply INSERT completes.
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

    // Read back the persisted CUSTOMER reply telemetry (retry — the INSERT lands
    // as the SSE stream closes).
    let row;
    for (let i = 1; i <= 5; i++) {
      const rows = await sql`
        SELECT ttft_ms AS "ttftMs", total_ms AS "totalMs",
               latency_tier AS "latencyTier", model, route_reason AS "routeReason"
        FROM chat_messages
        WHERE session_id = ${sessionId} AND role = 'CUSTOMER'
        ORDER BY timestamp DESC LIMIT 1`;
      if (rows.length > 0) { row = rows[0]; break; }
      await sleep(2000);
    }
    if (!row) throw new Error('no CUSTOMER reply row was persisted for the session');

    console.log('Persisted telemetry:', JSON.stringify(row));
    if (typeof row.ttftMs !== 'number') fail('ttft_ms is null / not an integer', row.ttftMs);
    else console.log(`  ✓ ttft_ms = ${row.ttftMs}`);
    if (typeof row.totalMs !== 'number') fail('total_ms is null / not an integer', row.totalMs);
    else console.log(`  ✓ total_ms = ${row.totalMs}`);
    if (!VALID_TIERS.has(row.latencyTier)) fail('latency_tier is null / not a known tier', row.latencyTier);
    else console.log(`  ✓ latency_tier = ${row.latencyTier}`);
    if (!row.model) fail('model is null / empty', row.model);
    else console.log(`  ✓ model = ${row.model}`);
    if (!row.routeReason) fail('route_reason is null / empty', row.routeReason);
    else console.log(`  ✓ route_reason = ${row.routeReason}`);
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
    console.error('\n✗ per-turn latency telemetry is NOT being persisted as expected.');
    return;
  }
  console.log('\n✅ R-066 VERIFIED — the reply turn persisted non-null latency telemetry (ttft/total/tier/model/route_reason).');
}

main().catch((e) => {
  console.error('\n✗ unexpected error:', e?.stack || String(e));
  process.exit(1);
});
