/**
 * db-backup-and-guard.mjs — Phase 1(c) safety net for `prisma migrate deploy`
 * against the LIVE Neon DB (aged-butterfly-52244878).
 *
 * Runs on the GitHub Actions runner (has DATABASE_URL). Does three things:
 *   1. BACKUP  — dump every public table to ./backup/<table>.json (the dataset is
 *      tiny test data; this is a genuinely restorable snapshot). Version-agnostic
 *      (HTTP driver), so it never trips the pg_dump client/server-version trap.
 *   2. INSPECT — read _prisma_migrations and the actual schema, print a clear
 *      applied-vs-local diff for the run log (the "dry-run" evidence).
 *   3. GUARD   — decide which already-present-but-unrecorded migrations must be
 *      baselined with `prisma migrate resolve --applied` BEFORE deploy, so the two
 *      non-idempotent early migrations (initial, add_org_user_model — they use bare
 *      CREATE TYPE/TABLE) can never destructively re-run against existing schema.
 *      Emits the baseline list to ./baseline.txt for the workflow to act on.
 *
 * Exit codes: 0 = safe to proceed (workflow resolves baseline.txt then deploys);
 *             2 = dirty/failed migration state detected — ABORT, needs a human.
 */
import { neon } from '@neondatabase/serverless';
import { writeFileSync, mkdirSync } from 'node:fs';

const url = process.env.DATABASE_URL?.replace(/\r/g, '');
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(2);
}
const sql = neon(url);

// Local migrations shipped in prisma/migrations (dir name = migration_name).
// `nonIdempotent` ones use bare CREATE TYPE/TABLE and MUST be baselined if their
// schema already exists but they are unrecorded. `schemaProbe` is a table that
// exists iff that migration has been applied.
const LOCAL_MIGRATIONS = [
  { name: '20260219000000_initial', nonIdempotent: true, schemaProbe: 'scenarios' },
  { name: '20260220000000_add_org_user_model', nonIdempotent: true, schemaProbe: 'organizations' },
  { name: '20260222000000_add_voice_type', nonIdempotent: false, schemaProbe: null },
  { name: '20260222020000_add_fk_indexes', nonIdempotent: false, schemaProbe: null },
];

const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

async function tableExists(name) {
  const rows = await sql`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ${name} LIMIT 1
  `;
  return rows.length > 0;
}

async function main() {
  console.log('=== Phase 1(c) DB backup + migration guard ===\n');

  // ── 1. BACKUP every public table ──────────────────────────────────────────
  mkdirSync('backup', { recursive: true });
  const tables = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `;
  console.log(`Backing up ${tables.length} tables ->`);
  let totalRows = 0;
  for (const { table_name } of tables) {
    if (!IDENT.test(table_name)) {
      console.log(`  · skip (unsafe identifier): ${table_name}`);
      continue;
    }
    const rows = await sql.query(`SELECT * FROM "${table_name}"`);
    writeFileSync(`backup/${table_name}.json`, JSON.stringify(rows, null, 2));
    totalRows += rows.length;
    console.log(`  · ${table_name}: ${rows.length} rows`);
  }
  console.log(`Backup complete: ${totalRows} rows across ${tables.length} tables.\n`);

  // ── 2. INSPECT migration history ──────────────────────────────────────────
  const hasMigrationsTable = await tableExists('_prisma_migrations');
  let applied = new Map(); // name -> { finished, rolledBack }
  if (hasMigrationsTable) {
    const rows = await sql`
      SELECT migration_name, finished_at, rolled_back_at
      FROM _prisma_migrations ORDER BY started_at
    `;
    for (const r of rows) {
      applied.set(r.migration_name, {
        finished: r.finished_at != null,
        rolledBack: r.rolled_back_at != null,
      });
    }
  }

  console.log(`_prisma_migrations table present: ${hasMigrationsTable}`);
  console.log('Recorded migrations:');
  if (applied.size === 0) console.log('  (none)');
  for (const [name, st] of applied) {
    console.log(`  · ${name} — finished=${st.finished} rolledBack=${st.rolledBack}`);
  }

  // Abort on a dirty state: a recorded-but-unfinished (failed) migration that
  // was not rolled back. Deploying on top of that corrupts history further.
  const failed = [...applied.entries()].filter(
    ([, st]) => !st.finished && !st.rolledBack
  );
  if (failed.length > 0) {
    console.error(
      `\n✗ ABORT: failed/incomplete migration(s) in _prisma_migrations: ` +
        failed.map(([n]) => n).join(', ') +
        `\n  Needs manual resolution (prisma migrate resolve) before deploy.`
    );
    process.exit(2);
  }

  // ── 3. GUARD: build the baseline list ─────────────────────────────────────
  const baseline = [];
  const pending = [];
  console.log('\nLocal migrations vs DB:');
  for (const m of LOCAL_MIGRATIONS) {
    const isApplied = applied.get(m.name)?.finished === true;
    if (isApplied) {
      console.log(`  · ${m.name} — already applied ✓`);
      continue;
    }
    // Unrecorded. Does its schema already exist?
    let schemaPresent = false;
    if (m.schemaProbe) schemaPresent = await tableExists(m.schemaProbe);
    if (m.nonIdempotent && schemaPresent) {
      baseline.push(m.name);
      console.log(
        `  · ${m.name} — UNRECORDED but schema exists (probe "${m.schemaProbe}") ` +
          `→ will baseline as applied (resolve), NOT re-run`
      );
    } else {
      pending.push(m.name);
      console.log(
        `  · ${m.name} — pending → migrate deploy will apply it` +
          (m.nonIdempotent ? ' (fresh create)' : ' (idempotent)')
      );
    }
  }

  writeFileSync('baseline.txt', baseline.join('\n') + (baseline.length ? '\n' : ''));
  console.log(
    `\nPlan: baseline ${baseline.length} [${baseline.join(', ') || '-'}], ` +
      `deploy ${pending.length} [${pending.join(', ') || '-'}].`
  );
  console.log('Guard OK — safe to proceed.');
}

main().catch((err) => {
  console.error('Guard failed:', err);
  process.exit(2);
});
