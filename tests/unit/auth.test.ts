/**
 * Unit tests for auth configuration (src/auth.ts).
 *
 * Root cause this covers:
 *   When AUTH_GITHUB_ID / AUTH_GITHUB_SECRET are not set, NextAuth v5
 *   previously threw "server configuration" errors on every /api/auth/session
 *   call, causing a 500 cascade to useSession() in all client components.
 *
 * These tests verify the guard is in place.
 *
 * Note: next-auth is mocked at the module level to avoid 'next/server'
 * import resolution issues in the vitest/node environment.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mock next-auth and its providers to avoid Next.js edge-runtime imports ────
vi.mock('next-auth', () => ({
  default: vi.fn(() => ({
    handlers: { GET: vi.fn(), POST: vi.fn() },
    auth: vi.fn().mockResolvedValue(null),
    signIn: vi.fn(),
    signOut: vi.fn(),
  })),
}));
vi.mock('next-auth/providers/github', () => ({ default: vi.fn() }));
vi.mock('next-auth/providers/credentials', () => ({
  default: vi.fn((config: { authorize?: (creds: Record<string, string>) => unknown }) => config),
}));

// ── helpers ───────────────────────────────────────────────────────────────────

function clearGithubEnv() {
  delete process.env.AUTH_GITHUB_ID;
  delete process.env.AUTH_GITHUB_SECRET;
}

function setGithubEnv() {
  process.env.AUTH_GITHUB_ID = 'test-github-client-id';
  process.env.AUTH_GITHUB_SECRET = 'test-github-client-secret';
}

// ── GITHUB_OAUTH_ENABLED accessor ─────────────────────────────────────────────

describe('GITHUB_OAUTH_ENABLED (src/lib/env.ts)', () => {
  beforeEach(clearGithubEnv);
  afterEach(clearGithubEnv);

  it('is false when neither GitHub env var is set', async () => {
    vi.resetModules();
    vi.mock('next-auth', () => ({ default: vi.fn(() => ({ handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() })) }));
    vi.mock('next-auth/providers/github', () => ({ default: vi.fn() }));
    vi.mock('next-auth/providers/credentials', () => ({ default: vi.fn((c: unknown) => c) }));
    const { GITHUB_OAUTH_ENABLED } = await import('@/lib/env');
    expect(GITHUB_OAUTH_ENABLED).toBe(false);
  });

  it('is false when only AUTH_GITHUB_ID is set', async () => {
    process.env.AUTH_GITHUB_ID = 'only-id';
    vi.resetModules();
    vi.mock('next-auth', () => ({ default: vi.fn(() => ({ handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() })) }));
    vi.mock('next-auth/providers/github', () => ({ default: vi.fn() }));
    vi.mock('next-auth/providers/credentials', () => ({ default: vi.fn((c: unknown) => c) }));
    const { GITHUB_OAUTH_ENABLED } = await import('@/lib/env');
    expect(GITHUB_OAUTH_ENABLED).toBe(false);
  });

  it('is false when only AUTH_GITHUB_SECRET is set', async () => {
    process.env.AUTH_GITHUB_SECRET = 'only-secret';
    vi.resetModules();
    vi.mock('next-auth', () => ({ default: vi.fn(() => ({ handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() })) }));
    vi.mock('next-auth/providers/github', () => ({ default: vi.fn() }));
    vi.mock('next-auth/providers/credentials', () => ({ default: vi.fn((c: unknown) => c) }));
    const { GITHUB_OAUTH_ENABLED } = await import('@/lib/env');
    expect(GITHUB_OAUTH_ENABLED).toBe(false);
  });

  it('is true when both GitHub env vars are set', async () => {
    setGithubEnv();
    vi.resetModules();
    vi.mock('next-auth', () => ({ default: vi.fn(() => ({ handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() })) }));
    vi.mock('next-auth/providers/github', () => ({ default: vi.fn() }));
    vi.mock('next-auth/providers/credentials', () => ({ default: vi.fn((c: unknown) => c) }));
    const { GITHUB_OAUTH_ENABLED } = await import('@/lib/env');
    expect(GITHUB_OAUTH_ENABLED).toBe(true);
  });
});

// ── env.ts validates required vars ────────────────────────────────────────────

describe('env.ts — required variable validation', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    Object.assign(process.env, originalEnv);
    vi.resetModules();
  });

  it('does not throw when all required vars are present (test setup)', async () => {
    vi.mock('next-auth', () => ({ default: vi.fn(() => ({ handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() })) }));
    vi.mock('next-auth/providers/github', () => ({ default: vi.fn() }));
    vi.mock('next-auth/providers/credentials', () => ({ default: vi.fn((c: unknown) => c) }));
    await expect(import('@/lib/env')).resolves.not.toThrow();
  });

  it('throws in production when DATABASE_URL is missing', async () => {
    (process.env as Record<string, string>).NODE_ENV = 'production';
    delete process.env.DATABASE_URL;
    vi.resetModules();
    vi.mock('next-auth', () => ({ default: vi.fn(() => ({ handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() })) }));
    vi.mock('next-auth/providers/github', () => ({ default: vi.fn() }));
    vi.mock('next-auth/providers/credentials', () => ({ default: vi.fn((c: unknown) => c) }));
    await expect(import('@/lib/env')).rejects.toThrow('DATABASE_URL');
    (process.env as Record<string, string>).NODE_ENV = 'test';
  });

  it('throws in production when AUTH_SECRET is missing', async () => {
    (process.env as Record<string, string>).NODE_ENV = 'production';
    delete process.env.AUTH_SECRET;
    vi.resetModules();
    vi.mock('next-auth', () => ({ default: vi.fn(() => ({ handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() })) }));
    vi.mock('next-auth/providers/github', () => ({ default: vi.fn() }));
    vi.mock('next-auth/providers/credentials', () => ({ default: vi.fn((c: unknown) => c) }));
    await expect(import('@/lib/env')).rejects.toThrow('AUTH_SECRET');
    (process.env as Record<string, string>).NODE_ENV = 'test';
  });

  it('warns but does not throw in development when a var is missing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    delete process.env.GROQ_API_KEY;
    vi.resetModules();
    vi.mock('next-auth', () => ({ default: vi.fn(() => ({ handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() })) }));
    vi.mock('next-auth/providers/github', () => ({ default: vi.fn() }));
    vi.mock('next-auth/providers/credentials', () => ({ default: vi.fn((c: unknown) => c) }));
    await expect(import('@/lib/env')).resolves.not.toThrow();
    warnSpy.mockRestore();
  });
});

// ── NextAuth configuration ────────────────────────────────────────────────────

// The Credentials provider now looks a user up by email via @/lib/db `sql`
// (a Neon tagged-template query fn). We mock it so `authorize` is fully
// deterministic and never touches a real database.
type AuthorizeCreds = Record<string, string | undefined>;
type CapturedConfig = { authorize?: (creds: AuthorizeCreds) => unknown } | null;

/** Install the standard next-auth mocks and a controllable `sql` mock. */
function mockAuthDeps(sqlImpl: (...args: unknown[]) => unknown = () => Promise.resolve([])) {
  const sqlMock = vi.fn(sqlImpl);
  vi.doMock('@/lib/db', () => ({ sql: sqlMock, default: sqlMock }));
  vi.doMock('next-auth/providers/github', () => ({ default: vi.fn() }));
  vi.doMock('next-auth', () => ({
    default: vi.fn((config: { providers?: unknown[] } = {}) => ({
      handlers: { GET: vi.fn(), POST: vi.fn() },
      auth: vi.fn().mockResolvedValue(null),
      signIn: vi.fn(),
      signOut: vi.fn(),
      _providers: config.providers,
    })),
  }));
  return sqlMock;
}

