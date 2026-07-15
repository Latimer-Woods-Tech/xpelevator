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

/**
 * Latency of a single Telnyx phone turn, from the trainee's felt-speed view.
 *
 * The phone path differs from chat (R-057): the model call is **non-streaming**,
 * so there is no token-level time-to-first-token to perceive. The gap the trainee
 * actually feels after they stop speaking is the whole server-controllable leg —
 * the final STT transcript arrives, the model generates a reply, and that reply is
 * dispatched to Telnyx TTS. The customer cannot start speaking until that dispatch,
 * so the felt-speed tier is derived from `speakDispatchMs`, not `replyReadyMs`.
 *
 * The provider-internal legs (Telnyx STT synthesis and TTS time-to-first-audio)
 * are not observable server-side; this measures the leg we own and can tune.
 */
export interface PhoneTurnTiming {
  /** Millis from the final STT transcript to the model's reply being ready. */
  replyReadyMs: number;
  /**
   * Millis from the final STT transcript to the reply being dispatched to TTS —
   * the full server-controllable gap before the simulated customer can speak.
   */
  speakDispatchMs: number;
  /** Felt-speed bucket derived from `speakDispatchMs` (the perceived gap). */
  tier: LatencyTier;
}

/**
 * Classify a Telnyx phone turn from its measured millis. `speakDispatchMs` is
 * clamped to be at least `replyReadyMs` (audio can't dispatch before the reply
 * exists), and the tier reflects the full dispatch gap the trainee waits through.
 */
export function classifyPhoneTurn(replyReadyMs: number, speakDispatchMs: number): PhoneTurnTiming {
  const base = classifyTurnLatency(replyReadyMs, speakDispatchMs);
  return {
    replyReadyMs: base.ttftMs,
    speakDispatchMs: base.totalMs,
    tier: ttftTier(base.totalMs),
  };
}

/**
 * A turn's felt-speed rendered for a human: a short label + a compact timing
 * detail. Pure and runtime-agnostic so the chat UI can surface the same speed
 * the `[chat] latency` log measures (R-057) — the number the founder's
 * "half-speed" note is about, now felt by the trainee instead of hidden in logs.
 */
export interface LatencyBadge {
  /** Felt-speed bucket, drives the badge colour in the UI. */
  tier: LatencyTier;
  /** Short felt-speed label, e.g. "Real-time". */
  label: string;
  /** Compact timing detail, e.g. "0.1s to first reply". */
  detail: string;
}

/** Trainee-facing label for a felt-speed tier (no vendor/craft-vocabulary terms). */
export function describeLatencyTier(tier: LatencyTier): string {
  switch (tier) {
    case 'realtime':
      return 'Real-time';
    case 'acceptable':
      return 'Responsive';
    case 'slow':
      return 'Slow';
  }
}

/** Build a human-facing {@link LatencyBadge} from a measured {@link TurnTiming}. */
export function latencyBadge(timing: TurnTiming): LatencyBadge {
  return {
    tier: timing.tier,
    label: describeLatencyTier(timing.tier),
    detail: `${(timing.ttftMs / 1000).toFixed(1)}s to first reply`,
  };
}

/**
 * The routing decision that selected a turn's customer model, as a stable,
 * low-cardinality token for telemetry (R-066). The customer model is picked by
 * scenario difficulty (R-059): a `hard` scenario keeps the higher-realism model
 * (de-escalation realism is the differentiator there); everything else uses the
 * ~3× faster model so the reply streams closer to real-time. Persisting *why* a
 * turn ran on a given model lets a slow row explain itself — "a hard scenario
 * paying the realism cost" vs. an unexpected regression — instead of leaving the
 * model choice unexplained next to the number. Pure and Worker-safe; the mapping
 * mirrors {@link classifyTurnLatency}'s caller so the token can never disagree
 * with the model actually used (anything but `hard` routes to the fast model).
 */
export function routeReasonForDifficulty(difficulty: string): string {
  return difficulty === 'hard'
    ? 'difficulty=hard→realism'
    : `difficulty=${difficulty}→fast`;
}
