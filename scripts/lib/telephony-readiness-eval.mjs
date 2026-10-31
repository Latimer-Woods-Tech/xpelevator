/**
 * telephony-readiness-eval.mjs — pure verdict logic for the uptime monitor's
 * telephony-readiness check (scripts/uptime-check.mjs → checkTelephonyReadiness).
 *
 * WHY THIS EXISTS (#125): the phone modality's webhook signature verifier reads
 * its Ed25519 signing key at request time. When that key failed to resolve in
 * the deployed Worker, the verifier fell through to its fail-closed branch and
 * rejected EVERY Telnyx webhook — phone went dark, and nothing caught it. The
 * monitor's unsigned reachability probe can't: /api/telnyx/webhook returns 401
 * both when the key is present (healthy fail-closed on an unsigned body) AND
 * when the key is absent (the #125 outage), so a 401 is indistinguishable.
 *
 * `/api/health` now carries a non-secret `telephony` block whose `publicKey`
 * boolean is resolved through the SAME runtime resolver the verifier uses
 * (src/lib/telnyx.ts getTelnyxPublicKey). That boolean is the one outside signal
 * that tells the two states apart. This module turns it into the monitor's
 * verdict — and, being pure, carries its own proof-of-rejection unit test
 * (Standing Law 1): the same function the monitor trusts is exercised with
 * `publicKey:false` to prove it STILL turns the monitor red.
 *
 * Deploy-ordering safety: a build that PREDATES this signal has no `telephony`
 * block at all. That is the normal state in the window between a merge (the
 * monitor workflow updates immediately) and the promote (the new health build
 * goes live minutes later), so an ABSENT block must NEVER page — it reports
 * `available:false`. Only a block that IS present with `publicKey !== true` is
 * the #125 outage and pages.
 *
 * Pure, dependency-free, Node/Worker-safe (no I/O).
 */

// The secrets WITHOUT which the phone modality is dark — a hard page. Both are
// unconditionally required for a working phone conversation, so either missing
// is an outage, not degradation:
//   publicKey — the Ed25519 webhook signing key. Absent → the verifier fails
//               closed on every inbound webhook (the #125 outage).
//   apiKey    — TELNYX_API_KEY. Every Telnyx Call Control action goes through
//               telnyxHeaders() (src/lib/telnyx.ts), which THROWS when it is
//               absent. So even with a valid signature, call.answered→callSpeak
//               and call.speak.ended→startTranscription throw: the call connects
//               but can neither speak nor listen — the conversation is dead.
const HARD_KEYS = ['publicKey', 'apiKey'];

// Secrets that only feed OUTBOUND call-initiation request params as
// `value || undefined` (initiateCall: connection_id, webhook_url) and never
// make telnyxHeaders() throw. A webhook URL can also be configured on the Telnyx
// Connection itself, so a missing per-call value may be covered there. Their
// absence degrades outbound dialing but does not throw the inbound simulation —
// informational warn tier, never a page on their own.
const SOFT_KEYS = ['connectionId', 'webhookUrl'];

/**
 * Decide the telephony probe's verdict from a parsed `/api/health` body.
 *
 * @param {unknown} health the parsed JSON body of GET /api/health (or null)
 * @returns {{down: boolean, available: boolean, degraded: string[], missing: string[]}}
 *   down       — a secret the phone modality cannot run without (publicKey or
 *                apiKey) is NOT resolvable in the live worker — the phone-dark
 *                outage; hard-fail the monitor. Always false when unavailable.
 *   available  — the live build actually carries the `telephony` readiness
 *                signal (false for a pre-signal build, e.g. the deploy window).
 *   missing    — which HARD secrets are unresolvable (drives the alert text).
 *   degraded   — SOFT outbound-only secrets (connectionId/webhookUrl) that are
 *                not resolvable; informational only, never a page on their own.
 */
export function evaluateTelephonyReadiness(health) {
  const telephony =
    health && typeof health === 'object' && health.telephony && typeof health.telephony === 'object'
      ? health.telephony
      : null;

  // Absent block → pre-signal build (deploy window) or the field was removed.
  // Not a trustworthy outage signal → report unavailable, do NOT page.
  if (!telephony || typeof telephony.publicKey !== 'boolean') {
    return { down: false, available: false, degraded: [], missing: [] };
  }

  const missing = HARD_KEYS.filter((k) => telephony[k] !== true);
  const degraded = SOFT_KEYS.filter((k) => telephony[k] !== true);
  return { down: missing.length > 0, available: true, degraded, missing };
}
