/**
 * verify-scoring-criteria-isolation.mjs — cross-tenant leak gate for the
 * end-of-session SCORING path (`loadScoringCriteria` in src/lib/session-scoring.ts).
 *
 * The runtime-path sibling of the `/api/*` isolation gates (R-043 orgs, R-072
 * job↔scenario, the job-criteria read). Those close cross-tenant leaks on REST
 * reads; this closes one in the scoring engine itself.
 *
 * The bug (pre-fix): when a session's job title had NO linked criteria, scoring
 * fell back to `SELECT … FROM criteria WHERE active = true` with NO org filter —
 * so a real tenant's session was scored against EVERY other tenant's private
 * criteria. Their names/descriptions were sent to the judge and their
 * `criteria_id`s were written as this session's scores, then surfaced in the
 * WRONG tenant's analytics `byCriteria` breakdown.
 *
 * The fix scopes both the linked and the fallback selection to
 * `(ss.org_id IS NULL OR c.org_id IS NULL OR c.org_id = ss.org_id)` — a criterion
 * is eligible only if it is global or belongs to the session's own org, while an
 * ORG-LESS session (the canary, self-registered users) keeps every active
 * criterion (no tenant to leak between — a provable no-op there).
 *
 * This gate proves the semantics on the LIVE Postgres (real NULL handling),
 * seeding two tenants + a global criterion, and asserting against the DEPLOYED
 * schema:
 *   1. The OLD unscoped fallback WOULD have leaked org B's criterion into an
 *      org-A session (the seed is genuinely exploitable — no false green).
 *   2. The FIXED fallback for an org-A session returns org A's + the global
 *      criterion and EXCLUDES org B's (leak closed).
 *   3. The FIXED linked query for an org-A session drops a (directly-seeded)
 *      cross-tenant link to org B's criterion.
 *   4. The FIXED fallback for an ORG-LESS session still returns all three
 *      (regression guard: the live scoring canary is org-less and must not
 *      lose its criteria).
 *
 * DB-only (no HTTP, no LLM) → fast and deterministic in the deploy critical
 * path. The companion unit tests (tests/unit/lib/session-scoring.test.ts) prove
 * the deployed handler actually issues these scoped queries, so handler + gate
 * cannot drift.
 *
 * Env: DATABASE_URL.
 */
import { neon } from '@neondatabase/serverless';

const DB = process.env.DATABASE_URL?.replace(/\r/g, '');
if (!DB) {
  console.error('Missing DATABASE_URL');
  process.exit(1);
}
const sql = neon(DB);
const TAG = `scoring-iso-${Date.now()}`;

