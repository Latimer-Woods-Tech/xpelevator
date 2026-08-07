import { describe, it, expect, vi } from 'vitest';

// The per-IP rate limiter (#157) is exercised in its own suites; here it is a
// pass-through so this test focuses on the plan-catalog contract.
vi.mock('@/lib/rate-limit', () => ({
  enforceRateLimit: vi.fn().mockResolvedValue(null),
}));

import { GET } from '@/app/api/plans/route';

const req = () => new Request('http://localhost/api/plans');

// Deterministic: the route has no DB / auth / secret dependency — it just
// serialises the pure plan catalog. Verifies the public contract end-to-end
// (handler → Response → JSON) the operator pricing/signup surface will consume.
describe('GET /api/plans', () => {
  it('returns 200 with a public, cacheable seat-plan catalog', async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toContain('max-age=300');

    const body = await res.json();
    expect(body.billing.model).toBe('seat-based-subscription');
    expect(body.tiers.map((t: { id: string }) => t.id)).toEqual([
      'chat',
      'voice',
      'phone',
    ]);
    // Public payload must not carry pricing or internal wiring.
    expect(body.currency).toBeNull();
    expect(JSON.stringify(body)).not.toMatch(/stripeLookupKey/);
  });
});
