-- Append-only audit trail for mutating admin/governance routes (issue #157 §10:
-- "no audit log on mutating admin routes (org/member/plan/pack mutations)").
-- One row per completed governance mutation — who (actor id + email snapshot),
-- what (`action`, e.g. `org.update`), against which target (`target_type` +
-- `target_id`), in which tenant (`org_id`), plus a small structured `metadata`
-- blob (e.g. the fields that changed). Written best-effort AFTER the mutation
-- succeeds by src/lib/audit.ts; a no-op request writes nothing.
--
-- Deliberately DENORMALISED and FK-FREE: an audit row must OUTLIVE the org or
-- user it describes — the `org.delete` record is worthless if a cascade removes
-- it with the org, and an actor's row must survive the actor being removed from
-- a tenant. So `actor_email` is a snapshot (not a join), and there are NO
-- foreign keys to `organizations`/`users`. Append-only: nothing in the app
-- updates or deletes these rows (a retention/pruning policy is a separate,
-- founder-gated follow-on tracked in issue #157 §10 / docs/PII_INVENTORY.md).
CREATE TABLE IF NOT EXISTS "audit_log" (
  "id"            TEXT NOT NULL,
  "action"        TEXT NOT NULL,
  "actor_user_id" TEXT,
  "actor_email"   TEXT,
  "org_id"        TEXT,
  "target_type"   TEXT,
  "target_id"     TEXT,
  "metadata"      JSONB,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- Tenant-scoped, time-ordered reads ("show org X's recent governance events").
CREATE INDEX IF NOT EXISTS "audit_log_org_id_created_at_idx"
  ON "audit_log" ("org_id", "created_at");

-- Action-scoped, time-ordered reads ("every plan change platform-wide").
CREATE INDEX IF NOT EXISTS "audit_log_action_created_at_idx"
  ON "audit_log" ("action", "created_at");
