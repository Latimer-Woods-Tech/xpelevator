-- Query-shape indexes for scale (P3b-3).
-- Analytics + manager reports filter completed sessions by org and order by
-- ended_at; the CSV/PDF export joins users on db_user_id; list endpoints order
-- by created_at. These columns were unindexed, forcing sequential scans that
-- degrade as session volume grows.

CREATE INDEX IF NOT EXISTS "simulation_sessions_org_id_status_ended_at_idx"
  ON "simulation_sessions" ("org_id", "status", "ended_at");

CREATE INDEX IF NOT EXISTS "simulation_sessions_db_user_id_idx"
  ON "simulation_sessions" ("db_user_id");

CREATE INDEX IF NOT EXISTS "simulation_sessions_created_at_idx"
  ON "simulation_sessions" ("created_at");
