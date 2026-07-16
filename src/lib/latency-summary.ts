/**
 * Pure aggregation for the response-speed read surface (R-067).
 *
 * R-066 made per-turn conversation latency **durable** — every simulated-customer
 * reply persists its `ttft_ms` / `total_ms` / `latency_tier` / `model` /
 * `route_reason` on `chat_messages`. That closed the record-keeping gap the
 * founder's "half-speed sparring session" note (issue #16) exposed, but the
 * number still lived only in the row: no one could *see* how fast the simulator
 * feels across sessions, which model is the slow leg, or whether a hard-scenario
 * realism route is paying off. This turns those stored turns into a small,
 * manager/operator-facing summary — the visible artifact R-066's data was for,
 * and the benchmark any Phase-5 model/voice swap must beat.
 *
 * Kept dependency-free (no DB, no NextAuth, no `Date.now()`) so the route stays a
 * thin auth + query shell and the percentile/aggregation logic is unit-tested in
 * isolation. Worker-safe: no Node built-ins, no `Buffer`.
 *
 * Felt-speed convention matches `@/lib/latency`: the trainee perceives the gap
 * before the customer starts replying (time-to-first-token), so every headline
 * number and the p95 are computed over `ttftMs`. `total_ms` is summarised too
 * (full generation time) but never drives the felt-speed tier.
 */

/** Known felt-speed tiers (mirrors `LatencyTier` in `@/lib/latency`). */
export type SummaryTier = 'realtime' | 'acceptable' | 'slow';

/** One persisted reply turn's telemetry, as read from `chat_messages`. */
export interface LatencyTurn {
  /** Time-to-first-token in ms (the perceived gap). */
  ttftMs: number;
  /** Full reply generation time in ms. */
  totalMs: number;
  /** Stored felt-speed bucket (`latency_tier`); unknown values are ignored. */
  tier: string | null;
  /** Model that generated the reply (`model`), or null on legacy rows. */
  model: string | null;
  /** Why that model was chosen (`route_reason`), or null on legacy rows. */
  routeReason: string | null;
  /**
   * Conversation modality of the owning session (`simulation_sessions.type`:
   * `CHAT` | `VOICE` | `PHONE`), or null when unknown. Lets a manager answer
   * "is voice/phone the slow leg?" from stored data (R-068).
   */
  modality: string | null;
}

/** Per-group (model or route-reason) speed summary. */
export interface LatencyGroupSummary {
  /** The group key (model name or route-reason token); `(unknown)` when null. */
  key: string;
  /** Number of measured turns in the group. */
  turns: number;
  /** Mean time-to-first-token (ms, integer). */
  avgTtftMs: number;
  /** 95th-percentile time-to-first-token (ms, integer, nearest-rank). */
  p95TtftMs: number;
  /** Mean full generation time (ms, integer). */
  avgTotalMs: number;
  /** Share of the group's turns whose stored tier is `slow` (%, 1 decimal). */
  slowPct: number;
}

/** The whole response-speed summary for a tenant. */
export interface LatencySummary {
  /** Total measured reply turns in scope (rows with a numeric `ttft_ms`). */
  measuredTurns: number;
  /** Mean time-to-first-token across all turns (ms), or null when none. */
  avgTtftMs: number | null;
  /** 95th-percentile time-to-first-token (ms), or null when none. */
  p95TtftMs: number | null;
  /** Mean full generation time (ms), or null when none. */
  avgTotalMs: number | null;
  /** Share of all turns whose stored tier is `slow` (%, 1 decimal), or null. */
  slowPct: number | null;
  /** Count of turns per stored felt-speed tier (unknown tiers excluded). */
  tierBreakdown: { realtime: number; acceptable: number; slow: number };
  /** Per-model summaries, most-measured first. */
  byModel: LatencyGroupSummary[];
  /** Per-route-reason summaries, most-measured first. */
  byRouteReason: LatencyGroupSummary[];
  /**
   * Per-modality summaries (`CHAT` | `VOICE` | `PHONE`), most-measured first —
   * the "is voice/phone the slow leg?" split (R-068).
   */
  byModality: LatencyGroupSummary[];
}

const KNOWN_TIERS: readonly SummaryTier[] = ['realtime', 'acceptable', 'slow'];

