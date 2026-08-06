/**
 * prune-canary-sessions.mjs — keep the live DB clean of monitor traffic.
 *
 * The scoring canary (phase1-canary.mjs) creates a real simulation_session +
 * scores + chat_messages on the live Neon DB (aged-butterfly-52244878) every
 * time it runs, all owned by the fixed canary user (phase1-canary@xpelevator.internal).
 * Left unbounded, the scheduled monitor would accrete thousands of rows. This
 * prunes the canary user's sessions down to the newest KEEP for debugging.
 *
 * Schema has NO ON DELETE CASCADE, so children (scores, chat_messages) are
 * deleted before their session. Only ever touches rows owned by the canary user.
 *
 * Env: DATABASE_URL.
 */
import { neon } from '@neondatabase/serverless';

const KEEP = 3;
const CANARY_EMAIL = 'phase1-canary@xpelevator.internal';
const DB = process.env.DATABASE_URL?.replace(/\r/g, '');
if (!DB) {
  console.error('Missing DATABASE_URL');
  process.exit(1);
}
const sql = neon(DB);

async function main() {
  const users = await sql`SELECT id FROM users WHERE email = ${CANARY_EMAIL}`;
  if (users.length === 0) {
    console.log('No canary user present — nothing to prune.');
    return;
  }
  const userId = users[0].id;

  // Sessions owned by the canary user, oldest-first beyond the newest KEEP.
  const stale = await sql`
    SELECT id FROM simulation_sessions
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    OFFSET ${KEEP}
  `;
  if (stale.length === 0) {
    console.log(`Canary user has <= ${KEEP} sessions — nothing to prune.`);
    return;
  }
  const ids = stale.map((r) => r.id);
  console.log(`Pruning ${ids.length} stale canary session(s) (keeping newest ${KEEP})...`);

  // Children first (no cascade), then the sessions. Scoped to the id list, which
  // only ever contains canary-owned sessions selected above.
  const delScores = await sql`DELETE FROM scores WHERE session_id = ANY(${ids}) RETURNING id`;
  const delMsgs = await sql`DELETE FROM chat_messages WHERE session_id = ANY(${ids}) RETURNING id`;
  const delSessions = await sql`DELETE FROM simulation_sessions WHERE id = ANY(${ids}) RETURNING id`;

  console.log(
    `Deleted: ${delSessions.length} session(s), ` +
      `${delScores.length} score row(s), ${delMsgs.length} message(s).`,
  );
  console.log('✅ Canary session prune complete.');
}

main().catch((e) => {
  // Pruning is best-effort housekeeping — never fail the monitor over it.
  console.error('prune warning (non-fatal):', e?.stack || String(e));
  process.exit(0);
});
