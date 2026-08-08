-- Persist per-turn Groq token usage on the reply (CUSTOMER) message.
--
-- LLM cost is currently UNMEASURED (issue #155: "LLM cost is unbounded ... no
-- token accounting, no spend ledger"). Every conversational turn is a billable
-- Groq completion, but nothing recorded how many tokens it burned -- so the
-- Phase-4 wholesale-seat margin (wholesale price minus Groq spend, #16) rests on
-- an unknown. Groq returns a `usage` block on both the non-streaming (phone) and
-- streaming (chat, via stream_options.include_usage) responses; this records it
-- per CUSTOMER reply turn, beside the R-066/R-070 latency telemetry:
--   prompt_tokens     -- context tokens sent (grows with transcript window)
--   completion_tokens -- tokens generated for the reply
--   total_tokens      -- prompt + completion (what Groq bills on)
--
-- Additive + nullable + no default => backward-compatible and lock-cheap
-- (metadata-only on PostgreSQL). Existing rows, every AGENT row, and any turn
-- where the model errored before returning usage stay NULL.
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "prompt_tokens" INTEGER;
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "completion_tokens" INTEGER;
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "total_tokens" INTEGER;
