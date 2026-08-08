/**
 * Per-tenant monthly Groq-spend ceiling — the enforcement side of #155
 * ("LLM cost is unbounded").
 *
 * Runs 99–102 built the measurement rail: token columns on every CUSTOMER reply
 * (#218), the pure {@link ./cost} price table, and the {@link ./spend} ledger
 * that folds them into per-session / per-tenant Groq spend. Measurement alone
 * does not *bound* anything, though — a tenant (or a compromised account fanning
 * sessions across many trainees) can still run up unlimited org-wide LLM cost.
 * `MAX_SESSIONS_PER_DAY` (`./limits`) caps one user's sessions but not the org's
 * aggregate. This module adds the missing org-level bound.
 *
 * The ceiling is a **cost-protection / runaway guard**, deliberately in the same
 * class as `MAX_SESSIONS_PER_DAY = 100` — a generous engineering limit a real
 * training workload never approaches, set to catch abuse and stuck loops, NOT a
 * pricing decision. A full scored 7-turn session costs a few thousand tokens
 * (fractions of a cent), so a $25/month workspace ceiling clears hundreds of
 * thousands of legitimate sessions before it engages. The wholesale / retail
 * seat *price* remains a founder input (set in Stripe, `./plans`); this ceiling
 * is unrelated to it and is one-line tunable below.
 *
 * Pure, dependency-free (only the pure `./cost` model), Worker-safe: no DB, no
 * network, no Node built-ins — so every threshold rule is unit-tested in
 * isolation and the routes stay thin auth + query shells.
 */

import { computeCostMicroUsd, formatUsd } from './cost';
import type { SeatTierId } from './plans';

/**
 * Monthly org-wide Groq-spend ceiling per seat tier, in **micro-USD** (integer
 * millionths of a dollar — the unit {@link ./cost} carries so aggregation stays
 * exact). Higher tiers unlock costlier modalities (voice/phone), so their
 * ceilings scale up. These are runaway guards, not prices — tune freely.
 *
 *   chat  → $25 / workspace / month
 *   voice → $50
 *   phone → $100
 */
export const MONTHLY_ORG_SPEND_CEILING_MICRO_USD: Readonly<
  Record<SeatTierId, number>
> = {
  chat: 25_000_000,
  voice: 50_000_000,
  phone: 100_000_000,
};

/**
 * Percent of the ceiling at which the workspace is flagged `warn` — an early
 * signal (surfaced on the ADMIN budget report) so an operator can act before a
 * trainee is ever turned away at `over`.
 */
export const BUDGET_WARN_THRESHOLD_PCT = 80 as const;

/** Where the tenant sits against its ceiling. `over` is the block state. */
export type BudgetStatus = 'ok' | 'warn' | 'over';

/** A tenant's month-to-date standing against its seat-tier ceiling. */
export interface BudgetEvaluation {
  tier: SeatTierId;
  /** The tier's monthly ceiling, integer micro-USD. */
  capMicroUsd: number;
  /** Month-to-date priced Groq spend, integer micro-USD (clamped ≥ 0). */
  spentMicroUsd: number;
  /** Headroom left before the ceiling, integer micro-USD (floored at 0). */
  remainingMicroUsd: number;
  /** `spent / cap`, rounded to a whole percent. */
  pctUsed: number;
  /** `ok` < warn threshold, `warn` at/over it, `over` once spend ≥ ceiling. */
  status: BudgetStatus;
  /** The warn threshold used, echoed so the report is self-describing. */
  warnThresholdPct: number;
  /** {@link capMicroUsd} rendered `$0.000000`. */
  cap: string;
  /** {@link spentMicroUsd} rendered `$0.000000`. */
  spent: string;
  /** {@link remainingMicroUsd} rendered `$0.000000`. */
  remaining: string;
}

/** The monthly ceiling for a seat tier, in micro-USD. */
export function ceilingForTier(tier: SeatTierId): number {
  return MONTHLY_ORG_SPEND_CEILING_MICRO_USD[tier];
}

/**
 * Evaluate a tenant's month-to-date `spentMicroUsd` against its `tier` ceiling.
 *
 * A non-finite or negative `spentMicroUsd` (a query hiccup) clamps to `0` rather
 * than throwing — the read path stays informative and the write path fails OPEN
 * (never block a legitimate session on a bad spend read). `over` is reported the
 * instant spend reaches the ceiling (`>=`), so the boundary case blocks rather
 * than admitting one more session.
 */
export function evaluateBudget(
  spentMicroUsd: number,
  tier: SeatTierId,
): BudgetEvaluation {
  const capMicroUsd = ceilingForTier(tier);
  const spent =
    Number.isFinite(spentMicroUsd) && spentMicroUsd > 0
      ? Math.round(spentMicroUsd)
      : 0;
  const pctUsed = capMicroUsd > 0 ? Math.round((spent / capMicroUsd) * 100) : 0;
  const status: BudgetStatus =
    spent >= capMicroUsd
      ? 'over'
      : pctUsed >= BUDGET_WARN_THRESHOLD_PCT
        ? 'warn'
        : 'ok';
  const remainingMicroUsd = Math.max(0, capMicroUsd - spent);
  return {
    tier,
    capMicroUsd,
    spentMicroUsd: spent,
    remainingMicroUsd,
    pctUsed,
    status,
    warnThresholdPct: BUDGET_WARN_THRESHOLD_PCT,
    cap: formatUsd(capMicroUsd),
    spent: formatUsd(spent),
    remaining: formatUsd(remainingMicroUsd),
  };
}

/**
 * One per-`model` token roll-up for a tenant's month-to-date usage, as the
 * budget query returns it (SUM over the CUSTOMER reply rows grouped by the
 * `model` that generated them). `model` is `null` only for pre-instrumentation
 * rows that carry tokens but no model tag.
 */
export interface MonthlySpendGroup {
  model: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** A tenant's rolled-up month-to-date spend across every model it used. */
export interface SpendSummary {
  /** Priced Groq spend, integer micro-USD (unpriceable turns excluded). */
  costMicroUsd: number;
  /** All measured tokens this month (priced + unpriced). */
  totalTokens: number;
  /**
   * Tokens on turns that could NOT be priced (unknown/absent model). Non-zero
   * means {@link costMicroUsd} understates real spend — surfaced, never folded
   * silently into a too-rosy figure (the #155 blind spot).
   */
  unpricedTokens: number;
}

/**
 * Fold the flat per-`model` token groups into a single tenant spend summary.
 * Each priced group adds its micro-USD cost; an un-priceable group's tokens go
 * to {@link SpendSummary.unpricedTokens} and never inflate the cost — the same
 * conservative rule the ledger uses, so the ceiling is compared against the
 * measured floor of real spend. Tolerant of missing numeric fields (treated as
 * `0`) so a partial row can never throw on the write hot path.
 */
export function summarizeSpend(
  groups: readonly MonthlySpendGroup[],
): SpendSummary {
  let costMicroUsd = 0;
  let totalTokens = 0;
  let unpricedTokens = 0;

  for (const g of groups) {
    const prompt = Number.isFinite(g?.promptTokens) ? g.promptTokens : 0;
    const completion = Number.isFinite(g?.completionTokens)
      ? g.completionTokens
      : 0;
    const total = Number.isFinite(g?.totalTokens) ? g.totalTokens : 0;
    totalTokens += total;

    const micro = computeCostMicroUsd(prompt, completion, g?.model);
    if (micro == null) {
      unpricedTokens += total;
    } else {
      costMicroUsd += micro;
    }
  }

  return { costMicroUsd, totalTokens, unpricedTokens };
}
