-- White-label operator branding (issue #16, Phase 4, R-044).
--
-- Lets an OPERATOR org present its own brand (name / logo / colors) so the
-- workspace it hands a client looks like the operator's product, not the
-- platform's. This slice adds ONLY the branding data-model + admin management
-- API; the operator subdomain and the client-facing render surface are later
-- slices that build on these columns.
--
-- All changes are additive / nullable → safe on existing data: every current
-- org keeps NULL branding and falls back to the platform default, so no
-- existing row changes meaning. Statements are individually idempotent
-- (`ADD COLUMN IF NOT EXISTS`) so the failed-migration recovery path (see
-- #57/#58) can re-apply cleanly.

-- Display name shown in place of the platform name (falls back to `name` when
-- NULL — `name` stays the canonical internal identifier).
ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "brand_display_name" TEXT;

-- Logo URL. Validated to https-only + length-capped at the API layer
-- (`src/lib/branding.ts`) before it is ever written here.
ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "brand_logo_url" TEXT;

-- Primary + accent brand colors, stored as normalized lowercase `#rrggbb`
-- (validated/normalized at the API layer).
ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "brand_primary_color" TEXT;

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "brand_accent_color" TEXT;
