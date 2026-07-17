/**
 * Abuse / cost-control limits for the conversation hot path.
 *
 * Every simulated-customer turn is a billable LLM call, and there is no other
 * throttle in front of Groq — without these caps a single client (or a stuck
 * retry loop) can exhaust the org-wide token budget and starve every tenant.
 * Values are deliberately generous: they should never be felt by a real
 * trainee, only by scripts.
 *
 * These are per-isolate-safe because they are enforced against DB state
 * (message timestamps, session counts), not in-memory counters — Workers run
 * many isolates and in-memory rate limiting silently under-counts. Pure
 * helpers live here so they are unit-testable; routes supply the DB values.
 */

/** Longest single trainee chat message. Real replies are sentences, not essays. */
export const MAX_AGENT_MESSAGE_CHARS = 2_000;

/**
 * Minimum spacing between trainee turns in one session. A human cannot read a
 * customer reply and answer in under a second; scripts can. Kept small enough
 * that clock skew between the DB and the Worker never bites a real user.
 */
export const MIN_TURN_INTERVAL_MS = 1_500;

/** Sessions one user may create per rolling 24h. ~10× a heavy training day. */
export const MAX_SESSIONS_PER_DAY = 100;

/** Default and hard-max page size for list endpoints (P3b-2). */
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

/**
 * Bounded pagination from a query string. `limit` is clamped to
 * [1, MAX_PAGE_SIZE] (default DEFAULT_PAGE_SIZE); `offset` floors at 0. Invalid
 * or absent values fall back to the defaults, so a list endpoint can never be
 * coerced into an unbounded scan. Pure — routes pass `new URL(req.url).searchParams`.
 */
export function parsePagination(params: URLSearchParams): { limit: number; offset: number } {
  const rawLimit = parseInt(params.get('limit') ?? '', 10);
  const rawOffset = parseInt(params.get('offset') ?? '', 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(MAX_PAGE_SIZE, Math.max(1, rawLimit))
    : DEFAULT_PAGE_SIZE;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, rawOffset) : 0;
  return { limit, offset };
}

/**
 * Whether a new trainee turn arrives too soon after the previous one.
 * `lastAgentTimestamp` is the DB timestamp of the caller's most recent message
 * in this session (null/undefined when this is the first turn).
 */
export function exceedsTurnRate(
  lastAgentTimestamp: string | Date | null | undefined,
  nowMs: number
): boolean {
  if (lastAgentTimestamp == null) return false;
  const last =
    lastAgentTimestamp instanceof Date
      ? lastAgentTimestamp.getTime()
      : Date.parse(lastAgentTimestamp);
  if (Number.isNaN(last)) return false;
  return nowMs - last < MIN_TURN_INTERVAL_MS;
}