describe('NextAuth credentials provider', () => {
  afterEach(() => {
    vi.resetModules();
    delete process.env.AUTH_GITHUB_ID;
    delete process.env.AUTH_GITHUB_SECRET;
    delete process.env.CREDENTIALS_REQUIRE_EXISTING;
  });

  it('exports auth, handlers, signIn, signOut from @/auth', async () => {
    vi.resetModules();
    mockAuthDeps();
    vi.doMock('next-auth/providers/credentials', () => ({
      default: vi.fn((config: unknown) => config),
    }));
    const authModule = await import('@/auth');
    expect(typeof authModule.auth).toBe('function');
    expect(typeof authModule.signIn).toBe('function');
    expect(typeof authModule.signOut).toBe('function');
    expect(authModule.handlers).toBeDefined();
  });

  it('authorize returns null when the email is empty or malformed', async () => {
    vi.resetModules();
    let captured: CapturedConfig = null;
    mockAuthDeps();
    vi.doMock('next-auth/providers/credentials', () => ({
      default: vi.fn((config: NonNullable<CapturedConfig>) => {
        captured = config;
        return config;
      }),
    }));

    await import('@/auth');
    expect(captured).not.toBeNull();
    await expect(captured!.authorize?.({ email: '' })).resolves.toBeNull();
    await expect(captured!.authorize?.({ email: 'not-an-email' })).resolves.toBeNull();
  });

  it('authorize returns the existing user for a valid email', async () => {
    vi.resetModules();
    let captured: CapturedConfig = null;
    // First (SELECT) query returns an existing user row.
    mockAuthDeps(() =>
      Promise.resolve([
        { id: 'u1', email: 'alice@example.com', name: 'Alice', role: 'ADMIN' },
      ])
    );
    vi.doMock('next-auth/providers/credentials', () => ({
      default: vi.fn((config: NonNullable<CapturedConfig>) => {
        captured = config;
        return config;
      }),
    }));

    await import('@/auth');
    const result = (await captured!.authorize?.({ email: 'Alice@Example.com' })) as {
      id: string;
      email: string;
      role: string;
    } | null;
    expect(result).not.toBeNull();
    expect(result?.id).toBe('u1');
    expect(result?.email).toBe('alice@example.com'); // normalised to lowercase
    expect(result?.role).toBe('ADMIN');
  });

  it('authorize auto-creates a user in dev/demo mode when none exists', async () => {
    vi.resetModules();
    let captured: CapturedConfig = null;
    let call = 0;
    // 1st call (SELECT) → no user; 2nd call (INSERT ... RETURNING) → created row.
    mockAuthDeps(() => {
      call += 1;
      if (call === 1) return Promise.resolve([]);
      return Promise.resolve([
        { id: 'u2', email: 'bob@example.com', name: 'bob', role: 'MEMBER' },
      ]);
    });
    vi.doMock('next-auth/providers/credentials', () => ({
      default: vi.fn((config: NonNullable<CapturedConfig>) => {
        captured = config;
        return config;
      }),
    }));

    await import('@/auth');
    const result = (await captured!.authorize?.({ email: 'bob@example.com' })) as {
      id: string;
      email: string;
    } | null;
    expect(result).not.toBeNull();
    expect(result?.id).toBe('u2');
    expect(result?.email).toBe('bob@example.com');
  });

  it('GitHub provider included only when both env vars set', async () => {
    vi.resetModules();
    process.env.AUTH_GITHUB_ID = 'gh-id';
    process.env.AUTH_GITHUB_SECRET = 'gh-secret';
    const githubMock = vi.fn();
    const sqlMock = vi.fn(() => Promise.resolve([]));
    vi.doMock('@/lib/db', () => ({ sql: sqlMock, default: sqlMock }));
    vi.doMock('next-auth/providers/github', () => ({ default: githubMock }));
    vi.doMock('next-auth/providers/credentials', () => ({ default: vi.fn((c: unknown) => c) }));
    let capturedProviders: unknown[] = [];
    vi.doMock('next-auth', () => ({
      default: vi.fn((config: { providers: unknown[] }) => {
        capturedProviders = config.providers;
        return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
      }),
    }));
    await import('@/auth');
    expect(capturedProviders.some(p => p === githubMock)).toBe(true);
  });
});
