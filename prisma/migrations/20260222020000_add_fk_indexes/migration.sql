-- Add indexes on foreign key columns that PostgreSQL does not auto-index.
-- Improves query performance for transcript lookups, score aggregation,
-- and session filtering by user / job title / org.
--
-- Safe to run multiple times (IF NOT EXISTS).

CREATE INDEX IF NOT EXISTS "chat_messages_session_id_idx"
  ON "chat_messages" ("session_id");

CREATE INDEX IF NOT EXISTS "scores_session_id_idx"
  ON "scores" ("session_id");

CREATE INDEX IF NOT EXISTS "scores_criteria_id_idx"
  ON "scores" ("criteria_id");

CREATE INDEX IF NOT EXISTS "simulation_sessions_user_id_idx"
  ON "simulation_sessions" ("user_id");

CREATE INDEX IF NOT EXISTS "simulation_sessions_job_title_id_idx"
  ON "simulation_sessions" ("job_title_id");

CREATE INDEX IF NOT EXISTS "simulation_sessions_org_id_idx"
  ON "simulation_sessions" ("org_id");
