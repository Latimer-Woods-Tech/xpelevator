-- Fixed-window IP rate-limit counters for the ANONYMOUS public routes
-- (issue #157: "No rate limiting on any public route ... existence-oracle
-- enumeration on [slug]"). One row per (route, ip-hash, time-window); the
-- window index is baked into the primary key so a new window is a new row and
-- expired rows are simply abandoned (see `expires_at` for later pruning).
--
-- DB-backed on purpose: Workers run many isolates/colos, so an in-memory
-- counter under-counts and silently leaks the limit. Enforcing against a shared
-- Postgres row is the same rationale already documented in src/lib/limits.ts.
CREATE TABLE IF NOT EXISTS "api_rate_limits" (
  "bucket"     TEXT NOT NULL,
  "count"      INTEGER NOT NULL DEFAULT 0,
  "expires_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "api_rate_limits_pkey" PRIMARY KEY ("bucket")
);

-- Supports opportunistic pruning of windows that have rolled over.
CREATE INDEX IF NOT EXISTS "api_rate_limits_expires_at_idx"
  ON "api_rate_limits" ("expires_at");
