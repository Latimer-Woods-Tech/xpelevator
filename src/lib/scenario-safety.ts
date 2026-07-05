/**
 * Scenario script safety — strips hidden simulation mechanics from any scenario
 * payload before it reaches a non-admin trainee.
 *
 * The scenario `script` carries the customer's persona, hidden objective, and
 * context "hints" — the exact information a trainee must NOT see (the admin UI
 * even promises "Employees won't see these hints"). These fields are consumed
 * SERVER-SIDE only (lib/ai.ts builds the roleplay prompt from them); the client
 * never needs them to run a session. The one presentational field a trainee
 * legitimately reads is the preferred TTS voice for voice-mode playback.
 *
 * Rule: admins get the full script (they author it); everyone else gets an
 * allowlisted, mechanics-free view.
 */

/** Script keys safe to expose to a non-admin trainee (presentational only). */
const TRAINEE_SAFE_SCRIPT_KEYS = ['ttsVoiceName'] as const;

/**
 * Reduce a scenario `script` to what the given viewer is allowed to see.
 *
 * @param script  Raw script object from the DB (or null).
 * @param isAdmin Whether the viewer holds the ADMIN role.
 * @returns The full script for admins; an allowlisted subset for everyone else
 *          (or `null` when nothing safe remains).
 */
export function sanitizeScenarioScript(
  script: unknown,
  isAdmin: boolean
): Record<string, unknown> | null {
  if (isAdmin) {
    return (script as Record<string, unknown> | null) ?? null;
  }
  if (!script || typeof script !== 'object') {
    return null;
  }
  const src = script as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  for (const key of TRAINEE_SAFE_SCRIPT_KEYS) {
    if (src[key] !== undefined) {
      safe[key] = src[key];
    }
  }
  return Object.keys(safe).length > 0 ? safe : null;
}

/**
 * Sanitize the nested `scenario.script` on a session-shaped payload in place and
 * return the same object, for the common case of a session row that embeds a
 * `scenario` relation. Safe to call on rows without a scenario/script.
 */
export function sanitizeSessionScenario<T extends { scenario?: unknown }>(
  session: T,
  isAdmin: boolean
): T {
  const scenario = session?.scenario as { script?: unknown } | null | undefined;
  if (scenario && typeof scenario === 'object' && 'script' in scenario) {
    scenario.script = sanitizeScenarioScript(scenario.script, isAdmin);
  }
  return session;
}