/** Coerce a value to a finite, non-negative integer millisecond (0 otherwise). */
function normMs(ms: number): number {
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.round(ms);
}

/** Mean of a non-empty numeric array, rounded to an integer. */
function meanInt(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((a, b) => a + b, 0);
  return Math.round(sum / values.length);
}

/**
 * Nearest-rank pth percentile of a numeric sample (integer result).
 *
 * Uses the nearest-rank method: sort ascending, take the value at rank
 * `ceil(p/100 · n)` (1-indexed). Exact — no interpolation — so a tiny sample
 * (n=1) yields that single value rather than an averaged artefact, which is the
 * honest reading for the small session volumes this product runs at today.
 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const frac = Math.min(100, Math.max(0, p)) / 100;
  const rank = Math.ceil(frac * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index];
}

/** Percent (1 decimal) of `count` out of `total`; 0 when `total` is 0. */
function pct(count: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((count / total) * 1000) / 10;
}

/** Summarise one group of turns (a model or a route-reason bucket). */
function summariseGroup(key: string, turns: readonly LatencyTurn[]): LatencyGroupSummary {
  const ttfts = turns.map((t) => normMs(t.ttftMs));
  const totals = turns.map((t) => normMs(t.totalMs));
  const slow = turns.filter((t) => t.tier === 'slow').length;
  return {
    key,
    turns: turns.length,
    avgTtftMs: meanInt(ttfts),
    p95TtftMs: percentile(ttfts, 95),
    avgTotalMs: meanInt(totals),
    slowPct: pct(slow, turns.length),
  };
}

/**
 * Group turns by a key selector, summarise each group, and sort most-measured
 * first (ties broken alphabetically for a stable order). A null/empty key folds
 * into `(unknown)` so legacy pre-R-066 rows never vanish from the totals.
 */
function groupBy(
  turns: readonly LatencyTurn[],
  keyOf: (t: LatencyTurn) => string | null,
): LatencyGroupSummary[] {
  const buckets = new Map<string, LatencyTurn[]>();
  for (const turn of turns) {
    const key = keyOf(turn) || '(unknown)';
    const bucket = buckets.get(key);
    if (bucket) bucket.push(turn);
    else buckets.set(key, [turn]);
  }
  return Array.from(buckets.entries())
    .map(([key, group]) => summariseGroup(key, group))
    .sort((a, b) => b.turns - a.turns || a.key.localeCompare(b.key));
}

/**
 * Build the full {@link LatencySummary} from the persisted reply-turn telemetry.
 *
 * The input is the raw set of measured turns (rows with a numeric `ttft_ms`)
 * already scoped to one tenant by the caller. Turns with an unrecognised
 * `latency_tier` still count toward every average/percentile and their group
 * totals — they are simply omitted from the `tierBreakdown` counts, so the
 * breakdown never over-reports a bucket it can't name.
 */
export function summarizeLatency(turns: readonly LatencyTurn[]): LatencySummary {
  const measuredTurns = turns.length;
  if (measuredTurns === 0) {
    return {
      measuredTurns: 0,
      avgTtftMs: null,
      p95TtftMs: null,
      avgTotalMs: null,
      slowPct: null,
      tierBreakdown: { realtime: 0, acceptable: 0, slow: 0 },
      byModel: [],
      byRouteReason: [],
      byModality: [],
    };
  }

  const ttfts = turns.map((t) => normMs(t.ttftMs));
  const totals = turns.map((t) => normMs(t.totalMs));

  const tierBreakdown = { realtime: 0, acceptable: 0, slow: 0 };
  for (const turn of turns) {
    if (turn.tier && (KNOWN_TIERS as readonly string[]).includes(turn.tier)) {
      tierBreakdown[turn.tier as SummaryTier] += 1;
    }
  }

  const slow = turns.filter((t) => t.tier === 'slow').length;

  return {
    measuredTurns,
    avgTtftMs: meanInt(ttfts),
    p95TtftMs: percentile(ttfts, 95),
    avgTotalMs: meanInt(totals),
    slowPct: pct(slow, measuredTurns),
    tierBreakdown,
    byModel: groupBy(turns, (t) => t.model),
    byRouteReason: groupBy(turns, (t) => t.routeReason),
    byModality: groupBy(turns, (t) => t.modality),
  };
}
