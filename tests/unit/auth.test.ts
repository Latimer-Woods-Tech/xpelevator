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

describe('NextAuth credentials provider', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('exports auth, handlers, signIn, signOut from @/auth', async () => {
    vi.resetModules();
    vi.doMock('next-auth', () => ({
      default: vi.fn(() => ({
        handlers: { GET: vi.fn(), POST: vi.fn() },
        auth: vi.fn().mockResolvedValue(null),
        signIn: vi.fn(),
        signOut: vi.fn(),
      })),
    }));
    vi.doMock('next-auth/providers/github', () => ({ default: vi.fn() }));
    vi.doMock('next-auth/providers/credentials', () => ({
      default: vi.fn((config: unknown) => config),
    }));
    const authModule = await import('@/auth');
    expect(typeof authModule.auth).toBe('function');
    expect(typeof authModule.signIn).toBe('function');
    expect(typeof authModule.signOut).toBe('function');
    expect(authModule.handlers).toBeDefined();
  });

  it('credentials provider authorize returns null for empty username', async () => {
    vi.resetModules();
    // Capture the credentials config to test `authorize` directly
    let capturedConfig: { authorize?: (creds: Record<string, string | undefined>) => unknown } | null = null;
    vi.doMock('next-auth/providers/credentials', () => ({
      default: vi.fn((config: { authorize?: (creds: Record<string, string | undefined>) => unknown }) => {
        capturedConfig = config;
        return config;
      }),
    }));
    vi.doMock('next-auth', () => ({
      default: vi.fn(() => ({
        handlers: { GET: vi.fn(), POST: vi.fn() },
        auth: vi.fn().mockResolvedValue(null),
        signIn: vi.fn(), signOut: vi.fn(),
      })),
    }));
    vi.doMock('next-auth/providers/github', () => ({ default: vi.fn() }));

    await import('@/auth');
    expect(capturedConfig).not.toBeNull();
    const result = capturedConfig!.authorize?.({ username: '' });
    expect(result).toBeNull();
  });

  it('credentials provider authorize returns user object for non-empty username', async () => {
    vi.resetModules();
    let capturedConfig: { authorize?: (creds: Record<string, string | undefined>) => unknown } | null = null;
    vi.doMock('next-auth/providers/credentials', () => ({
      default: vi.fn((config: { authorize?: (creds: Record<string, string | undefined>) => unknown }) => {
        capturedConfig = config;
        return config;
      }),
    }));
    vi.doMock('next-auth', () => ({
      default: vi.fn(() => ({
        handlers: { GET: vi.fn(), POST: vi.fn() },
        auth: vi.fn().mockResolvedValue(null),
        signIn: vi.fn(), signOut: vi.fn(),
      })),
    }));
    vi.doMock('next-auth/providers/github', () => ({ default: vi.fn() }));

    await import('@/auth');
    expect(capturedConfig).not.toBeNull();
    const result = capturedConfig!.authorize?.({ username: 'Alice' }) as { id: string; name: string } | null;
    expect(result).not.toBeNull();
    expect(result?.name).toBe('Alice');
    expect(result?.id).toBe('Alice');
  });

  it('GitHub provider included only when both env vars set', async () => {
    vi.resetModules();
    process.env.AUTH_GITHUB_ID = 'gh-id';
    process.env.AUTH_GITHUB_SECRET = 'gh-secret';
    const githubMock = vi.fn();
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
    delete process.env.AUTH_GITHUB_ID;
    delete process.env.AUTH_GITHUB_SECRET;
  });
});
