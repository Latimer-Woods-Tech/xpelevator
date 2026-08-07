-- Event-ID idempotency ledger for inbound provider webhooks (Telnyx Call
-- Control, issue #157: "Telnyx retries cause conflicting gather requests on the
-- phone/billing path"). Telnyx delivers AT-LEAST-ONCE, so one event's stable
-- `data.id` can arrive more than once; the `/api/telnyx/webhook` handler returns
-- 200 up-front and works in the background, so a duplicate re-runs the whole
-- handler (racing gather/speak on a live call, a doubled turn, a second score).
--
-- One row per event id: the first delivery INSERTs and runs the handler; every
-- retry hits the PK and is skipped (`ON CONFLICT (event_id) DO NOTHING` in
-- src/lib/idempotency.ts). DB-backed rather than in-memory because Workers run
-- many isolates/colos and a per-isolate Set silently leaks duplicates — the same
-- rationale as api_rate_limits / src/lib/limits.ts. `seen_at` supports later
-- pruning of long-settled events.
CREATE TABLE IF NOT EXISTS "webhook_events" (
  "event_id" TEXT NOT NULL,
  "seen_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("event_id")
);

-- Supports opportunistic pruning of events whose retry window has long passed.
CREATE INDEX IF NOT EXISTS "webhook_events_seen_at_idx"
  ON "webhook_events" ("seen_at");
