/**
 * Model-substitution ladder for the Groq LLM path — the resilience layer that
 * keeps the product's core loop alive when a model becomes unavailable.
 *
 * WHY THIS EXISTS (#248 / #16): on ~2026-08-17 Groq decommissioned the two
 * models the app hard-coded (`llama-3.3-70b-versatile` scoring/realism +
 * `llama-3.1-8b-instant` fast). Because each tier named exactly ONE model,
 * every completion then failed instantly (`400 model_decommissioned`): live
 * customer turns fell back to the canned line and EVERY session scored null —
 * a ~2-day outage of the product's core loop. The #262 fix swapped in live
 * models and hardened the 15-min health probe to DETECT a future decommission,
 * but detection is not resilience: until a human swaps the id, the product is
 * still fully down.
 *
 * This module closes that gap. Each production model names an ordered list of
 * still-live substitutes; {@link GroqFetchClient} walks the chain when — and
 * ONLY when — a call fails with the "model unavailable" error class
 * ({@link isModelUnavailableError}). A decommissioned primary now degrades to a
 * live fallback (a real, if different-quality, turn/score) instead of taking the
 * whole loop down. Auth / rate-limit / network failures are deliberately NOT in
 * this class: retrying a different model cannot fix an expired key, and silently
 * doing so would mask the expired-credential alarm the health probe depends on.
 *
 * Pure, dependency-free, Worker-safe (no Node built-ins, no `fetch`).
 */

/**
 * Ordered substitute models per primary. Keys MUST stay in sync with the tier
 * constants in `@/lib/ai` (`CUSTOMER_MODEL_REALISM` / `CUSTOMER_MODEL_FAST`); a
 * drift guard in the unit tests asserts every live tier model has a chain here.
 *
 * The two current OSS tiers cross-cover each other: if the 120B realism/scoring
 * model is unavailable, degrade to the 20B (lower realism, still scores); if the
 * 20B fast model is unavailable, degrade UP to the 120B (slower, still answers).
 * A single provider-wide outage still fails — this defends the far more common
 * single-model decommission/typo, which is exactly what #248 was.
 */
export const MODEL_FALLBACKS: Record<string, readonly string[]> = {
  'openai/gpt-oss-120b': ['openai/gpt-oss-20b'],
  'openai/gpt-oss-20b': ['openai/gpt-oss-120b'],
};

/**
 * The ordered list of models to try for a request: the requested model first,
 * then its substitutes. Deduplicated (a model never retries itself) so a chain
 * that names its own primary can't loop. A model with no configured fallback
 * returns just `[model]` — behaviour identical to the pre-ladder single call.
 */
export function fallbackChain(model: string): string[] {
  const chain = [model, ...(MODEL_FALLBACKS[model] ?? [])];
  return chain.filter((m, i) => chain.indexOf(m) === i);
}

/**
 * Classify a Groq HTTP error as the "model unavailable" class — the ONLY class
 * for which trying a different model is a sensible remedy.
 *
 * Matches a `404` (Groq returns this for an unknown model id), the `400`
 * bodies Groq emits when a model id is retired or mistyped
 * (`model_decommissioned`, `model_not_found`, "... does not exist"), and a
 * `403 model_permission_blocked_org` — Groq's code for a model that EXISTS and
 * is listed by `/v1/models` but is disabled for this org (console → Settings →
 * Limits). That last case is the live #296 regression: `openai/gpt-oss-20b`
 * (the fast customer-turn tier) was blocked org-wide, so every easy/medium
 * customer reply 403'd and fell back to the canned line with NULL token usage —
 * while the `/v1/models` health probe stayed green (it only lists ids, it does
 * not exercise chat permission, exactly the #248 blind spot). Trying a different
 * model is the correct remedy for a blocked model (the chain degrades the 20B
 * fast tier UP to the still-enabled 120B), so it joins this class.
 *
 * A plain deprecation is intentionally NOT matched: a deprecated-but-live model
 * still serves, so it must keep being used until it is actually decommissioned.
 * A 403 that is NOT a model block (auth/forbidden with no `model_permission_*`
 * code) is NOT matched — swapping models cannot fix an account-level 403, and
 * silently doing so would mask a real credential/permission alarm. Everything
 * else (401 auth, 429 rate limit, 5xx, network) returns `false` so the original
 * error surfaces unchanged.
 */
export function isModelUnavailableError(status: number, body: string): boolean {
  if (status === 404) return true;
  const b = body.toLowerCase();
  // A model blocked/disabled for the org: the model exists but this org may not
  // call it. Scoped to the `model_permission_blocked` code so a non-model 403
  // (account auth/forbidden) still surfaces unchanged.
  if (status === 403) return b.includes('model_permission_blocked');
  if (status !== 400) return false;
  return (
    b.includes('model_decommissioned') ||
    b.includes('model_not_found') ||
    b.includes('does not exist')
  );
}
