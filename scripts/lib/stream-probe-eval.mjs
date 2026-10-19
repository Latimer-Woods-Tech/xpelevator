/**
 * stream-probe-eval.mjs — pure verdict logic for the uptime monitor's live
 * realism-model streaming probe (scripts/uptime-check.mjs → checkGroqCompletion).
 *
 * WHY THIS EXISTS (#304 / #315): the realism model `openai/gpt-oss-120b` is the
 * scoring model AND the fast tier's fallback floor, so the monitor hard-fails —
 * opening a GitHub alarm issue — when a live streaming `/chat/completions` call
 * for it connects (HTTP 200) but yields ZERO content before `[DONE]`. That is the
 * correct signal for a SUSTAINED core-loop outage (every live turn would serve the
 * canned CUSTOMER_TURN_FALLBACK).
 *
 * But a SINGLE empty-200 stream is a transient Groq generation hiccup that
 * self-recovers on the very next attempt — twice proven live (alert #304 on
 * 2026-10-15, alert #315 on 2026-10-17, each a lone red bracketed by greens). The
 * PRODUCTION turn path already absorbs that blip: `GroqFetchClient.chatCompletionStream`
 * reopens the SAME model once (`MAX_STREAM_ATTEMPTS = 2`, src/lib/groq-fetch.ts).
 * The monitor, however, was single-shot — so it paged on a flap production no
 * longer feels, the alert-fatigue failure the monitor's own comments warn against.
 *
 * This module aligns the monitor's verdict with production: a transient empty-200
 * that recovers on a bounded reopen is NOT down; only a stream that stays empty (or
 * returns non-200) across the attempts is a real outage. Extracted + pure so the
 * loosened gate carries its own proof-of-rejection unit test (Standing Law 1): the
 * same verdict function the monitor trusts is exercised with a PERSISTENT empty
 * stream to prove it STILL turns the monitor red — the retry must absorb a blip,
 * never mask an outage.
 *
 * Pure, dependency-free, Node/Worker-safe (no I/O).
 */

/**
 * Attempts to (re)open the realism streaming probe, mirroring production's
 * `GroqFetchClient.MAX_STREAM_ATTEMPTS`. Keep in sync with src/lib/groq-fetch.ts.
 */
export const MAX_REALISM_STREAM_ATTEMPTS = 2;

/**
 * The transient, retryable flap: the stream CONNECTED (HTTP 200) but yielded no
 * content. This is the ONLY class the monitor reopens — exactly what production
 * reopens. A non-200 (auth 401, org-block 403, 5xx, transport 0) is a hard
 * failure production does not absorb via the empty-stream retry, so it is decided
 * on the first attempt and never reopened here.
 *
 * @param {{status?: unknown, contentOk?: unknown}} result one probeGroqStream result
 * @returns {boolean}
 */
export function isTransientEmptyStream(result) {
  return !!result && result.status === 200 && result.contentOk !== true;
}

/**
 * Decide the realism probe's verdict from the ordered list of attempt results.
 *
 * The monitor's retry loop stops reopening the moment an attempt is NOT a
 * transient empty-200 (it streamed content, or it hard-failed with a non-200), so
 * the LAST element is always the decisive one. Basing the verdict on the final
 * attempt is what lets a recovered flap pass while a persistent empty stream (or a
 * non-200) still fails.
 *
 * @param {Array<{status?: unknown, contentOk?: unknown, usageOk?: unknown}>} attempts
 * @returns {{down: boolean, usageMissing: boolean, attempts: number, final: object|null}}
 *   down          — realism is a core-loop outage (hard-fail the monitor)
 *   usageMissing  — realism streamed content but emitted NO token-usage block
 *                   (R-132 / #155 regression; a real failure, never retried)
 *   attempts      — how many probe results were considered
 *   final         — the decisive (last) attempt result, or null if none
 */
export function evaluateRealismStreamProbe(attempts) {
  const list = Array.isArray(attempts) ? attempts : [];
  const final = list.length > 0 ? list[list.length - 1] : null;
  if (!final) {
    // No probe ran at all — treat as down (defensive; the monitor always probes).
    return { down: true, usageMissing: false, attempts: 0, final: null };
  }
  const down = final.status !== 200 || final.contentOk !== true;
  const usageMissing = !down && final.usageOk !== true;
  return { down, usageMissing, attempts: list.length, final };
}
