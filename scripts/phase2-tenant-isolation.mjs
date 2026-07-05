/**
 * phase2-tenant-isolation.mjs — Phase 2 (2/3) tenant-isolation canary.
 *
 * Proves, end-to-end against the LIVE LWT deploy, that a simulation session is
 * reachable ONLY by its owner (or an admin in the same org) — closing the IDOR
 * where `GET /api/chat?sessionId=…` returned any session's full transcript,
 * scores and scenario to any authenticated caller.
 *
 * Method (mirrors phase1-canary's mint-a-cookie pattern):
 *   1. Upsert an OWNER user + a STRANGER user (two distinct MEMBER ids).
 *   2. Owner creates a CHAT session and drives one turn so it has a transcript.
 *   3. Owner reads it back → must be 200 (no regression for the legitimate user).
 *   4. Stranger hits every session-scoped route for the OWNER's session:
 *        GET  /api/chat?sessionId=…            → must be 403 (was 200 pre-fix)
 *        GET  /api/chat?sessionId=…&stream=true → must be 403
 *        POST /api/chat  {sessionId,…}          → must be 403
 *        POST /api/scoring {sessionId,scores}   → must be 403
 *   5. Anonymous (no cookie) GET → must be 401 (middleware gate).
 *
 * Env: BASE_URL, DATABASE_URL, AUTH_SECRET.
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
const OWNER_EMAIL = 'phase2-owner@xpelevator.internal';
const STRANGER_EMAIL = 'phase2-stranger@xpelevator.internal';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  console.log(`  ${ok ? '✓' : '✗'} ${label} → HTTP ${actual} (expected ${expected})`);
  if (!ok) failures++;
};
const fatal = (msg, extra) => {
  console.error(`\n✗ SETUP FAILED: ${msg}`);
  if (extra !== undefined) console.error(extra);
  process.exit(1);
};

async function drain(res) {
  try { return await res.text(); } catch { return ''; }
}

async function mintCookieHeader(userId, name, email) {
  const token = { name, email, sub: userId, id: userId };
  const maxAge = 30 * 24 * 60 * 60;
  const names = ['__Secure-authjs.session-token', 'authjs.session-token'];
  const parts = [];
  for (const salt of names) {
    const jwe = await encode({ token, secret: AUTH_SECRET, salt, maxAge });
    parts.push(`${salt}=${jwe}`);
  }
  return parts.join('; ');
}

async function req(method, path, cookie, body) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function upsertUser(email, name) {
  const rows = await sql`
    INSERT INTO users (id, email, name, role, created_at)
    VALUES (gen_random_uuid(), ${email}, ${name}, 'MEMBER', NOW())
    ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
  `;
  return rows[0].id;
}

async function main() {
  console.log(`=== Phase 2 tenant-isolation canary → ${BASE} ===\n`);

  const scenarios = await sql`
    SELECT id, job_title_id AS "jobTitleId" FROM scenarios ORDER BY created_at LIMIT 1
  `;
  if (scenarios.length === 0) fatal('no scenarios in DB to run a session against');
  const scenario = scenarios[0];

  const ownerId = await upsertUser(OWNER_EMAIL, 'Phase2 Owner');
  const strangerId = await upsertUser(STRANGER_EMAIL, 'Phase2 Stranger');
  if (ownerId === strangerId) fatal('owner and stranger resolved to the same id');
  console.log(`Owner:    ${ownerId}\nStranger: ${strangerId}\n`);

  const ownerCookie = await mintCookieHeader(ownerId, 'Phase2 Owner', OWNER_EMAIL);
  const strangerCookie = await mintCookieHeader(strangerId, 'Phase2 Stranger', STRANGER_EMAIL);

  // Sanity: stranger's cookie really authenticates (else a 403 would be a false pass).
  const strangerSess = await req('GET', '/api/auth/session', strangerCookie);
  const strangerSessTxt = await drain(strangerSess);
  let sj = {};
  try { sj = JSON.parse(strangerSessTxt); } catch { /* empty */ }
  if (strangerSess.status !== 200 || sj?.user?.email !== STRANGER_EMAIL) {
    fatal('stranger cookie did not authenticate — a 403 below would be meaningless', strangerSessTxt);
  }
  console.log('✓ stranger cookie authenticates as a real (non-owner) user\n');

  // Owner creates a session and drives one turn so it holds a transcript + scores.
  const createRes = await req('POST', '/api/simulations', ownerCookie, {
    jobTitleId: scenario.jobTitleId,
    scenarioId: scenario.id,
    type: 'CHAT',
  });
  const createTxt = await drain(createRes);
  if (createRes.status !== 201) fatal(`owner POST /api/simulations -> ${createRes.status}`, createTxt);
  const sessionId = JSON.parse(createTxt).id;
  console.log(`✓ owner created session ${sessionId}`);
  await drain(await req('POST', '/api/chat', ownerCookie, { sessionId, content: '[START]' }));
  console.log('✓ owner drove [START] (session now has a transcript)\n');

  // ── The legitimate path must still work (no regression) ────────────────────
  console.log('Owner (legitimate) access:');
  check('GET /api/chat (own session)', (await req('GET', `/api/chat?sessionId=${sessionId}`, ownerCookie)).status, 200);

  // ── The IDOR: a stranger must be denied on EVERY session-scoped route ───────
  console.log('\nStranger (cross-tenant) access — all must be 403:');
  check('GET  /api/chat',        (await req('GET',  `/api/chat?sessionId=${sessionId}`, strangerCookie)).status, 403);
  check('GET  /api/chat&stream', (await req('GET',  `/api/chat?sessionId=${sessionId}&stream=true`, strangerCookie)).status, 403);
  check('POST /api/chat',        (await req('POST', '/api/chat', strangerCookie, { sessionId, content: 'let me in' })).status, 403);
  check('POST /api/scoring',     (await req('POST', '/api/scoring', strangerCookie, { sessionId, scores: [] })).status, 403);

  // ── Anonymous callers gated at the middleware ──────────────────────────────
  console.log('\nAnonymous (no cookie) — must be 401:');
  check('GET  /api/chat (anon)', (await req('GET', `/api/chat?sessionId=${sessionId}`, undefined)).status, 401);

  console.log('');
  if (failures > 0) {
    console.error(`✗ TENANT ISOLATION CANARY FAILED — ${failures} assertion(s) wrong.`);
    process.exit(1);
  }
  console.log('✅ TENANT ISOLATION ENFORCED — a stranger cannot read or mutate another user’s session.');
}

main().catch((e) => fatal('unexpected error', e?.stack || String(e)));
