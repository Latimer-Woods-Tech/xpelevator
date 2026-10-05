/**
 * backfill-opening-lines.ts — add the authored `openingLine` to scenario rows
 * that already exist in a database (plan W2.8 · G804 · Factory#5238).
 *
 * Why a script: a code deploy does not change stored rows. Global reference
 * scenarios were written once by `prisma/seed.ts` (the deploy never runs the
 * seed), and starter-pack scenarios were copied into each importing org's
 * `scenarios.script` JSONB at import time. Neither picks up the new field.
 *
 * What it changes: ONLY `scenarios.script.openingLine`, ONLY on rows where it is
 * missing or blank, ONLY on rows matched by stable identity (pack rows by
 * `source_pack_id` + `source_scenario_key`; seed rows by the seed's own natural
 * key among global rows), and ONLY where the stored persona / objective /
 * difficulty still equal the catalog's. Every other row is reported and left
 * alone. See `scripts/lib/opening-line-backfill.ts` for the rules (unit tested).
 * It does not touch `pack_version`, so an org's opt-in pack upgrade stays
 * available and unchanged.
 *
 * Idempotent: a second run finds every filled row `already-set`. The UPDATE
 * re-checks both conditions in SQL, so a concurrent operator edit wins.
 *
 * Usage (DRY RUN is the default — prints the plan, writes nothing):
 *   DATABASE_URL=... npx tsx scripts/backfill-opening-lines.ts
 *   DATABASE_URL=... npx tsx scripts/backfill-opening-lines.ts --apply
 */
import { neon } from '@neondatabase/serverless';
import { SEED_SCENARIOS } from '../prisma/seed-scenarios';
import { SCENARIO_PACKS } from '../src/lib/scenario-packs';
import {
  planOpeningLineBackfill,
  summarizeBackfill,
  type StoredScenarioRow,
} from './lib/opening-line-backfill';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const url = process.env.DATABASE_URL?.replace(/\r/g, '').trim();
  if (!url) {
    console.error('Missing DATABASE_URL');
    process.exit(1);
  }
  const sql = neon(url);

  const rows = (await sql`
    SELECT
      s.id,
      s.org_id              AS "orgId",
      s.name,
      jt.name               AS "jobTitleName",
      jt.org_id             AS "jobTitleOrgId",
      s.source_pack_id      AS "sourcePackId",
      s.source_scenario_key AS "sourceScenarioKey",
      s.script
    FROM scenarios s
    LEFT JOIN job_titles jt ON jt.id = s.job_title_id
    ORDER BY s.created_at, s.id
  `) as StoredScenarioRow[];

  const decisions = planOpeningLineBackfill(rows, SEED_SCENARIOS, SCENARIO_PACKS);
  console.log(`${apply ? 'APPLY' : 'DRY RUN'} — ${rows.length} scenario row(s) read`);
  console.log(JSON.stringify(summarizeBackfill(decisions)));
  for (const d of decisions) {
    if (d.action === 'no-catalog-match') continue; // org-authored rows: nothing to say
    console.log(`${d.action.padEnd(19)} ${d.id}  ${d.ref ?? ''}${d.openingLine ? `  → ${JSON.stringify(d.openingLine)}` : ''}`);
  }

  if (!apply) {
    console.log('\nDry run only. Re-run with --apply to write the rows marked "fill".');
    return;
  }

  let written = 0;
  for (const d of decisions) {
    if (d.action !== 'fill' || !d.openingLine || d.expectedPersona === undefined) continue;
    const updated = (await sql`
      UPDATE scenarios
      SET script = jsonb_set(script, '{openingLine}', to_jsonb(${d.openingLine}::text), true)
      WHERE id = ${d.id}
        AND COALESCE(btrim(script->>'openingLine'), '') = ''
        AND script->>'customerPersona' = ${d.expectedPersona}
      RETURNING id
    `) as Array<{ id: string }>;
    written += updated.length;
  }
  console.log(`\nWrote openingLine on ${written} row(s).`);
}

main().catch((err: unknown) => {
  console.error('backfill failed:', err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
