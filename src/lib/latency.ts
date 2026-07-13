/**
 * Conversation-turn latency instrumentation for the live-customer chat path.
 *
 * Founder signal (2026-07-13, issue #16): the simulator "feels like a half-speed
 * sparring session vs. a real-life simulation." Speed is the product's felt
 * quality, but until now nothing measured it — so a slow turn could be neither
 * monitored nor tuned, and any future model/voice change had no benchmark to beat.
 * This turns a turn's wall-clock into a small, structured, Worker-safe metric:
 * time-to-first-token (the gap a trainee actually perceives before the simulated
 * customer starts "speaking") and total generation time.
 *
 * Pure — no I/O and no `Date.now()` in here: the caller passes already-measured
 * millis so classification stays deterministic and unit-testable. Safe on the
 * Cloudflare Workers runtime.
 */

/** Latency tier a turn falls into, from the trainee's felt-speed perspective. */
export type LatencyTier = 'realtime' | 'acceptable' | 'slow';

/** A single turn's measured conversation latency + its felt-speed tier. */
export interface TurnTiming {
  /** Millis from request-in to the first streamed customer token (perceived gap). */
  ttftMs: number;
  /** Millis from request-in to the last streamed token (full reply generation). */
  totalMs: number;
  /** Felt-speed bucket derived from `ttftMs`. */
  tier: LatencyTier;
}

// Time-to-first-token thresholds (ms). A real phone/chat customer starts
// replying well under a second; past ~2s it reads as the "half-speed" lag the
// founder flagged. One place to retune the felt-speed boundaries.
export const TTFT_REALTIME_MS = 800;
export const TTFT_ACCEPTABLE_MS = 2000;

/** Round to a non-negative integer millisecond. Guards NaN / a skewed clock. */
function normMs(ms: number): number {
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.round(ms);
}

/**
 * Classify a turn's time-to-first-token into a felt-speed tier.
 * `<800ms` reads as real-time; `<2000ms` acceptable; otherwise slow.
 */
export function ttftTier(ttftMs: number): LatencyTier {
  const t = normMs(ttftMs);
  if (t < TTFT_REALTIME_MS) return 'realtime';
  if (t < TTFT_ACCEPTABLE_MS) return 'acceptable';
  return 'slow';
}

/**
 * Build a {@link TurnTiming} from a turn's measured millis. `totalMs` is clamped
 * to be at least `ttftMs` (a full reply can never finish before its first token)
 * so a coarse or skewed clock can't emit an impossible ordering.
 */
export function classifyTurnLatency(ttftMs: number, totalMs: number): TurnTiming {
  const ttft = normMs(ttftMs);
  const total = Math.max(ttft, normMs(totalMs));
  return { ttftMs: ttft, totalMs: total, tier: ttftTier(ttft) };
}
