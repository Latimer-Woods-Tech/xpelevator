import { describe, it, expect } from 'vitest';
import { GET } from '@/app/api/scenario-packs/route';
import { SCENARIO_PACKS } from '@/lib/scenario-packs';

// Deterministic: the route has no DB / auth / secret dependency — it serialises
// the pure pack catalog. Verifies the public contract end-to-end (handler →
// Response → JSON) the operator /library surface consumes, and re-asserts the
// hidden-mechanic boundary at the HTTP boundary (defence in depth for R-021).
describe('GET /api/scenario-packs', () => {
  it('returns 200 with a public, cacheable pack catalog', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toContain('max-age=300');

    const body = await res.json();
    expect(body.packCount).toBe(SCENARIO_PACKS.length);
    expect(Array.isArray(body.packs)).toBe(true);
    expect(body.packs.length).toBe(SCENARIO_PACKS.length);
    expect(body.packs[0]).toHaveProperty('vertical');
    expect(body.packs[0]).toHaveProperty('role');
    expect(body.packs[0].scenarios[0]).toHaveProperty('summary');
  });

  it('never leaks a scenario script (persona / objective / hints)', async () => {
    const res = await GET();
    const text = JSON.stringify(await res.json());
    expect(text).not.toMatch(/customerPersona/);
    expect(text).not.toMatch(/customerObjective/);
    expect(text).not.toMatch(/hints/);
    expect(text).not.toMatch(/"script"/);
    // and never the banned word on any public string
    expect(text).not.toMatch(/\bAI\b/);
  });
});
