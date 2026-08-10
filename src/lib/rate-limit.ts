/**
 * DB-backed fixed-window IP rate limiter for the ANONYMOUS public routes.
 *
 * Issue #157 ("No rate limiting on any public route") flagged that every
 * always-public surface — the brand-render reads (`/api/branding/[slug]`,
 * the existence-oracle enumeration point, and `/api/branding/by-host`) and the
 * public catalogs (`/api/plans`, `/api/scenario-packs`) — accepts unbounded
 * anonymous traffic. `src/lib/limits.ts` throttles only the authenticated chat
 * hot path (keyed on a session's own message timestamps), so it cannot cover a
 * caller with no session at all.
 *
 * Why DB-backed and not in-memory: Cloudflare Workers run many isolates across
 * many colos, so an in-memory counter silently under-counts and leaks the cap —
 * exactly the reasoning already documented in `src/lib/limits.ts`. Enforcing
 * against a shared Postgres row (Neon HTTP `sql`) is authoritative across every
 * isolate. Each (route, ip-hash, wall-clock window) is one row; the window index
 * is baked into the primary key so rolling into a new window is a brand-new row
 * and the old one is simply abandoned (pruned later via `expires_at`).
 *
 * Fail-OPEN by design: a rate limiter must never convert a transient DB blip
 * into an outage of a public page. If the counter write throws, the request is
 * allowed and the failure is logged. Rate limiting is abuse control, not a
 * correctness gate (unlike auth, which fails closed in `middleware.ts`).
 *
 * The pure helpers (`clientIp`, `hashIp`, `bucketFor`, `decideAllowed`) live
 * here so they are unit-testable in isolation; `enforceRateLimit` performs the
 * one DB round-trip and returns a ready-to-send 429 `Response` (or `null` when
 * the caller is under budget).
 */
import { sql as defaultSql } from '@/lib/db';
import { log, errorFields } from '@/lib/log';

/** A neon-style tagged-template query function. */
export type SqlClient = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<Array<Record<string, unknown>>>;

export interface RateLimitOptions {
  /** Max requests permitted per client IP within one window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

/**
 * Per-route budgets. Deliberately abuse-only ceilings a real human never feels:
 * the brand reads are additionally CDN-cached (`max-age=300`) for known slugs,
 * so legitimate renders mostly never reach the origin — the limiter bites the
 * cache-missing enumeration pattern (varied/unknown slugs) that has no business
 * hitting the origin dozens of times a second.
 */
export const PUBLIC_RATE_LIMITS: Record<string, RateLimitOptions> = {
  branding: { limit: 100, windowMs: 60_000 },
  plans: { limit: 240, windowMs: 60_000 },
  'scenario-packs': { limit: 240, windowMs: 60_000 },
};

/** Fallback budget for a route key with no explicit entry above. */
export const DEFAULT_RATE_LIMIT: RateLimitOptions = { limit: 120, windowMs: 60_000 };

interface HeaderCarrier {
  headers: { get(name: string): string | null };
}

interface EnforceDeps {
  /** Injectable for tests; defaults to the real neon `sql` client. */
  sql?: SqlClient;
  /** Injectable clock (ms since epoch); defaults to `Date.now`. */
  now?: () => number;
}

/**
 * The caller's IP. Cloudflare sets `CF-Connecting-IP` on every edge request;
 * `X-Forwarded-For` (first hop) is a fallback for non-CF contexts. `'unknown'`
 * when neither is present — such callers share one bucket, which is safe (it can
 * only over-throttle a header-stripping proxy, never leak the cap).
 */
export function clientIp(request: HeaderCarrier): string {
  const cf = request.headers.get('cf-connecting-ip');
  if (cf && cf.trim()) return cf.trim();
  const xff = request.headers.get('x-forwarded-for');
  if (xff && xff.trim()) return xff.split(',')[0].trim();
  return 'unknown';
}

/**
 * A short, stable hash of the IP so a raw client address is never persisted
 * (PII minimization — see docs/PII_INVENTORY.md). 8 bytes of SHA-256 is ample
 * to avoid bucket collisions. Falls back to the raw IP only where WebCrypto is
 * unavailable (never in the deployed Worker), keeping the limiter functional.
 */
export async function hashIp(ip: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return ip;
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(ip));
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < 8; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

/**
 * The primary-key bucket for a (route, ip-hash, window). The window index is
 * `floor(now / windowMs)`, so all requests in the same wall-clock window share
 * a row and the next window is a distinct key. Returns both the key and the
 * window's end timestamp (for the row's `expires_at`).
 */
export function bucketFor(
  routeKey: string,
  ipHash: string,
  nowMs: number,
  windowMs: number
): { bucket: string; expiresAt: Date } {
  const windowIndex = Math.floor(nowMs / windowMs);
  const bucket = `${routeKey}:${ipHash}:${windowIndex}`;
  // Keep the row a little past the window end so a late prune still sees it.
  const expiresAt = new Date((windowIndex + 1) * windowMs + windowMs);
  return { bucket, expiresAt };
}

/** Under budget iff the post-increment count has not passed the limit. */
export function decideAllowed(count: number, limit: number): boolean {
  return count <= limit;
}

/** The 429 response returned to a caller over budget. Never cached. */
export function tooManyRequests(windowMs: number): Response {
  return new Response(JSON.stringify({ error: 'Too many requests' }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': String(Math.ceil(windowMs / 1000)),
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * Enforce the per-IP budget for `routeKey`. Increments the shared window
 * counter and returns a 429 `Response` when the caller is over budget, or
 * `null` when the request may proceed. Fails OPEN (returns `null`) on any DB
 * error so a public page never goes dark on a transient blip.
 *
 * Usage in a route handler:
 *   const limited = await enforceRateLimit(request, 'branding');
 *   if (limited) return limited;
 */
export async function enforceRateLimit(
  request: HeaderCarrier,
  routeKey: string,
  opts?: RateLimitOptions,
  deps: EnforceDeps = {}
): Promise<Response | null> {
  const { limit, windowMs } = opts ?? PUBLIC_RATE_LIMITS[routeKey] ?? DEFAULT_RATE_LIMIT;
  const sql = deps.sql ?? (defaultSql as unknown as SqlClient);
  const nowMs = (deps.now ?? Date.now)();

  try {
    const ipHash = await hashIp(clientIp(request));
    const { bucket, expiresAt } = bucketFor(routeKey, ipHash, nowMs, windowMs);
    const rows = await sql`
      INSERT INTO api_rate_limits (bucket, count, expires_at)
      VALUES (${bucket}, 1, ${expiresAt.toISOString()})
      ON CONFLICT (bucket) DO UPDATE SET count = api_rate_limits.count + 1
      RETURNING count
    `;
    const count = Number(rows?.[0]?.count ?? 1);
    if (!decideAllowed(count, limit)) return tooManyRequests(windowMs);
    return null;
  } catch (err) {
    // Fail open — abuse control must not take a public page down.
    log('error', 'rate_limit.counter_failed', { routeKey, note: 'allowing', ...errorFields(err) });
    return null;
  }
}
