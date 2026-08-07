import { describe, it, expect, vi, beforeEach } from 'vitest';

// Proves each ANONYMOUS public route short-circuits to the limiter's 429 when
// the per-IP budget is exceeded (#157). The limiter itself is unit-tested in
// tests/unit/lib/rate-limit.test.ts; here we mock it to the over-budget branch
// and assert every route returns the 429 verbatim (and does NOT fall through to
// its handler / DB). The under-budget (null) branch is covered by each route's
// own test, which mocks the limiter to a pass-through.

const enforceRateLimit = vi.fn();
vi.mock('@/lib/rate-limit', () => ({
  enforceRateLimit: (...args: unknown[]) => enforceRateLimit(...args),
}));
// The branding routes import `@/lib/db` at module load — mock it so importing
// the route never opens a real Neon connection.
vi.mock('@/lib/db', () => ({ sql: vi.fn() }));

import { GET as brandingSlugGet } from '@/app/api/branding/[slug]/route';
import { GET as brandingByHostGet } from '@/app/api/branding/by-host/route';
import { GET as plansGet } from '@/app/api/plans/route';
import { GET as packsGet } from '@/app/api/scenario-packs/route';

beforeEach(() => {
  enforceRateLimit.mockReset();
  // Every route sees an over-budget caller this file.
  enforceRateLimit.mockResolvedValue(
    new Response(JSON.stringify({ error: 'Too many requests' }), {
      status: 429,
      headers: { 'Retry-After': '60' },
    })
  );
});

describe('public routes honor the rate limiter (429)', () => {
  it('GET /api/branding/[slug] returns 429 when rate-limited', async () => {
    const res = await brandingSlugGet(new Request('http://localhost/api/branding/acme'), {
      params: Promise.resolve({ slug: 'acme' }),
    });
    expect(res.status).toBe(429);
    expect(enforceRateLimit).toHaveBeenCalledWith(expect.anything(), 'branding');
  });

  it('GET /api/branding/by-host returns 429 when rate-limited', async () => {
    const res = await brandingByHostGet(
      new Request('http://localhost/api/branding/by-host', { headers: { host: 'acme.xpelevator.com' } })
    );
    expect(res.status).toBe(429);
    expect(enforceRateLimit).toHaveBeenCalledWith(expect.anything(), 'branding');
  });

  it('GET /api/plans returns 429 when rate-limited', async () => {
    const res = await plansGet(new Request('http://localhost/api/plans'));
    expect(res.status).toBe(429);
    expect(enforceRateLimit).toHaveBeenCalledWith(expect.anything(), 'plans');
  });

  it('GET /api/scenario-packs returns 429 when rate-limited', async () => {
    const res = await packsGet(new Request('http://localhost/api/scenario-packs'));
    expect(res.status).toBe(429);
    expect(enforceRateLimit).toHaveBeenCalledWith(expect.anything(), 'scenario-packs');
  });
});
