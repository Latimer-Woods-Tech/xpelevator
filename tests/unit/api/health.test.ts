import { describe, it, expect, afterEach, vi } from 'vitest';
import { GET } from '@/app/api/health/route';

// Deterministic: the route reads only process.env presence (never values) plus
// the generated build-info module — no DB / LLM / Telnyx creds. Verifies the
// G72 contract: the payload always carries a build identity (`commit`,
// `builtAt`) so the post-deploy gate in deploy.yml can assert which commit
// production is actually serving.
describe('GET /api/health', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 200 with env presence + build identity when all vars are set', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@localhost/db');
    vi.stubEnv('AUTH_SECRET', 'test-secret');
    vi.stubEnv('GROQ_API_KEY', 'test-key');

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.env).toEqual({
      DATABASE_URL: true,
      AUTH_SECRET: true,
      GROQ_API_KEY: true,
    });

    // G72 build identity: the committed default is 'dev'; deploy.yml stamps a
    // real 40-char SHA before the OpenNext build. Either way the field must be
    // a non-empty string of exactly that shape — never missing/undefined.
    expect(typeof body.commit).toBe('string');
    expect(body.commit).toMatch(/^(dev|[0-9a-f]{7,40})$/);
    // builtAt is null on the committed default, an ISO timestamp when stamped.
    expect(
      body.builtAt === null || !Number.isNaN(Date.parse(body.builtAt)),
    ).toBe(true);
    // The payload must never leak env VALUES — presence booleans only.
    expect(JSON.stringify(body.env)).not.toMatch(/localhost|test-secret|test-key/);
  });

  it('returns 503 (still carrying build identity) when a required var is missing', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@localhost/db');
    vi.stubEnv('AUTH_SECRET', 'test-secret');
    // GROQ_API_KEY present but blank — trimmed-empty must count as missing.
    vi.stubEnv('GROQ_API_KEY', '   ');

    const res = await GET();
    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.env.GROQ_API_KEY).toBe(false);
    // Build identity is unconditional — a degraded instance must still say
    // which build it is (that's the point of G72).
    expect(typeof body.commit).toBe('string');
    expect(body.commit.length).toBeGreaterThan(0);
  });
});
