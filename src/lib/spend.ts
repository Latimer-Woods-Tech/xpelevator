/**
 * Pure per-session / per-tenant LLM spend ledger (#155).
 *
 * The token columns (#218) and the cost model ({@link ./cost}) give the two raw
 * ingredients; this module folds them into the artifact the Phase-4 wholesale-
 * seat margin actually needs: what each trainee session cost in Groq spend, and
 * what the tenant spent in total over the report window.
 *
 * Input is the flat, per-`(session, model)` token roll-up the DB returns (one
 * row per model used in a session — a session can span both the fast and the
 * realism model as difficulty varies mid-conversation). Kept dependency-free
 * (no DB, no NextAuth) so the `/api/reports/spend` route stays a thin auth +
 * query shell and every aggregation/rounding rule is unit-tested in isolation —
 * the same split as `@/lib/report`.
 *
 * The first consumer of {@link ./cost} (Standing Law 4: a new primitive lands
 * with its consumer wired in the same change).
 */

import {
  computeCostMicroUsd,
  isPricedModel,
  formatUsd,
  PRICING_AS_OF,
  PRICING_SOURCE,
  GROQ_PRICES,
} from './cost';

/**
 * One `(session, model)` token roll-up as returned by the spend query — the
 * SUM of the per-turn `usage` across every CUSTOMER reply in that session that
 * ran on that model. `model` is `null` only for pre-instrumentation rows that
 * carry tokens but no model tag (treated as unpriced).
 */
export interface SpendTurnGroup {
  sessionId: string;
  trainee: string | null;
  scenario: string | null;
  createdAt: string | Date | null;
  model: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** How many CUSTOMER reply turns this group aggregates. */
  turns: number;
}

/** A single session's rolled-up spend across all the models it used. */
export interface SessionSpend {
  sessionId: string;
  date: string;
  trainee: string;
  scenario: string;
  turns: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Priced Groq spend for the session, integer micro-USD. */
  costMicroUsd: number;
  /** {@link costMicroUsd} rendered as a `$0.000000` string. */
  cost: string;
  /**
   * Tokens on turns that could NOT be priced (unknown/absent model). Non-zero
   * means {@link costMicroUsd} understates real spend — surfaced so the gap is
   * visible rather than silently folded into a too-rosy margin.
   */
  unpricedTokens: number;
}

/** The tenant-wide totals row for the ledger. */
export interface SpendTotals {
  sessions: number;
  turns: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costMicroUsd: number;
  cost: string;
  unpricedTokens: number;
}

/** Price-table provenance echoed on the ledger so a stale table is visible. */
export interface SpendPricing {
  source: string;
  asOf: string;
  models: Array<{
    model: string;
    inputPerMillion: number;
    outputPerMillion: number;
  }>;
}

/** The full spend ledger: per-session detail + tenant totals + pricing basis. */
export interface SpendLedger {
  sessions: SessionSpend[];
  totals: SpendTotals;
  pricing: SpendPricing;
}

/** Normalise a group's date to an ISO `YYYY-MM-DD` day (empty when unknown). */
function groupDate(createdAt: string | Date | null): string {
  if (createdAt == null) return '';
  const d = createdAt instanceof Date ? createdAt : new Date(createdAt);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/**
 * Fold the flat `(session, model)` groups into a spend ledger. Groups are
 * bucketed by `sessionId`; within a session every model's tokens sum and each
 * priced group's micro-USD cost adds in, while any unpriced group's tokens go
 * to `unpricedTokens` (never to cost). The tenant totals pool the same figures
 * across all sessions. Session order follows first appearance of each session
 * in the input (the query orders newest-first), so the ledger is stable.
 */
export function buildSpendLedger(
  groups: readonly SpendTurnGroup[],
): SpendLedger {
  const bySession = new Map<string, SessionSpend>();

  for (const g of groups) {
    let s = bySession.get(g.sessionId);
    if (!s) {
      s = {
        sessionId: g.sessionId,
        date: groupDate(g.createdAt),
        trainee: g.trainee ?? '(unknown)',
        scenario: g.scenario ?? '',
        turns: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        costMicroUsd: 0,
        cost: '',
        unpricedTokens: 0,
      };
      bySession.set(g.sessionId, s);
    }

    s.turns += g.turns;
    s.promptTokens += g.promptTokens;
    s.completionTokens += g.completionTokens;
    s.totalTokens += g.totalTokens;

    const micro = computeCostMicroUsd(
      g.promptTokens,
      g.completionTokens,
      g.model,
    );
    if (micro == null || !isPricedModel(g.model)) {
      // Unknown/absent model, or otherwise un-priceable: count the tokens as
      // unpriced so the margin never silently treats them as free spend.
      s.unpricedTokens += g.totalTokens;
    } else {
      s.costMicroUsd += micro;
    }
  }

  const sessions = [...bySession.values()];
  for (const s of sessions) s.cost = formatUsd(s.costMicroUsd);

  const totals: SpendTotals = {
    sessions: sessions.length,
    turns: sessions.reduce((n, s) => n + s.turns, 0),
    promptTokens: sessions.reduce((n, s) => n + s.promptTokens, 0),
    completionTokens: sessions.reduce((n, s) => n + s.completionTokens, 0),
    totalTokens: sessions.reduce((n, s) => n + s.totalTokens, 0),
    costMicroUsd: sessions.reduce((n, s) => n + s.costMicroUsd, 0),
    cost: '',
    unpricedTokens: sessions.reduce((n, s) => n + s.unpricedTokens, 0),
  };
  totals.cost = formatUsd(totals.costMicroUsd);

  const pricing: SpendPricing = {
    source: PRICING_SOURCE,
    asOf: PRICING_AS_OF,
    models: Object.entries(GROQ_PRICES).map(([model, p]) => ({
      model,
      inputPerMillion: p.inputPerMillion,
      outputPerMillion: p.outputPerMillion,
    })),
  };

  return { sessions, totals, pricing };
}
