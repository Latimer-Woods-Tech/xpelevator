-- Pack-import provenance + org-scoped role uniqueness.
--
-- Enables the admin "import starter pack → org" action (issue #16, Phase 4:
-- starter scenario-library packs) to be IDEMPOTENT and VERSIONED, and fixes the
-- multi-tenant blocker where `job_titles.name` was GLOBALLY unique — two client
-- orgs could never hold the same role (e.g. both importing "SaaS Support
-- Specialist"), which the whole operator→client model requires.
--
-- All changes are additive / constraint-relaxing and safe on existing data:
--   * new columns are nullable with no default (metadata-only, lock-cheap);
--   * existing rows are already globally unique by name, so they remain unique
--     under the new, narrower org-scoped indexes.

-- 1. Provenance columns. `source_pack_id` / `source_scenario_key` are the
--    import idempotency keys; `pack_version` stamps which catalog version a row
--    came from so drift from an improved public pack is detectable later.
ALTER TABLE "job_titles" ADD COLUMN IF NOT EXISTS "source_pack_id" TEXT;
ALTER TABLE "job_titles" ADD COLUMN IF NOT EXISTS "pack_version" INTEGER;
ALTER TABLE "scenarios"  ADD COLUMN IF NOT EXISTS "source_pack_id" TEXT;
ALTER TABLE "scenarios"  ADD COLUMN IF NOT EXISTS "source_scenario_key" TEXT;
ALTER TABLE "scenarios"  ADD COLUMN IF NOT EXISTS "pack_version" INTEGER;

-- 2. Relax the global unique on `job_titles.name` → org-scoped. Two portable
--    partial indexes (no PG15 `NULLS NOT DISTINCT` dependency):
--      * org-scoped roles are unique per (org_id, name);
--      * legacy global roles (org_id IS NULL) stay unique by name.
--    The live DB backs `job_titles_name_key` with a UNIQUE CONSTRAINT (not a
--    bare index), so drop the constraint (which removes its backing index);
--    the DROP INDEX fallback covers environments where it is a plain index.
ALTER TABLE "job_titles" DROP CONSTRAINT IF EXISTS "job_titles_name_key";
DROP INDEX IF EXISTS "job_titles_name_key";
CREATE UNIQUE INDEX IF NOT EXISTS "job_titles_org_name_key"
  ON "job_titles" ("org_id", "name") WHERE "org_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "job_titles_global_name_key"
  ON "job_titles" ("name") WHERE "org_id" IS NULL;

-- 3. Idempotency key for pack-imported scenarios. Partial (only pack-sourced,
--    tenant-scoped rows) so hand-authored scenarios are unaffected. Re-importing
--    a pack into the same org conflicts here and is skipped (ON CONFLICT DO
--    NOTHING in the import route) — no duplicates, no clobber.
CREATE UNIQUE INDEX IF NOT EXISTS "scenarios_org_pack_scenario_key"
  ON "scenarios" ("org_id", "source_pack_id", "source_scenario_key")
  WHERE "source_pack_id" IS NOT NULL AND "org_id" IS NOT NULL;
