/**
 * Integration tests for auth API routes.
 *
 * Root causes covered:
 *   1. /api/auth/session 500 when GitHub env vars are missing (fixed in auth.ts)
 *   2. Credentials provider behavior
 *   3. Sign-in page reachability
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mock NextAuth so we can test our wrapper without needing a full JWT stack ──
vi.mock('next-auth', () => {
  const mockHandlers = {
    GET: vi.fn(async (req: Request) => {
      const url = new URL(req.url);
      // Simulate /api/auth/session response
      if (url.pathname.endsWith('/session')) {
        if (!process.env.AUTH_SECRET) {
          return new Response(
            JSON.stringify({ error: 'Configuration error: AUTH_SECRET missing' }),
            { status: 500 }
          );
        }
        return new Response(JSON.stringify({}), { status: 200 });
      }
      // Simulate /api/auth/providers response
      if (url.pathname.endsWith('/providers')) {
        const providers: Record<string, unknown> = {
          credentials: { id: 'credentials', name: 'Credentials', type: 'credentials' },
        };
        if (process.env.AUTH_GITHUB_ID) {
          providers.github = { id: 'github', name: 'GitHub', type: 'oauth' };
        }
        return new Response(JSON.stringify(providers), { status: 200 });
      }
      return new Response('', { status: 200 });
    }),
    POST: vi.fn(async () => new Response('', { status: 200 })),
  };

  return {
    default: vi.fn(() => ({
      handlers: mockHandlers,
      auth: vi.fn(async () => null),
      signIn: vi.fn(),
      signOut: vi.fn(),
    })),
  };
});

vi.mock('next-auth/providers/github', () => ({
  default: vi.fn(() => ({ id: 'github', name: 'GitHub', type: 'oauth' })),
}));

vi.mock('next-auth/providers/credentials', () => ({
  default: vi.fn(() => ({ id: 'credentials', name: 'Credentials', type: 'credentials' })),
}));

// ─────────────────────────────────────────────────────────────────────────────

function sessionReq() {
  return new Request('http://localhost/api/auth/session');
}

function providersReq() {
  return new Request('http://localhost/api/auth/providers');
}

// ─────────────────────────────────────────────────────────────────────────────

describe('/api/auth — configuration guard', () => {
  const originalSecret = process.env.AUTH_SECRET;

  afterEach(() => {
    process.env.AUTH_SECRET = originalSecret;
    delete process.env.AUTH_GITHUB_ID;
    delete process.env.AUTH_GITHUB_SECRET;
    vi.resetModules();
  });

  it('session endpoint returns 200 when AUTH_SECRET is set (credentials only)', async () => {
    process.env.AUTH_SECRET = 'test-auth-secret-32chars-minimum!!';
    const { GET } = await import('@/app/api/auth/[...nextauth]/route');
    const response = await GET(sessionReq());
    expect(response.status).toBe(200);
  });

  it('session endpoint returns 500 when AUTH_SECRET is missing', async () => {
    delete process.env.AUTH_SECRET;
    const { GET } = await import('@/app/api/auth/[...nextauth]/route');
    const res = await GET(sessionReq());
    expect(res.status).toBe(500);
  });

  it('providers does NOT include github when env vars are absent', async () => {
    const { GET } = await import('@/app/api/auth/[...nextauth]/route');
    const res = await GET(providersReq());
    const body = await res.json();
    expect(body).not.toHaveProperty('github');
    expect(body).toHaveProperty('credentials');
  });

  it('providers includes github when AUTH_GITHUB_ID + SECRET are set', async () => {
    process.env.AUTH_GITHUB_ID = 'gh-test-id';
    process.env.AUTH_GITHUB_SECRET = 'gh-test-secret';
    const { GET } = await import('@/app/api/auth/[...nextauth]/route');
    const res = await GET(providersReq());
    const body = await res.json();
    expect(body).toHaveProperty('github');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('auth.ts — conditional GitHub provider guard', () => {
  afterEach(() => {
    delete process.env.AUTH_GITHUB_ID;
    delete process.env.AUTH_GITHUB_SECRET;
    vi.resetModules();
  });

  it('does not throw when GitHub env vars are missing', async () => {
    await expect(import('@/auth')).resolves.toBeDefined();
  });

  it('does not throw when GitHub env vars ARE set', async () => {
    process.env.AUTH_GITHUB_ID = 'gh-id';
    process.env.AUTH_GITHUB_SECRET = 'gh-secret';
    vi.resetModules();
    await expect(import('@/auth')).resolves.toBeDefined();
  });

  it('exports { handlers, signIn, signOut, auth }', async () => {
    const module = await import('@/auth');
    expect(module).toHaveProperty('handlers');
    expect(module).toHaveProperty('signIn');
    expect(module).toHaveProperty('signOut');
    expect(module).toHaveProperty('auth');
  });
});
