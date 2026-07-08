import { describe, it, expect } from 'vitest';
import { GET } from '@/app/api/plans/route';

// Deterministic: the route has no DB / auth / secret dependency — it just
// serialises the pure plan catalog. Verifies the public contract end-to-end
// (handler → Response → JSON) the operator pricing/signup surface will consume.
describe('GET /api/plans', () => {
  it('returns 200 with a public, cacheable seat-plan catalog', async () => {
    const res = await GET();
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
