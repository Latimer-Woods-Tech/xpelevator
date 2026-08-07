import { describe, it, expect, vi, afterEach } from 'vitest';

// db.ts throws at module load without DATABASE_URL; these tests inject their own
// fake sql, so the real client is never used — stub the module so the import of
// rate-limit.ts (which imports the default sql) doesn't trip that guard.
vi.mock('@/lib/db', () => ({ sql: vi.fn() }));

import {
  clientIp,
  hashIp,
  bucketFor,
  decideAllowed,
  tooManyRequests,
  enforceRateLimit,
  PUBLIC_RATE_LIMITS,
  DEFAULT_RATE_LIMIT,
  type SqlClient,
} from '@/lib/rate-limit';

// A neon-style tagged-template stub that returns a queued `count` and records
// the interpolated values so a test can assert the bucket key it wrote.
function fakeSql(count: number): { sql: SqlClient; values: unknown[][] } {
  const values: unknown[][] = [];
  const sql: SqlClient = (_strings, ...vals) => {
    values.push(vals);
    return Promise.resolve([{ count }]);
  };
  return { sql, values };
}

function reqWith(headers: Record<string, string>): { headers: { get(n: string): string | null } } {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return { headers: { get: (n: string) => lower[n.toLowerCase()] ?? null } };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('clientIp', () => {
  it('prefers CF-Connecting-IP', () => {
    expect(clientIp(reqWith({ 'cf-connecting-ip': '203.0.113.7' }))).toBe('203.0.113.7');
  });
  it('falls back to the first X-Forwarded-For hop', () => {
    expect(clientIp(reqWith({ 'x-forwarded-for': '198.51.100.4, 10.0.0.1' }))).toBe('198.51.100.4');
  });
  it('is "unknown" when no IP header is present', () => {
    expect(clientIp(reqWith({}))).toBe('unknown');
  });
});

describe('hashIp', () => {
  it('returns a stable 16-hex-char digest via WebCrypto', async () => {
    const a = await hashIp('203.0.113.7');
    const b = await hashIp('203.0.113.7');
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).toBe(b);
    expect(await hashIp('203.0.113.8')).not.toBe(a);
  });
  it('falls back to the raw IP when WebCrypto is unavailable', async () => {
    vi.stubGlobal('crypto', {}); // no .subtle
    expect(await hashIp('203.0.113.7')).toBe('203.0.113.7');
  });
});

describe('bucketFor', () => {
  it('encodes route, ip-hash, and window index; a new window is a new key', () => {
    const w = 60_000;
    const a = bucketFor('branding', 'abc', 1_000_000, w);
    const b = bucketFor('branding', 'abc', 1_000_000 + 500, w); // same window
    const c = bucketFor('branding', 'abc', 1_000_000 + w, w); // next window
    expect(a.bucket).toBe(b.bucket);
    expect(a.bucket).toContain('branding:abc:');
    expect(c.bucket).not.toBe(a.bucket);
    expect(c.expiresAt.getTime()).toBeGreaterThan(a.expiresAt.getTime());
  });
});

describe('decideAllowed (proof-of-rejection)', () => {
  it('permits up to and including the limit, rejects past it', () => {
    expect(decideAllowed(100, 100)).toBe(true);
    expect(decideAllowed(101, 100)).toBe(false); // the rejection
  });
});

describe('tooManyRequests', () => {
  it('is a non-cacheable 429 with Retry-After', async () => {
    const res = tooManyRequests(60_000);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ error: 'Too many requests' });
  });
});

describe('enforceRateLimit', () => {
  const req = reqWith({ 'cf-connecting-ip': '203.0.113.7' });

  it('allows a caller under budget (returns null)', async () => {
    const { sql, values } = fakeSql(1);
    const res = await enforceRateLimit(req, 'branding', undefined, { sql, now: () => 1_000_000 });
    expect(res).toBeNull();
    // Wrote a bucket keyed on the route.
    expect(String(values[0][0])).toContain('branding:');
  });

  it('REJECTS a caller over budget with a 429 (proof-of-rejection)', async () => {
    const over = PUBLIC_RATE_LIMITS.branding.limit + 1;
    const { sql } = fakeSql(over);
    const res = await enforceRateLimit(req, 'branding', undefined, { sql, now: () => 1_000_000 });
    expect(res).not.toBeNull();
    expect(res!.status).toBe(429);
  });

  it('honors explicit options over the per-route default', async () => {
    const { sql } = fakeSql(3);
    const res = await enforceRateLimit(req, 'branding', { limit: 2, windowMs: 1_000 }, {
      sql,
      now: () => 0,
    });
    expect(res!.status).toBe(429); // count 3 > limit 2
  });

  it('uses DEFAULT_RATE_LIMIT for an unknown route key', async () => {
    const { sql } = fakeSql(DEFAULT_RATE_LIMIT.limit); // exactly at the default limit → allowed
    const res = await enforceRateLimit(req, 'mystery-route', undefined, { sql, now: () => 0 });
    expect(res).toBeNull();
  });

  it('fails OPEN when the counter write throws', async () => {
    const throwingSql: SqlClient = () => Promise.reject(new Error('neon down'));
    const res = await enforceRateLimit(req, 'branding', undefined, {
      sql: throwingSql,
      now: () => 0,
    });
    expect(res).toBeNull(); // allowed despite the DB error
  });
});
