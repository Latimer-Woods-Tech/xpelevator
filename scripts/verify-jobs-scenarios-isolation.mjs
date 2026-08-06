/**
 * verify-jobs-scenarios-isolation.mjs — cross-org isolation gate for the
 * job-title ↔ scenario relationship (`GET /api/jobs` + `POST /api/scenarios`).
 *
 * Closes two linked cross-tenant holes on the SAME boundary:
 *
 *   1. READ leak — `GET /api/jobs` returned each globally-visible (null-org)
 *      job title to every tenant but joined its embedded `scenarios` (and
 *      `jobCriteria`) WITHOUT an org filter. So ANY authenticated user (even a
 *      trainee/MEMBER) saw other tenants' private scenario names/descriptions
 *      attached to a shared job title — a cross-tenant read IDOR (sibling of
 *      the /api/jobs/[id]/criteria and /api/orgs/* cases).
 *
 *   2. WRITE injection — `POST /api/scenarios` inserted with a caller-supplied
 *      `jobTitleId` without checking it was visible to the caller, so an org-A
 *      admin could attach a scenario to org-B's PRIVATE job title (injecting
 *      content into org B's /api/jobs view). Now guarded with canReadResource.
 *
 * What it asserts (observed HTTP status + body, curl-with-your-own-eyes)
 * against the LIVE LWT deploy, using a TENANT MEMBER + ADMIN in org A probing
 * an unrelated org B, with a GLOBAL job title carrying an org-A scenario AND an
 * org-B scenario:
 *   READ (member A on GET /api/jobs):
 *     a. anon                    -> 401
 *     b. member A                -> 200; under the shared/global job the
 *                                   scenarios array INCLUDES org A's own
 *                                   scenario (regression) and EXCLUDES org B's
 *                                   (the fix: no cross-tenant leak)
 *     c. org B's PRIVATE job title never appears as a top-level job for A
 *   WRITE (admin A on POST /api/scenarios):
 *     d. jobTitleId = org-B private job  -> 403 (no cross-tenant write)
 *     e. jobTitleId = random uuid        -> 404
 *     f. jobTitleId = org-A private job  -> 201 (own authoring still works)
 *
 * Auth: mints valid Auth.js v5 session cookies from the staged AUTH_SECRET
 * (same technique as verify-jobs-criteria-isolation.mjs). Seeds two throwaway
 * orgs, a MEMBER + an ADMIN in org A, a global job title with an org-A and an
 * org-B scenario, and a private job title in each org; cleans up in a finally.
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
const TAG = `jobscen-iso-${Date.now()}`;
const MEMBER_EMAIL = `${TAG}-member@xpelevator.internal`;
const ADMIN_EMAIL = `${TAG}-admin@xpelevator.internal`;
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

async function seedOrg(label) {
  const [org] = await sql`
    INSERT INTO organizations (id, name, slug, plan, created_at)
    VALUES (gen_random_uuid(), ${`${TAG} ${label}`}, ${`${TAG}-${label.toLowerCase()}`}, 'FREE', NOW())
    RETURNING id`;
  return org.id;
}

async function seedJob(orgId, label) {
  const [job] = await sql`
    INSERT INTO job_titles (id, org_id, name, created_at)
    VALUES (gen_random_uuid(), ${orgId}, ${`${TAG} Job ${label}`}, NOW())
    RETURNING id`;
  return job.id;
}

async function seedScenario(orgId, jobId, label) {
  const [sc] = await sql`
    INSERT INTO scenarios (id, job_title_id, name, description, type, script, org_id, created_at)
    VALUES (gen_random_uuid(), ${jobId}, ${`${TAG} Scenario ${label}`},
            ${`SECRET description for ${label}`}, 'CHAT', '{}', ${orgId}, NOW())
    RETURNING id`;
  return sc.id;
}

async function main() {
  console.log(`=== job-title ↔ scenario cross-org isolation check → ${BASE} ===\n`);

  const createdScenarioIds = [];
  try {
    const orgA = await seedOrg('A');
    const orgB = await seedOrg('B');

    // A GLOBAL (null-org) job title — the shared catalog row visible to all.
    const [globalJob] = await sql`
      INSERT INTO job_titles (id, org_id, name, created_at)
      VALUES (gen_random_uuid(), NULL, ${`${TAG} Global Role`}, NOW())
      RETURNING id`;

    // Under the shared job: an org-A scenario (should stay visible to A) and an
    // org-B scenario (must NOT leak to A) — the read-IDOR vector.
    const scenAglobal = await seedScenario(orgA, globalJob.id, 'A-on-global');
    const scenBglobal = await seedScenario(orgB, globalJob.id, 'B-on-global');
    createdScenarioIds.push(scenAglobal, scenBglobal);

    // Private job titles for the write-guard test.
    const jobA = await seedJob(orgA, 'A-private');
    const jobB = await seedJob(orgB, 'B-private');

    const [member] = await sql`
      INSERT INTO users (id, email, name, role, org_id, created_at)
      VALUES (gen_random_uuid(), ${MEMBER_EMAIL}, 'JobScen Member', 'MEMBER', ${orgA}, NOW())
      RETURNING id`;
    const [admin] = await sql`
      INSERT INTO users (id, email, name, role, org_id, created_at)
      VALUES (gen_random_uuid(), ${ADMIN_EMAIL}, 'JobScen Admin', 'ADMIN', ${orgA}, NOW())
      RETURNING id`;

    console.log(
      `Seeded: orgA=${orgA} orgB=${orgB} globalJob=${globalJob.id}\n` +
      `        scenA=${scenAglobal} scenB=${scenBglobal} jobA=${jobA} jobB=${jobB}\n` +
      `        member=${member.id} (MEMBER/A) admin=${admin.id} (ADMIN/A)\n`
    );

    const memberCookie = await mintCookieHeader(member.id, MEMBER_EMAIL);
    const adminCookie = await mintCookieHeader(admin.id, ADMIN_EMAIL);

    // Sanity: the member cookie authenticates.
    const sess = await request('GET', '/api/auth/session', memberCookie);
    check('tenant-member cookie authenticates (/api/auth/session 200)', sess.status === 200, `got ${sess.status}`);

    console.log('\nRead isolation — GET /api/jobs:');

    const anon = await request('GET', '/api/jobs', null);
    check('anon read is rejected (expect 401)', anon.status === 401, `got ${anon.status}`);

    // Cross-tenant read must never surface org B's scenario. Poll to absorb a
    // transient fresh-deploy edge — a real leak never self-corrects.
    let jobsA = await request('GET', '/api/jobs', memberCookie);
    const bLeaks = () => {
      if (!Array.isArray(jobsA.json)) return false;
      const g = jobsA.json.find((j) => j.id === globalJob.id);
      return !!g && Array.isArray(g.scenarios) && g.scenarios.some((s) => s.id === scenBglobal);
    };
    for (let i = 0; i < 4 && bLeaks(); i++) {
      await sleep(2000);
      jobsA = await request('GET', '/api/jobs', memberCookie);
    }
    check('member A read succeeds (expect 200)', jobsA.status === 200, `got ${jobsA.status}`);

    const list = Array.isArray(jobsA.json) ? jobsA.json : [];
    const globalInList = list.find((j) => j.id === globalJob.id);
    check('the shared/global job title is visible to member A', !!globalInList,
      'global job missing from member A /api/jobs');

    const aScenarios = globalInList?.scenarios ?? [];
    check("org A's own scenario under the shared job is returned (regression)",
      aScenarios.some((s) => s.id === scenAglobal), 'own scenario missing');
    check("org B's scenario under the shared job is NOT leaked to org A",
      !aScenarios.some((s) => s.id === scenBglobal), 'org B scenario appeared in org A view');

    check("org B's PRIVATE job title never appears as a top-level job for A",
      !list.some((j) => j.id === jobB), 'org B private job leaked into org A /api/jobs');
    check("org A's own private job title is visible to A (regression)",
      list.some((j) => j.id === jobA), 'own private job missing');

    console.log('\nWrite isolation — POST /api/scenarios:');

    const crossWrite = await request('POST', '/api/scenarios', adminCookie, {
      jobTitleId: jobB, name: `${TAG} Injected`, type: 'CHAT',
    });
    check('cross-tenant scenario write is forbidden (expect 403)', crossWrite.status === 403,
      `got ${crossWrite.status}`);
    if (crossWrite.status === 201 && crossWrite.json?.id) createdScenarioIds.push(crossWrite.json.id);

    const unknownJob = await request('POST', '/api/scenarios', adminCookie, {
      jobTitleId: RANDOM_UUID, name: `${TAG} Unknown`, type: 'CHAT',
    });
    check('unknown job title on write is 404', unknownJob.status === 404, `got ${unknownJob.status}`);
    if (unknownJob.status === 201 && unknownJob.json?.id) createdScenarioIds.push(unknownJob.json.id);

    const ownWrite = await request('POST', '/api/scenarios', adminCookie, {
      jobTitleId: jobA, name: `${TAG} OwnScenario`, type: 'CHAT',
    });
    check('own-org scenario authoring still works (expect 201)', ownWrite.status === 201,
      `got ${ownWrite.status}`);
    if (ownWrite.json?.id) createdScenarioIds.push(ownWrite.json.id);
  } finally {
    // Cleanup: scenarios → job_titles → users → orgs (FK order). Delete by TAG
    // so the global job title + all seeded/authored scenarios are removed.
    if (createdScenarioIds.length > 0) {
      await sql`DELETE FROM scenarios WHERE id = ANY(${createdScenarioIds})`;
    }
    await sql`DELETE FROM scenarios WHERE name LIKE ${`${TAG} %`}`;
    await sql`DELETE FROM job_titles WHERE name LIKE ${`${TAG} %`}`;
    await sql`DELETE FROM users WHERE email IN (${MEMBER_EMAIL}, ${ADMIN_EMAIL})`;
    await sql`DELETE FROM organizations WHERE slug IN (${`${TAG}-a`}, ${`${TAG}-b`})`;
    console.log('\n(cleaned up seeded orgs/users/jobs/scenarios)');
  }

  if (failed > 0) {
    console.error(`\n✗ JOBS/SCENARIOS ISOLATION CHECK FAILED — ${failed} assertion(s) did not hold.`);
    process.exit(1);
  }
  console.log('\n✅ job-title ↔ scenario boundary ISOLATED — no cross-tenant scenario read on /api/jobs and no cross-tenant write on POST /api/scenarios.');
}

main().catch((e) => {
  console.error('\n✗ unexpected error:', e?.stack || String(e));
  process.exit(1);
});
