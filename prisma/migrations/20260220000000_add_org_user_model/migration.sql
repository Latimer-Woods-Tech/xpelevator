-- Migration: Add Organization, User multi-tenant model
-- from diff: Added org, user tables; org_id FK on existing tables; ABANDONED status; UserRole/OrgPlan enums

-- ── New enums ────────────────────────────────────────────────────────────────

CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MEMBER');
CREATE TYPE "OrgPlan"  AS ENUM ('FREE', 'PRO', 'ENTERPRISE');
ALTER TYPE "SessionStatus" ADD VALUE IF NOT EXISTS 'ABANDONED';

-- ── Organizations ────────────────────────────────────────────────────────────

CREATE TABLE "organizations" (
  "id"         TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "name"       TEXT        NOT NULL,
  "slug"       TEXT        NOT NULL,
  "plan"       "OrgPlan"   NOT NULL DEFAULT 'FREE',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- ── Users ────────────────────────────────────────────────────────────────────

CREATE TABLE "users" (
  "id"         TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "org_id"     TEXT,
  "email"      TEXT        NOT NULL,
  "name"       TEXT,
  "role"       "UserRole"  NOT NULL DEFAULT 'MEMBER',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

ALTER TABLE "users"
  ADD CONSTRAINT "users_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Add org_id to existing tables (nullable — no breaking change) ─────────────

ALTER TABLE "job_titles"
  ADD COLUMN "org_id" TEXT;

ALTER TABLE "job_titles"
  ADD CONSTRAINT "job_titles_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "scenarios"
  ADD COLUMN "org_id" TEXT;

ALTER TABLE "scenarios"
  ADD CONSTRAINT "scenarios_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "criteria"
  ADD COLUMN "org_id" TEXT;

ALTER TABLE "criteria"
  ADD CONSTRAINT "criteria_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "simulation_sessions"
  ADD COLUMN "org_id"     TEXT,
  ADD COLUMN "db_user_id" TEXT;

ALTER TABLE "simulation_sessions"
  ADD CONSTRAINT "simulation_sessions_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "simulation_sessions"
  ADD CONSTRAINT "simulation_sessions_db_user_id_fkey"
  FOREIGN KEY ("db_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
