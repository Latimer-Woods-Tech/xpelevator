import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `/api/debug/groq` fires a live, BILLABLE Groq completion on every GET. It is
 * ADMIN-gated, but #157 flagged it had no throttle — a stolen admin session or
 * a mis-wired monitor could loop it and burn LLM spend. It now runs the shared
 * per-IP DB-backed limiter AFTER auth and short-circuits to 429 before the paid
 * call.
 *
 * This suite is the proof-of-rejection (Standing Law 1): over budget → the
 * handler returns 429 and NEVER reaches `getGroqClient` (no billable call).
 * It also pins the ordering (auth before throttle) and the happy path.
 */

// Hoisted so the (hoisted) vi.mock factories can reference these safely.
// AuthError mirrors the real class (message + numeric `status`) so the route's
// `error instanceof AuthError` branch resolves against the mocked module.
const { AuthError, requireAuth, enforceRateLimit, chatCompletion, getGroqClient } = vi.hoisted(
  () => {
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
      chatCompletion: vi.fn(),
      // Spy on the billable dependency: the whole point is proving it is NOT
      // called when the caller is over budget (or unauthenticated).
      getGroqClient: vi.fn(),
    };
  }
);

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

const req = () => new Request('http://localhost/api/debug/groq');

beforeEach(() => {
  requireAuth.mockReset();
  enforceRateLimit.mockReset();
  getGroqClient.mockClear();
  chatCompletion.mockReset();
});

describe('GET /api/debug/groq — billable-call throttle (#157)', () => {
  it('proof-of-rejection: over budget → 429 and the billable Groq call is SKIPPED', async () => {
    requireAuth.mockResolvedValue({ role: 'ADMIN' });
    enforceRateLimit.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Too many requests' }), {
        status: 429,
        headers: { 'Retry-After': '60' },
      })
    );

    const res = await GET(req() as never);

    expect(res.status).toBe(429);
    // The paid Groq client is never constructed nor called.
    expect(getGroqClient).not.toHaveBeenCalled();
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

  it('under budget → runs the diagnostic (200) and reports a successful probe', async () => {
    requireAuth.mockResolvedValue({ role: 'ADMIN' });
    enforceRateLimit.mockResolvedValue(null);
    getGroqClient.mockReturnValue({ chatCompletion });
    chatCompletion.mockResolvedValue({
      choices: [{ message: { content: 'test successful' } }],
      model: 'llama-3.3-70b-versatile',
    });

    const res = await GET(req() as never);
    const body = (await res.json()) as { success: boolean; response: string };

    expect(res.status).toBe(200);
    expect(getGroqClient).toHaveBeenCalledOnce();
    expect(chatCompletion).toHaveBeenCalledOnce();
    expect(body.success).toBe(true);
    expect(body.response).toBe('test successful');
  });
});
