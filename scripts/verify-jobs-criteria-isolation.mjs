/**
 * verify-jobs-criteria-isolation.mjs — cross-org read-IDOR gate for
 * `GET /api/jobs/[id]/criteria`.
 *
 * Proves, end-to-end against the LIVE LWT deploy, that reading a job title's
 * linked scoring criteria is scoped to the caller's tenant — closing the
 * cross-tenant read IDOR where the GET gated on authentication ALONE and never
 * on org identity, so ANY authenticated user (even a trainee/MEMBER in another
 * org) could enumerate a different tenant's private scoring rubric — the linked
 * criteria names + descriptions — by supplying that tenant's job-title id.
 *
 * This is the same role/auth-only-no-org-scope class that R-043 closed on
 * `/api/orgs/*`; the sibling POST/DELETE on this path were already guarded — the
 * GET was the last one on this surface.
 *
 * What it asserts (observed HTTP status + body, curl-with-your-own-eyes) using a
 * TENANT MEMBER in org A probing an unrelated org B:
 *   1. anon (no cookie)  GET /api/jobs/<jobB>/criteria      -> 401 (auth required)
 *   2. member A          GET /api/jobs/<jobB>/criteria      -> 403 (the fix: no cross-tenant read)
 *   3. member A          GET /api/jobs/<random-uuid>/criteria -> 404 (unknown job)
 *   4. member A          GET /api/jobs/<jobA>/criteria       -> 200 and the body
 *                        INCLUDES org A's own linked criterion (regression: the
 *                        own-org read still returns the rubric)
 *
 * Auth: mints a valid Auth.js v5 JWT session cookie from the staged AUTH_SECRET
 * (same technique as verify-orgs-isolation.mjs). requireAuth resolves role/orgId
 * by the cookie's email, so the seeded MEMBER-in-orgA row makes the prober a
 * genuine tenant member — not an admin, not a platform (null-org) user.
 *
 * Seeds two throwaway orgs, a MEMBER user, a job title + criterion + link in
 * EACH org, runs the checks, and cleans everything up in a finally block.
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
const TAG = `jobcrit-iso-${Date.now()}`;
const MEMBER_EMAIL = `${TAG}-member@xpelevator.internal`;
const RANDOM_UUID = '00000000-0000-4000-8000-000000000000';

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
  // matches its config.
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

/** Seed an org with a job title, a criterion, and the link between them. */
async function seedOrgWithRubric(label) {
  const [org] = await sql`
    INSERT INTO organizations (id, name, slug, plan, created_at)
    VALUES (gen_random_uuid(), ${`${TAG} ${label}`}, ${`${TAG}-${label.toLowerCase()}`}, 'FREE', NOW())
    RETURNING id`;
  const [job] = await sql`
    INSERT INTO job_titles (id, org_id, name, created_at)
    VALUES (gen_random_uuid(), ${org.id}, ${`${TAG} Role ${label}`}, NOW())
    RETURNING id`;
  const [crit] = await sql`
    INSERT INTO criteria (id, name, description, weight, category, active, org_id, created_at, updated_at)
    VALUES (gen_random_uuid(), ${`${TAG} Criterion ${label}`}, ${`SECRET rubric for ${label}`}, 5, 'general', true, ${org.id}, NOW(), NOW())
    RETURNING id`;
  await sql`
    INSERT INTO job_criteria (id, job_title_id, criteria_id)
    VALUES (gen_random_uuid(), ${job.id}, ${crit.id})`;
  return { orgId: org.id, jobId: job.id, critId: crit.id };
}

async function main() {
  console.log(`=== jobs/[id]/criteria cross-org read isolation check → ${BASE} ===\n`);

  try {
    // ── Seed two orgs, each with a job title + linked criterion, + a MEMBER in A ──
    const a = await seedOrgWithRubric('A');
    const b = await seedOrgWithRubric('B');

    const [member] = await sql`
      INSERT INTO users (id, email, name, role, org_id, created_at)
      VALUES (gen_random_uuid(), ${MEMBER_EMAIL}, 'JobCrit Tenant Member', 'MEMBER', ${a.orgId}, NOW())
      RETURNING id`;

    console.log(
      `Seeded: orgA=${a.orgId} jobA=${a.jobId} | orgB=${b.orgId} jobB=${b.jobId} | member=${member.id} (MEMBER in orgA)\n`
    );

    const memberCookie = await mintCookieHeader(member.id, MEMBER_EMAIL);

    // Sanity: the cookie authenticates (else a 403/401 below would be a false
    // pass that proves nothing about isolation).
    const sess = await request('GET', '/api/auth/session', memberCookie);
    check('tenant-member cookie authenticates (/api/auth/session 200)', sess.status === 200, `got ${sess.status}`);

    console.log('\nAssertions:');

    const anon = await request('GET', `/api/jobs/${b.jobId}/criteria`, null);
    check('anon read is rejected (expect 401)', anon.status === 401, `got ${anon.status}`);

    // Cross-tenant read must be 403. Poll a few times to absorb transient
    // route/propagation edge on a fresh deploy — a real leak never self-corrects,
    // so this only masks flakiness, never a genuine hole.
    let crossB = await request('GET', `/api/jobs/${b.jobId}/criteria`, memberCookie);
    for (let i = 0; i < 4 && crossB.status === 200; i++) {
      await sleep(2000);
      crossB = await request('GET', `/api/jobs/${b.jobId}/criteria`, memberCookie);
    }
    check('cross-tenant job-criteria read is forbidden (expect 403)', crossB.status === 403, `got ${crossB.status}`);
    const crossLeaked = Array.isArray(crossB.json) && crossB.json.some((c) => c.id === b.critId);
    check("org B's rubric criterion is NOT leaked in the cross-tenant read", !crossLeaked, 'org B criterion appeared in the body');

    const unknown = await request('GET', `/api/jobs/${RANDOM_UUID}/criteria`, memberCookie);
    check('unknown job title is 404', unknown.status === 404, `got ${unknown.status}`);

    const ownA = await request('GET', `/api/jobs/${a.jobId}/criteria`, memberCookie);
    check('own-org read still works (expect 200)', ownA.status === 200, `got ${ownA.status}`);
    const ownHasCrit = Array.isArray(ownA.json) && ownA.json.some((c) => c.id === a.critId);
    check('own-org read returns the linked criterion (regression)', ownHasCrit, 'own criterion missing from the body');
  } finally {
    // ── Cleanup: links → criteria/job_titles/users → orgs (FK order) ──────────
    await sql`DELETE FROM job_criteria WHERE job_title_id IN (
      SELECT id FROM job_titles WHERE name LIKE ${`${TAG} Role %`}
    )`;
    await sql`DELETE FROM criteria WHERE name LIKE ${`${TAG} Criterion %`}`;
    await sql`DELETE FROM job_titles WHERE name LIKE ${`${TAG} Role %`}`;
    await sql`DELETE FROM users WHERE email = ${MEMBER_EMAIL}`;
    await sql`DELETE FROM organizations WHERE slug IN (${`${TAG}-a`}, ${`${TAG}-b`})`;
    console.log('\n(cleaned up seeded orgs/user/rubric)');
  }

  if (failed > 0) {
    console.error(`\n✗ JOBS/CRITERIA ISOLATION CHECK FAILED — ${failed} assertion(s) did not hold.`);
    process.exit(1);
  }
  console.log('\n✅ GET /api/jobs/[id]/criteria ISOLATED — an authenticated user cannot read another tenant’s scoring rubric.');
}

main().catch((e) => {
  console.error('\n✗ unexpected error:', e?.stack || String(e));
  process.exit(1);
});
