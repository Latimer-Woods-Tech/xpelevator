/**
 * Structured, Worker-safe logging + request-correlation helpers (R-111 / R-112).
 *
 * Zero dependencies, no Node built-ins — safe in the Cloudflare Workers / Next.js
 * edge runtime as well as in Node. Every call emits ONE JSON object per line so a
 * platform log drain can index by field (`level`, `msg`, `requestId`, `path`, …)
 * instead of scraping free text.
 *
 * This is the observability foundation (#154, Phase 3): a request id is minted /
 * propagated at the middleware edge and threaded through structured logs so a
 * single request can be traced across handlers. The Sentry error sink now layers
 * on top of this: every `log('error', …)` also fires a best-effort Sentry capture
 * (`@/lib/sentry`) so a server error reaches Sentry with its request id + fields,
 * while this structured console line stays the durable, drain-indexed record. The
 * sink no-ops without `SENTRY_DSN`, so nothing changes in dev / tests / a DSN-less
 * deploy. (The sibling PostHog product-event sink remains a separate slice.)
 */

import { dispatchCapture } from '@/lib/sentry';

/** Canonical per-request correlation header, propagated by the middleware. */
export const REQUEST_ID_HEADER = 'x-request-id';

/** Log severities, ordered least → most severe. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Arbitrary structured context attached to a log line. */
export type LogFields = Record<string, unknown>;

/**
 * Emit a single structured JSON log line. `error` / `warn` route to the matching
 * console method so a drain can separate severities; `debug` / `info` go to
 * `console.log`. The message and any fields are merged into one flat object.
 */
export function log(level: LogLevel, message: string, fields: LogFields = {}): void {
  const line = JSON.stringify({ level, msg: message, ...fields });
  if (level === 'error') {
    console.error(line);
    // Best-effort Sentry sink (#154). No-ops without SENTRY_DSN; never throws.
    // We forward the correlation id + path as indexed tags and the full field
    // bag as searchable `extra`; `errorName` (set by `errorFields()`) becomes
    // the exception class.
    const requestId =
      typeof fields.requestId === 'string' ? fields.requestId : undefined;
    const path = typeof fields.path === 'string' ? fields.path : undefined;
    const errorName =
      typeof fields.errorName === 'string' ? fields.errorName : undefined;
    dispatchCapture(message, { requestId, path, extra: fields }, errorName);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

/**
 * Normalize an unknown thrown value into structured, drain-safe fields. Emits the
 * message and (for real `Error`s) the class name only — never a raw `Error`
 * instance or a stack trace, which would leak internals/PII into the log drain.
 * Spread into a `log()` call's fields: `log('error', 'x.failed', { ...errorFields(err) })`.
 */
export function errorFields(err: unknown): { error: string; errorName?: string } {
  return err instanceof Error
    ? { error: err.message, errorName: err.name }
    : { error: String(err) };
}

/** Mint a fresh request-correlation id (RFC-4122 v4 via Web Crypto). */
export function newRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Resolve the request id for an inbound request: honour a caller-supplied,
 * non-empty `x-request-id` (so a trace can span an upstream hop) when present,
 * otherwise mint a fresh one.
 */
export function requestIdFrom(headers: Headers): string {
  const supplied = headers.get(REQUEST_ID_HEADER);
  return supplied && supplied.trim() !== '' ? supplied : newRequestId();
}
