/**
 * verify-orgs-isolation.mjs — R-043 cross-org governance isolation gate.
 *
 * Proves, end-to-end against the LIVE LWT deploy, that the `/api/orgs/*`
 * governance surface enforces the platform-super-admin vs tenant-admin split —
 * closing the cross-tenant IDOR where those routes gated on the ADMIN ROLE ALONE
 * and never on org identity, so ANY tenant admin could:
 *   - list every other tenant's org (GET /api/orgs),
 *   - read another tenant's full member roster incl. emails (GET /api/orgs/[id]),
 *   - rename or re-plan another tenant's org (PUT /api/orgs/[id]),
 *   - delete another tenant's org (DELETE /api/orgs/[id]).
 *
 * What it asserts (observed HTTP status + response body, curl-with-your-own-eyes)
 * using a TENANT admin in org A probing an unrelated org B:
 *   1. anon (no cookie)   GET  /api/orgs            -> 401  (auth required)
 *   2. tenant admin A     GET  /api/orgs            -> 200 and the list EXCLUDES org B
 *   3. tenant admin A     GET  /api/orgs/<orgB>          -> 403  (the fix: no cross-tenant read)
 *   4. tenant admin A     GET  /api/orgs/<orgB>/members  -> 403  (no cross-tenant roster read)
 *   5. tenant admin A     POST /api/orgs/<orgB>/members  -> 403  (no cross-tenant member plant)
 *   6. tenant admin A     PUT  /api/orgs/<orgB>          -> 403  and org B's plan is UNCHANGED in DB
 *   7. tenant admin A     POST /api/orgs                 -> 403  (only a platform admin mints top-level orgs)
 *   8. tenant admin A     GET  /api/orgs/<orgA>          -> 200  (regression: own-org read still works)
 *
 * Auth: mints a valid Auth.js v5 JWT session cookie from the staged AUTH_SECRET
 * (same technique as scripts/phase2-isolation-check.mjs). requireAuth resolves
 * role/orgId by the cookie's email, so the seeded ADMIN-in-orgA row makes the
 * prober a genuine TENANT admin (has an org) — not a platform admin.
 *
 * Seeds two throwaway orgs + one admin user, runs the checks, and cleans
 * everything up in a finally block. Env: BASE_URL, DATABASE_URL, AUTH_SECRET.
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
const TAG = `r043-orgiso-${Date.now()}`;
const ADMIN_EMAIL = `${TAG}-admin@xpelevator.internal`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

async function request(method, path, cookie, body, { retries = 2, timeoutMs = 15_000 } = {}) {
  // fetch() resolves on headers, so status is available before the body. Only a
  // transient network ERR(...) is retried (never a real wrong-status, which is a
  // number returned on the first try) — a short linear backoff absorbs edge
  // cold-starts without masking a genuine failure.
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const headers = {};
    if (cookie) headers.cookie = cookie;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      let json = null;
      try { json = await res.json(); } catch { /* non-JSON / empty */ }
      return { status: res.status, json };
    } catch (e) {
      last = `ERR(${e?.name || 'fetch'})`;
      if (attempt < retries) await sleep(500 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  return { status: last, json: null };
}

async function main() {
  console.log(`=== R-043 /api/orgs cross-org isolation check → ${BASE} ===\n`);

  let orgAId;
  let orgBId;
  try {
    // ── Seed two orgs + an ADMIN user in org A (the prober is a TENANT admin) ──
    const [orgA] = await sql`
      INSERT INTO organizations (id, name, slug, plan, created_at)
      VALUES (gen_random_uuid(), ${`${TAG} Tenant A`}, ${`${TAG}-a`}, 'FREE', NOW())
      RETURNING id`;
    const [orgB] = await sql`
      INSERT INTO organizations (id, name, slug, plan, created_at)
      VALUES (gen_random_uuid(), ${`${TAG} Tenant B`}, ${`${TAG}-b`}, 'FREE', NOW())
      RETURNING id`;
    orgAId = orgA.id;
    orgBId = orgB.id;

    const [admin] = await sql`
      INSERT INTO users (id, email, name, role, org_id, created_at)
      VALUES (gen_random_uuid(), ${ADMIN_EMAIL}, 'R043 Tenant Admin', 'ADMIN', ${orgAId}, NOW())
      RETURNING id`;

    console.log(`Seeded: orgA=${orgAId} orgB=${orgBId} admin=${admin.id} (ADMIN in orgA)\n`);

    const adminCookie = await mintCookieHeader(admin.id, ADMIN_EMAIL);

    // Sanity: the cookie authenticates as an ADMIN who belongs to orgA (else a
    // 403 below would be a false pass, proving nothing about isolation).
    const sess = await request('GET', '/api/auth/session', adminCookie);
    check('tenant-admin cookie authenticates (/api/auth/session 200)', sess.status === 200, `got ${sess.status}`);

    console.log('\nAssertions:');

    const anon = await request('GET', '/api/orgs', null);
    check('anon list is rejected (expect 401)', anon.status === 401, `got ${anon.status}`);

    // The scoped list must EXCLUDE org B. Poll a few times: a freshly-deployed
    // route can serve one stale/propagating response before the per-request
    // (force-dynamic) scope settles — a real wrong-scope never self-corrects, so
    // this only absorbs transient propagation, never masks a genuine leak.
    let list = await request('GET', '/api/orgs', adminCookie);
    let ids = Array.isArray(list.json) ? list.json.map((o) => o.id) : [];
    for (let i = 0; i < 4 && list.status === 200 && ids.includes(orgBId); i++) {
      await sleep(2000);
      list = await request('GET', '/api/orgs', adminCookie);
      ids = Array.isArray(list.json) ? list.json.map((o) => o.id) : [];
    }
    check('tenant admin list is 200', list.status === 200, `got ${list.status}`);
    check('tenant admin list EXCLUDES the other tenant (org B)', !ids.includes(orgBId), `list ids: ${ids.join(',') || '(none)'}`);
    check('tenant admin list INCLUDES own org (org A)', ids.includes(orgAId), `list ids: ${ids.join(',') || '(none)'}`);

    const readB = await request('GET', `/api/orgs/${orgBId}`, adminCookie);
    check('cross-tenant org read is forbidden (expect 403)', readB.status === 403, `got ${readB.status}`);

    const membersB = await request('GET', `/api/orgs/${orgBId}/members`, adminCookie);
    check('cross-tenant member-roster read is forbidden (expect 403)', membersB.status === 403, `got ${membersB.status}`);

    const addMemberB = await request('POST', `/api/orgs/${orgBId}/members`, adminCookie, {
      email: `${TAG}-planted@xpelevator.internal`,
      role: 'ADMIN',
    });
    check('cross-tenant member plant is forbidden (expect 403)', addMemberB.status === 403, `got ${addMemberB.status}`);

    const putB = await request('PUT', `/api/orgs/${orgBId}`, adminCookie, { plan: 'ENTERPRISE' });
    check('cross-tenant org update is forbidden (expect 403)', putB.status === 403, `got ${putB.status}`);
    const [afterB] = await sql`SELECT plan FROM organizations WHERE id = ${orgBId}`;
    check("org B's plan is UNCHANGED after the forbidden PUT (still FREE)", afterB?.plan === 'FREE', `plan is now ${afterB?.plan}`);

    const postTop = await request('POST', '/api/orgs', adminCookie, { name: `${TAG} Sneaky Top-Level` });
    check('tenant admin may NOT mint a top-level org (expect 403)', postTop.status === 403, `got ${postTop.status}`);

    const readA = await request('GET', `/api/orgs/${orgAId}`, adminCookie);
    check('own-org read still works (expect 200)', readA.status === 200, `got ${readA.status}`);
  } finally {
    // ── Cleanup (users first, then orgs) ──────────────────────────────────────
    await sql`DELETE FROM users WHERE email IN (${ADMIN_EMAIL}, ${`${TAG}-planted@xpelevator.internal`})`;
    // Delete any org that leaked from a failed POST probe, plus the two seeds.
    await sql`DELETE FROM organizations WHERE slug IN (${`${TAG}-a`}, ${`${TAG}-b`})`;
    await sql`DELETE FROM organizations WHERE name = ${`${TAG} Sneaky Top-Level`}`;
    console.log('\n(cleaned up seeded orgs/user)');
  }

  if (failed > 0) {
    console.error(`\n✗ R-043 ISOLATION CHECK FAILED — ${failed} assertion(s) did not hold.`);
    process.exit(1);
  }
  console.log('\n✅ /api/orgs GOVERNANCE ISOLATED — a tenant admin cannot list, read, mutate, or mint across tenants.');
}

main().catch((e) => {
  console.error('\n✗ unexpected error:', e?.stack || String(e));
  process.exit(1);
});
