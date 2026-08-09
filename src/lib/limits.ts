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
 * Hard cap on the number of rows a request may pull into the Worker for an
 * in-memory analytics aggregation (P3b-2 — "no LIMIT/OFFSET anywhere").
 *
 * The latency read surface (`GET /api/analytics/latency`) SELECTs every measured
 * reply turn (`chat_messages` rows) in the caller's tenant and computes the
 * percentiles in JS — an O(messages) scan with no upper bound, the largest
 * unbounded query in the app. On a large tenant that materialises every message
 * ever sent into a single Worker isolate (memory + serialisation + a full sort
 * for the percentile), which can OOM or time out the isolate. This bounds the
 * rows *processed in-Worker*; the DB-side scan is a separate concern (query-shape
 * indexes, P3b-3).
 *
 * Deliberately generous — far above any realistic near-term training volume (the
 * scoring canary drives ~7 turns/session; a heavy org is low thousands of turns)
 * — so it never bites real usage and normal responses are byte-identical. It is a
 * runaway guard, not a page size.
 */
export const MAX_ANALYTICS_SCAN_ROWS = 20_000;

/**
 * Bound an in-memory scan to at most `max` rows, reporting whether the source was
 * larger. Callers SELECT `LIMIT max + 1` so a full result set unambiguously
 * signals there was more than `max`; this trims back to `max` and flags it. Pure
 * and deterministic — the truncation decision is unit-testable without a DB.
 *
 * When `rows.length <= max` the input is returned unchanged (a copy) with
 * `truncated: false`, so the common case is a no-op and any aggregate computed
 * over the result is identical to one over the full set.
 */
export function boundScan<T>(
  rows: readonly T[],
  max: number = MAX_ANALYTICS_SCAN_ROWS
): { rows: T[]; truncated: boolean } {
  if (rows.length > max) return { rows: rows.slice(0, max), truncated: true };
  return { rows: rows.slice(), truncated: false };
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

/**
 * `[START]` opens a conversation (the customer's opener). It is a lifecycle
 * signal, not a billable trainee reply. Trims surrounding whitespace; the
 * marker is exact/case-sensitive as the client always emits it verbatim.
 */
export function isStartSignal(content: string): boolean {
  return content.trim() === '[START]';
}

/**
 * `[END]` (or the natural-language "end conversation") terminates a session and
 * triggers scoring. Case-insensitive so a trainee typing the phrase is honored.
 *
 * The `[END]` control token is recognized as a *trailing* marker, so a trainee
 * who closes with real words — e.g. "Thanks for your patience [END]" — still
 * ends the session (previously only a bare `[END]` was honored, so a prose+token
 * closing silently continued the conversation). Use {@link stripEndSignal} to
 * recover the closing prose for the transcript + scoring.
 */
export function isEndSignal(content: string): boolean {
  const t = content.trim();
  return t.toLowerCase() === 'end conversation' || /\[END\]\s*$/i.test(t);
}

/**
 * Removes a trailing `[END]` control token (case-insensitive, with surrounding
 * whitespace) — and the exact natural-language "end conversation" phrase — from a
 * trainee's closing message, returning the residual prose (trimmed). A bare
 * `[END]` or "end conversation" yields `""`. Used so a closing like
 * "Thanks for your patience [END]" is persisted + scored on its words, never the
 * control token, and a bare token contributes no scorable turn.
 */
export function stripEndSignal(content: string): string {
  const t = content.trim();
  if (t.toLowerCase() === 'end conversation') return '';
  return t.replace(/\s*\[END\]\s*$/i, '').trim();
}

/**
 * A session lifecycle control signal (`[START]` or `[END]`), as opposed to a
 * billable trainee turn. These MUST bypass the per-turn throttle
 * (`exceedsTurnRate`): if a trainee — or the Phase-1 scoring canary — ends the
 * session within `MIN_TURN_INTERVAL_MS` of their last reply, throttling `[END]`
 * would 429 the request and the session would never close or score, silently
 * breaking the core-loop acceptance. Neither signal enables abuse: `[START]`
 * only fires while a session is open, and `[END]` moves it to COMPLETED so any
 * further POST returns 400.
 */
export function isControlSignal(content: string): boolean {
  return isStartSignal(content) || isEndSignal(content);
}

/**
 * How many prior conversation messages the simulated customer is given as
 * context on each turn. Every generated turn re-sends the transcript to Groq,
 * so an un-capped history grows the prompt (and therefore token cost AND the
 * per-turn latency the trainee feels — issue #16 founder note "half-speed
 * sparring", #155 P3b-7) as O(turns²) over a long session. This cap bounds the
 * context to a fixed window.
 *
 * Deliberately generous: a real training session is a handful of exchanges
 * (the scoring canary drives ~7), so a typical conversation is shorter than the
 * window and {@link windowConversation} returns it untouched — the cap engages
 * only on pathologically long sessions, where it also caps worst-case latency.
 * The scenario persona / objective / hidden mechanics live in the SYSTEM prompt
 * (`buildSessionSystemPrompt`), not the transcript, so windowing the transcript
 * never drops the customer's character.
 */
export const MAX_CONVERSATION_CONTEXT_MESSAGES = 24;

/**
 * Bounds a conversation transcript to the most recent {@link
 * MAX_CONVERSATION_CONTEXT_MESSAGES} messages before it is sent to the model,
 * killing the O(turns²) token growth of re-sending an ever-longer history.
 *
 * Role-agnostic and purely positional so both hot paths can share it: the chat
 * route passes `{ role: 'CUSTOMER' | 'AGENT' }` history and the phone webhook
 * passes already-Groq-shaped `{ role: 'user' | 'assistant' }` messages. It only
 * ever reads `.content`-carrying elements by index.
 *
 * When the transcript is within the window it is returned unchanged (identical
 * reference-order), so short sessions behave exactly as before. When it is
 * longer, the FIRST message (the customer's opening turn — the anchor of what
 * the conversation is about) is always kept, followed by the last `max - 1`
 * messages, so the model always sees both the opener and the freshest context
 * including the trainee's current reply. Total length never exceeds `max`.
 *
 * @param messages full transcript in chronological order (oldest first)
 * @param max      window size; values < 2 fall back to a plain last-`max` tail
 */
export function windowConversation<T extends { content: string }>(
  messages: readonly T[],
  max: number = MAX_CONVERSATION_CONTEXT_MESSAGES
): T[] {
  if (messages.length <= max) return messages.slice();
  if (max < 2) return messages.slice(Math.max(0, messages.length - Math.max(0, max)));
  // Keep the opener + the freshest (max - 1) messages. Because length > max,
  // index 0 is never inside that tail, so there is no duplication.
  return [messages[0], ...messages.slice(messages.length - (max - 1))];
}
