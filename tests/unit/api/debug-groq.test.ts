import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `/api/debug/groq` is the ADMIN diagnostic for the Groq scoring credential.
 * It used to fire a live, BILLABLE completion ("Say test successful") on every
 * GET. It now runs a models probe instead (Plan W1.12, #5238): `GET /v1/models`
 * plus a check that the model ids the app calls are still offered — the same
 * probe `scripts/uptime-check.mjs` runs. Zero completions.
 *
 * Proof-of-rejection (Standing Law 1):
 *   - the probe tests assert `chatCompletion` is NEVER called; they fail on the
 *     old route, which always made one completion;
 *   - over budget → 429 and the Groq client is never constructed (#157);
 *   - unauthenticated → 401 before the limiter runs.
 */

// Hoisted so the (hoisted) vi.mock factories can reference these safely.
// AuthError mirrors the real class (message + numeric `status`) so the route's
// `error instanceof AuthError` branch resolves against the mocked module.
const {
  AuthError,
  requireAuth,
  enforceRateLimit,
  chatCompletion,
  listModels,
  getGroqClient,
} = vi.hoisted(() => {
  class AuthError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = 'AuthError';
      this.status = status;
    }
  }
  return {
    AuthError,
    requireAuth: vi.fn(),
    enforceRateLimit: vi.fn(),
    // The billable call: the route must never reach it.
    chatCompletion: vi.fn(),
    // The non-billable probe the route runs instead.
    listModels: vi.fn(),
    getGroqClient: vi.fn(),
  };
});

vi.mock('@/lib/auth-api', () => ({
  AuthError,
  requireAuth: (...args: unknown[]) => requireAuth(...args),
}));

vi.mock('@/lib/rate-limit', () => ({
  enforceRateLimit: (...args: unknown[]) => enforceRateLimit(...args),
}));

vi.mock('@/lib/groq-fetch', () => ({
  getGroqClient: () => getGroqClient(),
}));

vi.mock('@/lib/runtime-env', () => ({
  getRuntimeEnv: () => 'gsk_test_key_value',
}));

import { GET } from '@/app/api/debug/groq/route';
import { CUSTOMER_MODEL_FAST, CUSTOMER_MODEL_REALISM } from '@/lib/ai';

const req = () => new Request('http://localhost/api/debug/groq');

type ProbeBody = {
  success: boolean;
  probe: string;
  models?: { required: string[]; missing: string[]; offered: number };
  error?: { message: string; status?: number };
};

beforeEach(() => {
  requireAuth.mockReset();
  enforceRateLimit.mockReset();
  getGroqClient.mockReset();
  chatCompletion.mockReset();
  listModels.mockReset();
  getGroqClient.mockReturnValue({ chatCompletion, listModels });
});

describe('GET /api/debug/groq — auth gate + throttle (#157)', () => {
  it('proof-of-rejection: over budget → 429 and the Groq client is never built', async () => {
    requireAuth.mockResolvedValue({ role: 'ADMIN' });
    enforceRateLimit.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Too many requests' }), {
        status: 429,
        headers: { 'Retry-After': '60' },
      })
    );

    const res = await GET(req() as never);

    expect(res.status).toBe(429);
    expect(getGroqClient).not.toHaveBeenCalled();
    expect(listModels).not.toHaveBeenCalled();
    expect(chatCompletion).not.toHaveBeenCalled();
    // Throttle keyed on the dedicated bucket namespace.
    expect(enforceRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      'debug-groq',
      expect.objectContaining({ limit: 6, windowMs: 60_000 })
    );
  });

  it('anonymous caller → 401 BEFORE the limiter runs (no wasted DB write)', async () => {
    requireAuth.mockRejectedValue(new AuthError('Unauthorized', 401));

    const res = await GET(req() as never);

    expect(res.status).toBe(401);
    expect(enforceRateLimit).not.toHaveBeenCalled();
    expect(getGroqClient).not.toHaveBeenCalled();
  });

  it('non-ADMIN caller → 403 and no probe', async () => {
    requireAuth.mockRejectedValue(new AuthError('Forbidden', 403));

    const res = await GET(req() as never);

    expect(res.status).toBe(403);
    expect(requireAuth).toHaveBeenCalledWith(expect.anything(), 'ADMIN');
    expect(getGroqClient).not.toHaveBeenCalled();
  });
});

describe('GET /api/debug/groq — models probe, zero completions (W1.12)', () => {
  beforeEach(() => {
    requireAuth.mockResolvedValue({ role: 'ADMIN' });
    enforceRateLimit.mockResolvedValue(null);
  });

  it('proof-of-rejection: all required models offered → success, and NO completion is made', async () => {
    listModels.mockResolvedValue([CUSTOMER_MODEL_REALISM, CUSTOMER_MODEL_FAST, 'other/model']);

    const res = await GET(req() as never);
    const body = (await res.json()) as ProbeBody;

    expect(res.status).toBe(200);
    expect(chatCompletion).not.toHaveBeenCalled();
    expect(listModels).toHaveBeenCalledOnce();
    expect(body.success).toBe(true);
    expect(body.probe).toBe('models');
    expect(body.models).toEqual({
      required: [CUSTOMER_MODEL_REALISM, CUSTOMER_MODEL_FAST],
      missing: [],
      offered: 3,
    });
  });

  it('a decommissioned model (the #248 failure mode) → success false, names the missing id', async () => {
    listModels.mockResolvedValue([CUSTOMER_MODEL_FAST]);

    const res = await GET(req() as never);
    const body = (await res.json()) as ProbeBody;

    expect(res.status).toBe(200);
    expect(chatCompletion).not.toHaveBeenCalled();
    expect(body.success).toBe(false);
    expect(body.models?.missing).toEqual([CUSTOMER_MODEL_REALISM]);
  });

  it('a rejected credential → success false with the upstream status, no completion', async () => {
    listModels.mockRejectedValue(
      Object.assign(new Error('Groq API error: 401 - bad key'), { status: 401 })
    );

    const res = await GET(req() as never);
    const body = (await res.json()) as ProbeBody;

    expect(res.status).toBe(200);
    expect(chatCompletion).not.toHaveBeenCalled();
    expect(body.success).toBe(false);
    expect(body.error?.status).toBe(401);
    expect(body.error?.message).toContain('401');
  });
});