let failed = 0;
const check = (name, ok, detail) => {
  if (ok) {
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

/** Seed a tenant org + one active criterion; returns their ids. */
async function seedOrg(label) {
  const [org] = await sql`
    INSERT INTO organizations (id, name, slug, plan, created_at)
    VALUES (gen_random_uuid(), ${`${TAG} ${label}`}, ${`${TAG}-${label.toLowerCase()}`}, 'FREE', NOW())
    RETURNING id`;
  const [crit] = await sql`
    INSERT INTO criteria (id, name, description, weight, category, active, org_id, created_at, updated_at)
    VALUES (gen_random_uuid(), ${`${TAG} Crit ${label}`}, ${`SECRET rubric ${label}`}, 5, 'general', true, ${org.id}, NOW(), NOW())
    RETURNING id`;
  return { orgId: org.id, critId: crit.id };
}

/** The FIXED fallback selection, verbatim from loadScoringCriteria. */
function fallbackScoped(sessionId) {
  return sql`
    SELECT c.id
    FROM criteria c
    JOIN simulation_sessions ss ON ss.id = ${sessionId}
    WHERE c.active = true
      AND (ss.org_id IS NULL OR c.org_id IS NULL OR c.org_id = ss.org_id)`;
}

/** The FIXED linked selection, verbatim from loadScoringCriteria. */
function linkedScoped(sessionId) {
  return sql`
    SELECT c.id
    FROM simulation_sessions ss
    JOIN job_criteria jc ON jc.job_title_id = ss.job_title_id
    JOIN criteria c ON c.id = jc.criteria_id
    WHERE ss.id = ${sessionId} AND c.active = true
      AND (ss.org_id IS NULL OR c.org_id IS NULL OR c.org_id = ss.org_id)`;
}

/** The OLD unscoped fallback — kept only to prove the seed is exploitable. */
function fallbackUnscoped() {
  return sql`SELECT id FROM criteria WHERE active = true`;
}

const has = (rows, id) => rows.some((r) => r.id === id);

async function main() {
  console.log(`=== scoring-criteria cross-tenant isolation check (DB semantics) ===\n`);

  let globalCritId;
  try {
    const a = await seedOrg('A');
    const b = await seedOrg('B');

    // A distinctly-named GLOBAL (org-less) active criterion — must always be
    // eligible for any session.
    const [g] = await sql`
      INSERT INTO criteria (id, name, description, weight, category, active, org_id, created_at, updated_at)
      VALUES (gen_random_uuid(), ${`${TAG} Crit G`}, 'global rubric', 4, 'general', true, NULL, NOW(), NOW())
      RETURNING id`;
    globalCritId = g.id;

    // A job title in org A with NO linked criteria (forces the fallback), plus a
    // scenario + a session in org A on that job.
    const [jobA] = await sql`
      INSERT INTO job_titles (id, org_id, name, created_at)
      VALUES (gen_random_uuid(), ${a.orgId}, ${`${TAG} Role A`}, NOW())
      RETURNING id`;
    const [scenA] = await sql`
      INSERT INTO scenarios (id, org_id, job_title_id, name, description, type, script, created_at)
      VALUES (gen_random_uuid(), ${a.orgId}, ${jobA.id}, ${`${TAG} Scenario A`}, 'seed', 'CHAT', '{}'::jsonb, NOW())
      RETURNING id`;
    const [sessA] = await sql`
      INSERT INTO simulation_sessions (id, org_id, job_title_id, scenario_id, type, status, created_at)
      VALUES (gen_random_uuid(), ${a.orgId}, ${jobA.id}, ${scenA.id}, 'CHAT', 'IN_PROGRESS', NOW())
      RETURNING id`;

    // An ORG-LESS session on the same job (regression guard for the canary).
    const [sessNull] = await sql`
      INSERT INTO simulation_sessions (id, org_id, job_title_id, scenario_id, type, status, created_at)
      VALUES (gen_random_uuid(), NULL, ${jobA.id}, ${scenA.id}, 'CHAT', 'IN_PROGRESS', NOW())
      RETURNING id`;

    console.log(
      `Seeded: orgA=${a.orgId} critA=${a.critId} | orgB=${b.orgId} critB=${b.critId} | ` +
        `critG=${globalCritId} | sessA=${sessA.id} sessNull=${sessNull.id}\n`
    );

    console.log('Assertions:');

    // 1. The seed is genuinely exploitable under the OLD unscoped fallback.
    const oldRows = await fallbackUnscoped();
    check(
      "OLD unscoped fallback WOULD leak org B's criterion (seed is exploitable)",
      has(oldRows, b.critId),
      "org B criterion absent even from the unscoped query — seed not exploitable, gate would be a false green"
    );

    // 2. FIXED fallback for the org-A session: A + G, never B.
    const fixA = await fallbackScoped(sessA.id);
    check("fixed fallback (org A) INCLUDES org A's own criterion", has(fixA, a.critId));
    check('fixed fallback (org A) INCLUDES the global criterion', has(fixA, globalCritId));
    check(
      "fixed fallback (org A) EXCLUDES org B's criterion (leak closed)",
      !has(fixA, b.critId),
      "org B criterion still selected for org A's session"
    );

    // 3. FIXED linked query drops a directly-seeded cross-tenant link. (Such a
    //    link can't be made via the API, but the DB predicate must still hold.)
    await sql`
      INSERT INTO job_criteria (id, job_title_id, criteria_id)
      VALUES (gen_random_uuid(), ${jobA.id}, ${a.critId}),
             (gen_random_uuid(), ${jobA.id}, ${b.critId})`;
    const linkA = await linkedScoped(sessA.id);
    check("fixed linked query (org A) INCLUDES org A's linked criterion", has(linkA, a.critId));
    check(
      "fixed linked query (org A) EXCLUDES the cross-tenant org-B link",
      !has(linkA, b.critId),
      "org B criterion returned through a cross-tenant job_criteria link"
    );

    // 4. Regression guard: an ORG-LESS session keeps every active criterion.
    //    (job now HAS links, so re-check via the fallback shape on a link-less
    //    read: an org-less session must never lose criteria vs. the old code.)
    const nullRows = await fallbackScoped(sessNull.id);
    check('org-less fallback INCLUDES org A criterion (canary unchanged)', has(nullRows, a.critId));
    check('org-less fallback INCLUDES org B criterion (canary unchanged)', has(nullRows, b.critId));
    check('org-less fallback INCLUDES global criterion (canary unchanged)', has(nullRows, globalCritId));
  } finally {
    // Cleanup in FK order.
    await sql`DELETE FROM job_criteria WHERE job_title_id IN (
      SELECT id FROM job_titles WHERE name LIKE ${`${TAG} Role %`}
    )`;
    await sql`DELETE FROM simulation_sessions WHERE scenario_id IN (
      SELECT id FROM scenarios WHERE name LIKE ${`${TAG} Scenario %`}
    )`;
    await sql`DELETE FROM scenarios WHERE name LIKE ${`${TAG} Scenario %`}`;
    await sql`DELETE FROM job_titles WHERE name LIKE ${`${TAG} Role %`}`;
    await sql`DELETE FROM criteria WHERE name LIKE ${`${TAG} Crit %`}`;
    await sql`DELETE FROM organizations WHERE slug IN (${`${TAG}-a`}, ${`${TAG}-b`})`;
    console.log('\n(cleaned up seeded orgs/criteria/session)');
  }

  if (failed > 0) {
    console.error(`\n✗ SCORING-CRITERIA ISOLATION CHECK FAILED — ${failed} assertion(s) did not hold.`);
    process.exit(1);
  }
  console.log('\n✅ SCORING CRITERIA ISOLATED — a tenant session is scored only against its own + global criteria.');
}

main().catch((e) => {
  console.error('\n✗ unexpected error:', e?.stack || String(e));
  process.exit(1);
});
