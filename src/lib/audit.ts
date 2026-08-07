/**
 * DB-backed audit trail for mutating admin / governance routes.
 *
 * Issue #157 §10 flagged that the governance surface — org rename / re-plan /
 * delete, member add / remove, client-org creation, scenario-pack import — runs
 * with real authz but leaves NO record of who did what. `recordAudit` writes one
 * append-only row per COMPLETED mutation so a later review (an operator, the
 * founder, or an incident responder) can answer "who changed this tenant, and
 * when". The row captures the actor (db user id + an EMAIL SNAPSHOT), the
 * `action`, the target (`targetType`/`targetId`), the tenant (`orgId`), and a
 * small structured `metadata` blob (e.g. the fields that changed).
 *
 * Written to a shared Postgres row via the neon HTTP `sql` client — the same
 * data path the routes already use, authoritative across the many Worker
 * isolates/colos a single account runs (an in-memory log would be per-isolate
 * and lost on eviction — same rationale as src/lib/idempotency.ts and
 * src/lib/rate-limit.ts).
 *
 * Fails OPEN by design: if the write throws (a transient DB blip) the error is
 * logged and swallowed — an audit-write failure must NEVER break a legitimate
 * governance mutation the caller is already authorized to make. The mutation has
 * its own authz; losing one audit row to a DB hiccup is strictly better than
 * 500-ing a valid admin action. The failure is `console.error`-logged so it is
 * observable rather than silent. (A stricter fail-closed posture — refuse the
 * mutation if it cannot be audited — is a deliberate future hardening, not the
 * default at this stage.)
 *
 * RECORD REAL MUTATIONS ONLY: callers invoke `recordAudit` AFTER the write
 * succeeds, and skip it on no-op / dry-run / rejected paths. The audit trail is
 * a log of what actually changed, not of every request that reached a handler.
 */
import { sql as defaultSql } from '@/lib/db';

/** A neon-style tagged-template query function. */
export type SqlClient = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<Array<Record<string, unknown>>>;

/** One governance mutation, as recorded in the `audit_log` table. */
export interface AuditEntry {
  /** Dotted action name, e.g. `org.update`, `member.add`, `pack.import`. */
  action: string;
  /** The acting user's DB id (from `requireAuth` → `session.user.dbUserId`). */
  actorUserId?: string | null;
  /** Snapshot of the actor's email — kept even if the user is later removed. */
  actorEmail?: string | null;
  /** The tenant the mutation touched (target org for governance routes). */
  orgId?: string | null;
  /** The kind of thing changed, e.g. `organization`, `user`, `scenario_pack`. */
  targetType?: string | null;
  /** The specific record's id, e.g. the org id or the invited user's id. */
  targetId?: string | null;
  /** Small structured context (changed fields, counts) — never secrets/PII. */
  metadata?: Record<string, unknown> | null;
}

export interface AuditDeps {
  /** Injectable for tests; defaults to the real neon `sql` client. */
  sql?: SqlClient;
}

/**
 * Append one audit row for a completed governance mutation. Best-effort and
 * fail-open — resolves whether or not the write succeeds, and never throws (see
 * the module header). `metadata` is serialised to JSON and stored in the `jsonb`
 * column; `null`/omitted fields are stored as SQL `NULL`.
 *
 * Usage in a route handler, AFTER the mutation:
 *   await recordAudit({
 *     action: 'org.update',
 *     actorUserId: session.user.dbUserId,
 *     actorEmail: session.user.email,
 *     orgId: id,
 *     targetType: 'organization',
 *     targetId: id,
 *     metadata: { changed: ['plan'], plan: body.plan },
 *   });
 */
export async function recordAudit(
  entry: AuditEntry,
  deps: AuditDeps = {},
): Promise<void> {
  const sql = deps.sql ?? (defaultSql as unknown as SqlClient);
  const metadataJson =
    entry.metadata == null ? null : JSON.stringify(entry.metadata);

  try {
    await sql`
      INSERT INTO audit_log (
        id, action, actor_user_id, actor_email, org_id,
        target_type, target_id, metadata, created_at
      )
      VALUES (
        gen_random_uuid()::text,
        ${entry.action},
        ${entry.actorUserId ?? null},
        ${entry.actorEmail ?? null},
        ${entry.orgId ?? null},
        ${entry.targetType ?? null},
        ${entry.targetId ?? null},
        ${metadataJson}::jsonb,
        NOW()
      )
    `;
  } catch (err) {
    // Fail OPEN — an audit-write failure must not break a valid mutation.
    console.error(`[audit] failed to record "${entry.action}":`, err);
  }
}
