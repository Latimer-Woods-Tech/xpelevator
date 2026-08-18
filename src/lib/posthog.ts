/**
 * Worker-safe PostHog product-event sink (#154, Phase 3 observability).
 *
 * The sibling half of the Sentry error sink (`@/lib/sentry`): Sentry captures
 * server ERRORS, this captures PRODUCT EVENTS (the core-loop "session_scored"
 * signal), so the manager-trust and kill-signal metrics in issue #16 come from
 * real telemetry instead of a manual read of the DB. Zero-dependency, no Node
 * built-ins — safe in the Cloudflare Workers / Next.js edge runtime and in Node.
 *
 * It POSTs a single event to PostHog's public `/capture/` HTTP endpoint with
 * `fetch`, wrapped in explicit error handling (Hard Constraint: no raw `fetch`).
 * The project API key is read lazily from `process.env.POSTHOG_KEY` (a Pages
 * runtime secret, sourced from GCP SM `XPELEVATOR_POSTHOG_KEY` — founder-staged
 * 2026-08-17); the ingest host defaults to PostHog US cloud and can be overridden
 * with `POSTHOG_HOST`. A PostHog *project* key is a write-only ingest key (safe to
 * embed), but it is still masked in CI and never logged.
 *
 * Fail-safe by construction: an absent / malformed key makes the sink no-op
 * (returns `false`/`null`) and it NEVER throws, so a missing secret can never take
 * a request down. `getWaitUntil` is reused from `@/lib/sentry` (the one platform
 * `waitUntil` resolver) so a best-effort capture survives past the response on
 * OpenNext/Cloudflare instead of being cancelled when the isolate winds down.
 */

import { getWaitUntil } from '@/lib/sentry';

/** PostHog US cloud ingest host — the default when `POSTHOG_HOST` is unset. */
export const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';

/** Arbitrary structured properties attached to a captured event. */
export type EventProperties = Record<string, unknown>;

/** A resolved PostHog target: the capture URL + the project ingest key. */
export interface PosthogConfig {
  /** `<host>/capture/` — where a single event envelope is POSTed. */
  captureUrl: string;
  /** The project (write-only) ingest API key sent in the body. */
  apiKey: string;
}

/**
 * Resolve a PostHog project key (+ optional host) into the capture URL. Returns
 * `null` for an empty key or a structurally-invalid host (not an http(s) URL) —
 * the caller then no-ops instead of POSTing to an arbitrary destination.
 */
export function resolvePosthog(
  apiKey: string | undefined | null,
  host?: string | undefined | null
): PosthogConfig | null {
  const key = apiKey?.trim();
  if (!key) return null;
  const rawHost = host?.trim() || DEFAULT_POSTHOG_HOST;
  let url: URL;
  try {
    url = new URL(rawHost);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  return { captureUrl: `${url.protocol}//${url.host}/capture/`, apiKey: key };
}

/**
 * Serialize one event into the PostHog `/capture/` JSON body. `$lib` is stamped
 * so events from this Worker sink are attributable in PostHog; the ISO timestamp
 * comes from the injected clock so the payload is deterministic under test.
 */
export function buildCaptureBody(
  apiKey: string,
  event: string,
  distinctId: string,
  properties: EventProperties,
  nowMs: number
): string {
  return JSON.stringify({
    api_key: apiKey,
    event,
    distinct_id: distinctId,
    properties: { ...properties, $lib: 'xpelevator-worker' },
    timestamp: new Date(nowMs).toISOString(),
  });
}

/** Options for {@link captureEvent} — every dependency is injectable for tests. */
export interface CaptureOptions {
  /** Override the project key (default: `process.env.POSTHOG_KEY`). */
  apiKey?: string;
  /** Override the ingest host (default: `process.env.POSTHOG_HOST` → US cloud). */
  host?: string;
  /** Override the clock in ms (default: `Date.now()`). */
  now?: number;
  /** Override the fetch implementation (default: global `fetch`). */
  fetchImpl?: typeof fetch;
}

/**
 * Capture one product event to PostHog. Resolves `true` only when the `/capture/`
 * POST returns a 2xx; resolves `false` for an unconfigured/malformed key, an empty
 * `distinctId` (PostHog rejects an event without one), or any transport failure.
 * NEVER throws — the raw `fetch` is wrapped in try/catch so an ingest outage cannot
 * surface as an app error.
 */
export async function captureEvent(
  event: string,
  distinctId: string,
  properties: EventProperties = {},
  opts: CaptureOptions = {}
): Promise<boolean> {
  const cfg = resolvePosthog(opts.apiKey ?? process.env.POSTHOG_KEY, opts.host ?? process.env.POSTHOG_HOST);
  if (!cfg) return false;
  if (!distinctId || distinctId.trim() === '') return false;
  const body = buildCaptureBody(cfg.apiKey, event, distinctId, properties, opts.now ?? Date.now());
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(cfg.captureUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    return res.ok;
  } catch {
    // Best-effort telemetry: an ingest failure must never break the request.
    return false;
  }
}

/**
 * Fire-and-forget bridge for product-event capture. A fast no-op (returns `null`,
 * no work, no allocation) when `POSTHOG_KEY` is unset — the common case in dev /
 * tests / a key-less deploy. When configured, the capture is scheduled on the
 * platform `waitUntil` (or fire-and-forget off-platform). Returns the in-flight
 * promise (or `null`) so callers/tests can await it; the caller ignores it.
 */
export function dispatchEvent(
  event: string,
  distinctId: string,
  properties: EventProperties = {}
): Promise<boolean> | null {
  if (!process.env.POSTHOG_KEY) return null;
  const p = captureEvent(event, distinctId, properties);
  const waitUntil = getWaitUntil();
  if (waitUntil) {
    waitUntil(p);
  } else {
    void p.catch(() => {});
  }
  return p;
}
