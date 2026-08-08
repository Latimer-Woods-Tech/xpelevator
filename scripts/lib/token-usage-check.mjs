/**
 * token-usage-check.mjs — pure predicate for the scoring canary's per-turn
 * token-usage live gate (R-132, #155).
 *
 * Run 99 (#218) shipped per-CUSTOMER-reply Groq token accounting
 * (prompt/completion/total tokens on the reply row), backed by unit tests that
 * prove the WRITE path. What those tests can't prove is that usage actually
 * POPULATES on the live deploy — Groq must return the `usage` block (it only
 * does with `stream_options.include_usage`), the Worker must persist it, and no
 * column rename / dropped block can silently null it. A silent null there is
 * expensive: the Phase-4 wholesale-seat margin (wholesale price − Groq spend)
 * rests on this number.
 *
 * This predicate is the thing the canary asserts, extracted so the live gate
 * carries its own proof-of-rejection unit test (Standing Law 1): the same
 * function that turns the canary red is exercised with a no-usage row set to
 * prove it rejects.
 */

/** A row carries usable usage when total_tokens is a positive finite number. */
export function rowHasTokenUsage(row) {
  return (
    row != null &&
    typeof row.totalTokens === 'number' &&
    Number.isFinite(row.totalTokens) &&
    row.totalTokens > 0
  );
}

/**
 * Evaluate the CUSTOMER reply rows of one driven session.
 * @param {Array<{totalTokens?: unknown}>} customerRows
 * @returns {{ok: boolean, reason: string|null, withTokens: number, total: number}}
 *   ok=false with a reason is the regression signal (no row carries usage).
 */
export function evaluateTokenUsage(customerRows) {
  const rows = Array.isArray(customerRows) ? customerRows : [];
  if (rows.length === 0) {
    return {
      ok: false,
      reason: 'no CUSTOMER reply rows persisted for the session — cannot verify token usage',
      withTokens: 0,
      total: 0,
    };
  }
  const withTokens = rows.filter(rowHasTokenUsage);
  if (withTokens.length === 0) {
    return {
      ok: false,
      reason:
        'CUSTOMER reply rows present but NONE carry a non-null positive total_tokens — ' +
        'per-turn Groq token accounting regressed (R-132 / #155)',
      withTokens: 0,
      total: 0,
    };
  }
  const total = withTokens.reduce((a, r) => a + r.totalTokens, 0);
  return { ok: true, reason: null, withTokens: withTokens.length, total };
}
