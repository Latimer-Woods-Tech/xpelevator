/**
 * Worker-safe Sentry error sink (#154, Phase 3 observability).
 *
 * Zero-dependency, no Node built-ins — safe in the Cloudflare Workers / Next.js
 * edge runtime. It POSTs a minimal Sentry *envelope* (the modern ingest format)
 * to the DSN's `/envelope/` endpoint with `fetch`, wrapped in explicit error
 * handling (Hard Constraint: no raw `fetch`). It is the secret-dependent half of
 * the observability foundation started in `log.ts`: `log('error', …)` fires this
 * best-effort so a captured server error also reaches Sentry, while the
 * structured console line remains the durable, drain-indexed record.
 *
 * The DSN is read lazily from `process.env.SENTRY_DSN` (a Pages runtime secret,
 * sourced from GCP SM `XPELEVATOR_SENTRY_DSN` — verified live 2026-08-17). An
 * absent / malformed DSN makes the sink no-op (returns `false`/`null`) and it
 * NEVER throws, so a missing secret can never take a request down. This module
 * deliberately does NOT import `@/lib/env` (which imports `@/lib/log`, which
 * imports this) — reading `process.env` directly keeps it off that import cycle.
 *
 * Scope of this slice: server-side ERROR capture only (warnings — e.g. the
 * per-401 `auth.denied` line — are intentionally NOT captured to keep the event
 * budget sane). PostHog product-event capture is the sibling half of #154 and is
 * a separate slice.
 */

/** Structured context attached to a captured event. */
export interface SentryContext {
  /** Per-request correlation id (the `x-request-id` the middleware mints). */
  requestId?: string;
  /** Request path the error occurred on. */
  path?: string;
  /** Indexed, low-cardinality tags. */
  tags?: Record<string, string>;
  /** Arbitrary structured detail (the log fields) — searchable, not indexed. */
  extra?: Record<string, unknown>;
}

/** A DSN parsed into the ingest envelope URL the sink POSTs to. */
export interface ParsedDsn {
  /** `https://<host>/[<path>/]api/<projectId>/envelope/?sentry_key=<publicKey>` */
  envelopeUrl: string;
  publicKey: string;
  projectId: string;
}

/** The event level Sentry understands (`warn` maps to `warning`). */
export type SentryLevel = 'error' | 'warning' | 'info';

/** A single normalized event, ready to be serialized into an envelope. */
export interface SentryEvent {
  eventId: string;
  /** Unix seconds. */
  timestamp: number;
  message: string;
  errorName?: string;
  level: SentryLevel;
  context: SentryContext;
  environment?: string;
  release?: string;
}

/**
 * Parse a Sentry DSN (`https://<publicKey>@<host>/[<path>/]<projectId>`) into the
 * envelope ingest URL. Returns `null` for an empty or structurally-invalid DSN
 * (no public key, or a non-numeric project id) — the caller then no-ops.
 */
export function parseDsn(dsn: string | undefined | null): ParsedDsn | null {
  if (!dsn || dsn.trim() === '') return null;
  let url: URL;
  try {
    url = new URL(dsn.trim());
  } catch {
    return null;
  }
  const publicKey = url.username;
  const segments = url.pathname.split('/').filter((s) => s !== '');
  const projectId = segments.length > 0 ? segments[segments.length - 1] : '';
  // A Sentry project id is always numeric; reject anything else (a paste of a
  // non-DSN URL) so we never POST to an arbitrary host.
  if (!publicKey || !projectId || !/^\d+$/.test(projectId)) return null;
  const prefix = segments.slice(0, -1).join('/');
  const pathPart = prefix ? `${prefix}/` : '';
  const envelopeUrl = `${url.protocol}//${url.host}/${pathPart}api/${projectId}/envelope/?sentry_key=${publicKey}`;
  return { envelopeUrl, publicKey, projectId };
}

/** Mint a Sentry event id: an RFC-4122 v4 uuid with the hyphens stripped. */
export function newEventId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/**
 * Serialize one event into the newline-delimited Sentry envelope body:
 *   {envelope header}\n{item header}\n{event payload}\n
 * The exception is modeled as a single `values[0]` with the error class + message
 * (never a stack — the upstream `errorFields()` already strips it, so no PII/
 * internals reach Sentry).
 */
