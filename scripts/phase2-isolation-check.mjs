/**
 * phase2-isolation-check.mjs — Phase 2 (2/3) tenant-isolation verification.
 *
 * Proves, end-to-end against the LIVE LWT deploy, that a simulation session's
 * transcript is readable ONLY by its owner or an admin in the same org — closing
 * the cross-tenant IDOR where GET /api/chat?sessionId=... authenticated the
 * caller but performed NO ownership/org check, so any logged-in user could read
 * any session by guessing its UUID.
 *
 * What it asserts (observed HTTP status codes, curl-with-your-own-eyes):
 *   1. anon (no cookie)          GET /api/chat?sessionId=<victim>  -> 401  (middleware)
 *   2. intruder (other org)      GET /api/chat?sessionId=<victim>  -> 403  (the fix)
 *   3. intruder                  GET .../?sessionId=<victim>&stream=true -> 403 (phone-stream path)
 *   4. owner                     GET /api/chat?sessionId=<victim>  -> 200  (regression: legit read still works)
 *
 * Auth: mints valid Auth.js v5 JWT session cookies from the staged AUTH_SECRET,
 * one per identity — same technique as scripts/phase1-canary.mjs. requireAuth
 * resolves role/orgId by the cookie's email, so each identity's DB row governs
 * its org membership.
 *
 * Seeds two throwaway orgs + users + one owner-held session, runs the checks,
 * and cleans everything up in a finally block. Env: BASE_URL, DATABASE_URL,
 * AUTH_SECRET.
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
const TAG = `phase2-iso-${Date.now()}`;
const OWNER_EMAIL = `${TAG}-owner@xpelevator.internal`;
const INTRUDER_EMAIL = `${TAG}-intruder@xpelevator.internal`;

let failed = 0;
const check = (name, ok, detail) => {
  if (ok) {
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

async function mintCookieHeader(userId, email) {
  // Auth.js binds the JWE to a salt = the cookie name. Mint one for the https
  // (__Secure-) and the bare name and send both; the server reads whichever
  // matches its config. `sub` becomes session.user.id; `email` drives the
  // requireAuth role/org lookup.
  const token = { name: email, email, sub: userId, id: userId };
  const maxAge = 30 * 24 * 60 * 60;
  const parts = [];
  for (const salt of ['__Secure-authjs.session-token', 'authjs.session-token']) {
    const jwe = await encode({ token, secret: AUTH_SECRET, salt, maxAge });
    parts.push(`${salt}=${jwe}`);
  }
  return parts.join('; ');
}

async function get(path, cookie, { drain = true } = {}) {
  // fetch() resolves as soon as response headers arrive, so res.status is
  // available before any body. For SSE endpoints (?stream=true) we must NOT read
  // the body — an unprotected phone-transcript stream stays open for minutes and
  // res.text() would block. Cancel the body instead and rely on the status. A
  // 10s abort backstops any slow header.
  const headers = {};
  if (cookie) headers.cookie = cookie;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(`${BASE}${path}`, { method: 'GET', headers, signal: ctrl.signal });
    const status = res.status;
    if (drain) {
      try { await res.text(); } catch { /* ignore */ }
    } else {
      try { await res.body?.cancel(); } catch { /* ignore */ }
    }
    return status;
  } catch (e) {
    return `ERR(${e?.name || 'fetch'})`;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log(`=== Phase 2 tenant-isolation check → ${BASE} ===\n`);

  // FK-valid scenario/job for the seeded session.
  const scenarios = await sql`
    SELECT id, job_title_id AS "jobTitleId" FROM scenarios ORDER BY created_at LIMIT 1
  `;
  if (scenarios.length === 0) throw new Error('no scenarios in DB to seed a session against');
  const scenario = scenarios[0];

  let victimSessionId;
  try {
    // ── Seed two orgs + two users in DIFFERENT orgs ──────────────────────────
    const [orgA] = await sql`
      INSERT INTO organizations (id, name, slug, created_at)
      VALUES (gen_random_uuid(), ${`${TAG} Owner Org`}, ${`${TAG}-owner-org`}, NOW())
      RETURNING id`;
    const [orgB] = await sql`
      INSERT INTO organizations (id, name, slug, created_at)
      VALUES (gen_random_uuid(), ${`${TAG} Intruder Org`}, ${`${TAG}-intruder-org`}, NOW())
      RETURNING id`;

    const [owner] = await sql`
      INSERT INTO users (id, email, name, role, org_id, created_at)
      VALUES (gen_random_uuid(), ${OWNER_EMAIL}, 'ISO Owner', 'MEMBER', ${orgA.id}, NOW())
      RETURNING id`;
    const [intruder] = await sql`
      INSERT INTO users (id, email, name, role, org_id, created_at)
      VALUES (gen_random_uuid(), ${INTRUDER_EMAIL}, 'ISO Intruder', 'MEMBER', ${orgB.id}, NOW())
      RETURNING id`;

    // Session owned by `owner` in orgA. user_id mirrors what /api/simulations
    // would store (session.user.id, i.e. the owner's minted cookie `sub`).
    const [sess] = await sql`
      INSERT INTO simulation_sessions
        (id, job_title_id, scenario_id, type, status, user_id, db_user_id, org_id, started_at)
      VALUES
        (gen_random_uuid(), ${scenario.jobTitleId}, ${scenario.id}, 'CHAT', 'IN_PROGRESS',
         ${owner.id}, ${owner.id}, ${orgA.id}, NOW())
      RETURNING id`;
    victimSessionId = sess.id;
    console.log(`Seeded: orgA=${orgA.id} orgB=${orgB.id}`);
    console.log(`        owner=${owner.id} intruder=${intruder.id}`);
    console.log(`        victim session=${victimSessionId} (owned by owner, orgA)\n`);

    const ownerCookie = await mintCookieHeader(owner.id, OWNER_EMAIL);
    const intruderCookie = await mintCookieHeader(intruder.id, INTRUDER_EMAIL);

    // Sanity: the intruder cookie actually authenticates (else a 401 below would
    // be a false pass — proving nothing about isolation).
    const iSess = await get('/api/auth/session', intruderCookie);
    check('intruder cookie authenticates (/api/auth/session 200)', iSess === 200, `got ${iSess}`);

    const path = `/api/chat?sessionId=${victimSessionId}`;

    console.log('\nAssertions:');
    const anon = await get(path, null);
    check('anon read is rejected (expect 401)', anon === 401, `got ${anon}`);

    const intr = await get(path, intruderCookie);
    check('cross-tenant read is forbidden (expect 403)', intr === 403, `got ${intr}`);

    const intrStream = await get(`${path}&stream=true`, intruderCookie, { drain: false });
    check('cross-tenant phone-stream is forbidden (expect 403)', intrStream === 403, `got ${intrStream}`);

    const own = await get(path, ownerCookie);
    check('owner read still works (expect 200)', own === 200, `got ${own}`);
  } finally {
    // ── Cleanup (dependents first) ───────────────────────────────────────────
    if (victimSessionId) {
      await sql`DELETE FROM scores WHERE session_id = ${victimSessionId}`;
      await sql`DELETE FROM chat_messages WHERE session_id = ${victimSessionId}`;
      await sql`DELETE FROM simulation_sessions WHERE id = ${victimSessionId}`;
    }
    await sql`DELETE FROM users WHERE email IN (${OWNER_EMAIL}, ${INTRUDER_EMAIL})`;
    await sql`DELETE FROM organizations WHERE slug IN (${`${TAG}-owner-org`}, ${`${TAG}-intruder-org`})`;
    console.log('\n(cleaned up seeded orgs/users/session)');
  }

  if (failed > 0) {
    console.error(`\n✗ ISOLATION CHECK FAILED — ${failed} assertion(s) did not hold.`);
    process.exit(1);
  }
  console.log('\n✅ TENANT ISOLATION ENFORCED — sessions are owner/same-org-admin only; the cross-tenant read is a 403.');
}

main().catch((e) => {
  console.error('\n✗ unexpected error:', e?.stack || String(e));
  process.exit(1);
});
