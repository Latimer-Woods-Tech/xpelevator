-- Persist per-turn conversation-latency telemetry on the reply (CUSTOMER) message.
--
-- Speed is the product's felt quality (founder, issue #16: a "half-speed sparring
-- session vs a real-life simulation"). R-057/R-058 MEASURE a turn's latency and
-- log it + surface a live badge (R-060), but nothing PERSISTED it — so a slow turn
-- left no historical record to tune against, and any future model/voice change
-- (Phase 5) had no benchmark to beat. This records, per CUSTOMER reply turn:
--   ttft_ms      — time-to-first-token (the gap a trainee perceives)
--   total_ms     — full generation time
--   latency_tier — felt-speed bucket (realtime | acceptable | slow)
--   model        — the model that generated the reply
--   route_reason — why that model was chosen (difficulty->model, R-059)
--
-- Additive + nullable + no default => backward-compatible and lock-cheap
-- (metadata-only on PostgreSQL). Existing rows and every AGENT row stay NULL
-- (pre-instrumentation / not a generated turn).
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "ttft_ms" INTEGER;
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "total_ms" INTEGER;
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "latency_tier" TEXT;
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "model" TEXT;
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "route_reason" TEXT;