export function buildEnvelope(dsn: string, ev: SentryEvent): string {
  const sentAt = new Date(ev.timestamp * 1000).toISOString();
  const header = JSON.stringify({ event_id: ev.eventId, sent_at: sentAt, dsn });
  const itemHeader = JSON.stringify({ type: 'event' });
  const tags: Record<string, string> = { ...(ev.context.tags ?? {}) };
  if (ev.context.requestId) tags.request_id = ev.context.requestId;
  if (ev.context.path) tags.path = ev.context.path;
  const payload: Record<string, unknown> = {
    event_id: ev.eventId,
    timestamp: ev.timestamp,
    platform: 'javascript',
    logger: 'xpelevator',
    level: ev.level,
    exception: { values: [{ type: ev.errorName ?? 'Error', value: ev.message }] },
  };
  if (Object.keys(tags).length > 0) payload.tags = tags;
  if (ev.context.extra && Object.keys(ev.context.extra).length > 0) {
    payload.extra = ev.context.extra;
  }
  if (ev.environment) payload.environment = ev.environment;
  if (ev.release) payload.release = ev.release;
  return `${header}\n${itemHeader}\n${JSON.stringify(payload)}\n`;
}

/** Options for {@link captureException} — every field is injectable for tests. */
export interface CaptureOptions {
  errorName?: string;
  level?: SentryLevel;
  /** Override the DSN (default: `process.env.SENTRY_DSN`). */
  dsn?: string;
  /** Override the clock in ms (default: `Date.now()`). */
  now?: number;
  /** Override the fetch implementation (default: global `fetch`). */
  fetchImpl?: typeof fetch;
}

/**
 * Capture one error to Sentry. Resolves `true` only when the envelope POST
 * returns a 2xx; resolves `false` for an unconfigured/malformed DSN or any
 * transport failure. NEVER throws — the raw `fetch` is wrapped in try/catch so
 * an ingest outage cannot surface as an app error.
 */
export async function captureException(
  message: string,
  context: SentryContext = {},
  opts: CaptureOptions = {}
): Promise<boolean> {
  const rawDsn = (opts.dsn ?? process.env.SENTRY_DSN)?.trim();
  const parsed = parseDsn(rawDsn);
  if (!parsed || !rawDsn) return false;
  const ev: SentryEvent = {
    eventId: newEventId(),
    timestamp: Math.floor((opts.now ?? Date.now()) / 1000),
    message,
    errorName: opts.errorName,
    level: opts.level ?? 'error',
    context,
    environment: process.env.NODE_ENV,
    release:
      process.env.SENTRY_RELEASE ?? process.env.CF_PAGES_COMMIT_SHA ?? undefined,
  };
  const body = buildEnvelope(rawDsn, ev);
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(parsed.envelopeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-sentry-envelope' },
      body,
    });
    return res.ok;
  } catch {
    // Best-effort telemetry: an ingest failure must never break the request.
    return false;
  }
}

/**
 * Resolve the platform `waitUntil` when running on OpenNext/Cloudflare, so a
 * best-effort capture survives past the response instead of being cancelled when
 * the isolate winds down. Returns `null` off-platform (Node, tests) where the
 * caller falls back to a fire-and-forget `.catch()`.
 */
export function getWaitUntil(): ((p: Promise<unknown>) => void) | null {
  try {
    const ctx = (
      globalThis as unknown as {
        [k: symbol]: { ctx?: { waitUntil?: (p: Promise<unknown>) => void } };
      }
    )[Symbol.for('__cloudflare-context__')];
    const fn = ctx?.ctx?.waitUntil;
    return typeof fn === 'function' ? fn.bind(ctx.ctx) : null;
  } catch {
    return null;
  }
}

/**
 * Fire-and-forget bridge used by `log('error', …)`. A fast no-op (returns `null`,
 * no work, no allocation) when `SENTRY_DSN` is unset — the common case in dev /
 * tests / a DSN-less deploy. When configured, the capture is scheduled on the
 * platform `waitUntil` (or fire-and-forget off-platform). Returns the in-flight
 * promise (or `null`) so callers/tests can await it; `log()` ignores the return.
 */
export function dispatchCapture(
  message: string,
  context: SentryContext = {},
  errorName?: string
): Promise<boolean> | null {
  if (!process.env.SENTRY_DSN) return null;
  const p = captureException(message, context, { errorName });
  const waitUntil = getWaitUntil();
  if (waitUntil) {
    waitUntil(p);
  } else {
    void p.catch(() => {});
  }
  return p;
}
