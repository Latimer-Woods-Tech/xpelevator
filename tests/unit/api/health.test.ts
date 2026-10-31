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

    // Telephony readiness block: always present with exactly these four boolean
    // keys (shape the uptime monitor's telephony check relies on), values only.
    // TELNYX_PUBLIC_KEY is not among tests/setup.ts's defaults, so publicKey is
    // false here regardless of the ambient env.
    expect(Object.keys(body.telephony).sort()).toEqual([
      'apiKey',
      'connectionId',
      'publicKey',
      'webhookUrl',
    ]);
    for (const v of Object.values(body.telephony)) {
      expect(typeof v).toBe('boolean');
    }
    expect(body.telephony.publicKey).toBe(false);
    // Telephony readiness does NOT gate ok/status — the core-loop contract (and
    // the deploy post-deploy gate) stays driven by the three required vars only.
    expect(body.ok).toBe(true);
    expect(res.status).toBe(200);
  });

  it('reflects resolvable Telnyx secrets in telephony.publicKey without gating ok', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@localhost/db');
    vi.stubEnv('AUTH_SECRET', 'test-secret');
    vi.stubEnv('GROQ_API_KEY', 'test-key');
    // Fully control the Telnyx env for determinism (tests/setup.ts pre-populates
    // apiKey/connectionId/webhookUrl). getTelnyxPublicKey falls back to
    // process.env outside a CF worker; a trailing newline is the GCP-SM trap and
    // must be trimmed to a truthy value.
    vi.stubEnv('TELNYX_PUBLIC_KEY', 'ed25519-base64-publickey\n');
    vi.stubEnv('TELNYX_API_KEY', 'KEY123');
    vi.stubEnv('TELNYX_CONNECTION_ID', ''); // blank → not resolvable (false)
    vi.stubEnv('TELNYX_WEBHOOK_URL', ''); // blank → not resolvable (false)

    const res = await GET();
    const body = await res.json();

    expect(body.telephony.publicKey).toBe(true);
    expect(body.telephony.apiKey).toBe(true);
    expect(body.telephony.connectionId).toBe(false);
    expect(body.telephony.webhookUrl).toBe(false);
    // Core-loop vars all present → still 200/ok regardless of partial telephony.
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    // Never leak the secret VALUES — booleans only.
    expect(JSON.stringify(body.telephony)).not.toMatch(/ed25519-base64-publickey|KEY123/);
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
