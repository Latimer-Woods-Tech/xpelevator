-- Operator→client org hierarchy foundation (issue #16, Phase 4).
--
-- Gives an OPERATOR org the ability to own CLIENT orgs beneath it — the
-- channel/"vending machine" model where operators buy wholesale and manage
-- their own client workspaces. This slice adds ONLY the data-model foundation
-- (kind + self-referential parent link); wholesale billing / Stripe Connect
-- and white-label branding are later, founder-gated slices.
--
-- All changes are additive / nullable → safe on existing data: every current
-- org becomes a STANDALONE tenant with no parent (the default), so no existing
-- row changes meaning. Statements are individually idempotent so the failed-
-- migration recovery path (see #57/#58) can re-apply cleanly.

-- 1. Org kind. STANDALONE = a plain tenant (today's default); OPERATOR = owns
--    client orgs; CLIENT = owned by an operator. `CREATE TYPE` has no IF NOT
--    EXISTS form, so guard it so a re-apply after a rolled-back migration is a
--    no-op rather than a duplicate_object error.
DO $$ BEGIN
  CREATE TYPE "OrgKind" AS ENUM ('STANDALONE', 'OPERATOR', 'CLIENT');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "kind" "OrgKind" NOT NULL DEFAULT 'STANDALONE';

-- 2. Self-referential parent link. A CLIENT org points at its OPERATOR org.
--    ON DELETE RESTRICT: an operator with live clients cannot be silently
--    orphaned — its clients must be removed/reassigned first.
ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "parent_org_id" TEXT;

DO $$ BEGIN
  ALTER TABLE "organizations"
    ADD CONSTRAINT "organizations_parent_org_id_fkey"
    FOREIGN KEY ("parent_org_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "organizations_parent_org_id_idx"
  ON "organizations" ("parent_org_id");
