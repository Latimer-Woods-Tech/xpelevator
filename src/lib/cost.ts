/**
 * Groq LLM cost model — the price side of the per-turn token ledger (#155).
 *
 * Run 99/100 (#218/#219) began persisting Groq's `usage` block on every CUSTOMER
 * reply row (`chat_messages.prompt_tokens|completion_tokens|total_tokens`, beside
 * the `model` that generated it). Raw tokens alone are not a margin number — a
 * prompt token on the 8B model is ~12× cheaper than an output token on the 70B
 * model. This module turns `(promptTokens, completionTokens, model)` into a
 * cost, so the Phase-4 wholesale-seat margin (`wholesale price − Groq spend`) is
 * a measured figure instead of a guess.
 *
 * Pure, dependency-free, Worker-safe: no DB, no network, no Node built-ins, no
 * `Buffer` — just a price table and integer arithmetic, so it runs identically
 * in the OpenNext worker, Node, and vitest.
 *
 * Costs are carried in **micro-USD** (integer millionths of a dollar) to keep
 * aggregation exact — summing thousands of tiny per-turn floats would drift, so
 * every turn rounds to an integer micro-USD once and totals stay whole. Format
 * for display only at the edge with {@link formatUsd}.
 */

/** Per-model on-demand price, in USD per 1,000,000 tokens (Groq list price). */
export interface ModelPrice {
  /** USD per 1M input (prompt/context) tokens. */
  inputPerMillion: number;
  /** USD per 1M output (completion) tokens. */
  outputPerMillion: number;
}

/**
 * When this price table was last reconciled against Groq's published on-demand
 * pricing. Surfaced on the ledger response so a stale table is visible, not
 * silent — list prices drift, and a wrong price quietly skews the margin.
 */
export const PRICING_AS_OF = '2026-08-08' as const;

/** Human-readable provenance for the price table (shown on the ledger). */
export const PRICING_SOURCE =
  'Groq on-demand list pricing (USD per 1M tokens)';

/**
 * The two Groq models this app actually calls on the token-bearing hot paths
 * (`src/lib/ai.ts`): the fast 8B model for easy/medium live customer turns and
 * the 70B realism model for hard turns. Keyed by the exact `model` string
 * persisted on the reply row, so a lookup is a direct match with no normalising.
 *
 * Prices are Groq's published on-demand rates as of {@link PRICING_AS_OF}. They
 * are deliberately data (not code) so a price change or a founder-negotiated
 * rate is a one-line edit; an unknown/added model is handled explicitly by
 * {@link computeCostMicroUsd} returning `null` rather than a wrong zero.
 */
export const GROQ_PRICES: Readonly<Record<string, ModelPrice>> = {
  // Fast tier — easy/medium live customer turns (CUSTOMER_MODEL_FAST).
  'llama-3.1-8b-instant': { inputPerMillion: 0.05, outputPerMillion: 0.08 },
  // Realism tier — hard live turns + scoring (CUSTOMER_MODEL_REALISM).
  'llama-3.3-70b-versatile': { inputPerMillion: 0.59, outputPerMillion: 0.79 },
};

/** True for a finite, non-negative integer-or-float token count. */
function isValidTokenCount(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

/**
 * Cost of one turn in **micro-USD** (integer), or `null` when it cannot be
 * priced — an unknown/absent `model`, or a token count that is null, negative,
 * NaN, or non-numeric. Returning `null` (never `0`) is the load-bearing choice:
 * an un-priceable turn must surface as *unpriced tokens* in the ledger, not
 * silently count as free spend and overstate the margin — exactly the blind
 * spot #155 exists to close.
 *
 * A USD-per-1M-tokens rate equals that same number in micro-USD per token
 * ($1 = 1e6 micro-USD; per-1M ÷ 1e6 tokens cancels the 1e6), so the arithmetic
 * is just `prompt·inputPerMillion + completion·outputPerMillion`, rounded once.
 */
export function computeCostMicroUsd(
  promptTokens: number | null | undefined,
  completionTokens: number | null | undefined,
  model: string | null | undefined,
): number | null {
  if (!model) return null;
  const price = GROQ_PRICES[model];
  if (!price) return null;
  if (!isValidTokenCount(promptTokens) || !isValidTokenCount(completionTokens)) {
    return null;
  }
  const micro =
    promptTokens * price.inputPerMillion +
    completionTokens * price.outputPerMillion;
  return Math.round(micro);
}

/** Whether a model string has a price in the table (so its tokens are priceable). */
export function isPricedModel(model: string | null | undefined): boolean {
  return !!model && model in GROQ_PRICES;
}

/**
 * Render an integer micro-USD amount as a fixed `$0.000000` USD string
 * (6 decimals — micro-USD resolution). Per-turn Groq spend is fractions of a
 * cent, so the usual 2-decimal money format would round every real number to
 * `$0.00`; 6 decimals keeps the ledger legible without losing the signal.
 */
export function formatUsd(microUsd: number): string {
  const usd = microUsd / 1_000_000;
  const sign = usd < 0 ? '-' : '';
  return `${sign}$${Math.abs(usd).toFixed(6)}`;
}
