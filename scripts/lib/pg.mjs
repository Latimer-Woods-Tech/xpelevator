// ── Postgres client for CI / ops scripts ────────────────────────────────────
//
// WHY THIS EXISTS
// #84 cut the application over from Neon to the self-hosted OCI Postgres, but
// only rewrote the *app* driver (src/lib/db.ts). Every script under scripts/**
// still spoke `neon()` from @neondatabase/serverless, which is not a Postgres
// driver at all — it POSTs SQL to Neon's HTTPS API. That protocol is Neon-only
// and is not served by OCI, so the moment DATABASE_URL pointed at OCI all eight
// DB-touching deploy steps would have failed. This module is the missing half
// of the cutover.
//
// WHY A DIRECT CONNECTION (and not Hyperdrive)
// These scripts run on a GitHub Actions runner — real Node, real TCP — so they
// connect straight to Postgres. Hyperdrive is only required for the app, which
// runs on Workers/Pages where a direct TCP upgrade hangs (see src/lib/db.ts).
// Do not "fix" this by routing scripts through Hyperdrive; it is not reachable
// from a runner.
//
// The exported `sql` is a tagged template that returns a rows array, which is
// the same shape `neon()` returned — so every existing call site is unchanged.
import postgres from 'postgres';

// Strip CR chars that appear when a secret was stored with CRLF endings.
const url = process.env.DATABASE_URL?.replace(/\r/g, '');

// Constructed eagerly but connected LAZILY (postgres.js dials on first query),
// so callers keep their own DATABASE_URL guards and their own exit codes — this
// module must never be the thing that decides how a missing URL is reported.
export const sql = postgres(url ?? '', {
  max: 1,
  // Scripts that signal failure via `process.exitCode` rely on the event loop
  // draining to exit. A pooled connection would hold it open forever, so let an
  // idle socket close itself and allow a natural exit.
  idle_timeout: 3,
  connect_timeout: 15,
  // Migrations emit NOTICEs (e.g. "relation already exists, skipping"); they are
  // not script output and would corrupt the machine-readable stdout some of
  // these gates produce.
  onnotice: () => {},
});

/** Close the pool explicitly. Safe to call more than once. */
export const closeDb = () => sql.end({ timeout: 5 }).catch(() => {});

export default sql;
