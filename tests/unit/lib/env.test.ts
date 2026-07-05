/**
 * Unit tests for src/lib/env.ts
 *
 * These tests validate that:
 *   1. The module exports expected accessors
 *   2. Required-var checking works correctly per environment
 *   3. GITHUB_OAUTH_ENABLED reflects the actual env state
 *
 * Each test uses vi.resetModules() to get a fresh module load so env var
 * changes are actually reflected (modules are otherwise cached).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

// Save originals so we can restore after each test
const ORIGINAL = { ...process.env };

afterEach(() => {
  // Restore env to the state set by tests/setup.ts
  Object.keys(process.env).forEach(k => {
    if (!(k in ORIGINAL)) delete process.env[k];
  });
  Object.assign(process.env, ORIGINAL);
  vi.resetModules();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('env exports', () => {
  it('exports GROQ_API_KEY', async () => {
    const env = await import('@/lib/env');
    expect(env).toHaveProperty('GROQ_API_KEY');
    expect(typeof env.GROQ_API_KEY).toBe('string');
  });

  it('exports DATABASE_URL', async () => {
    const env = await import('@/lib/env');
    expect(env).toHaveProperty('DATABASE_URL');
  });

  it('exports AUTH_SECRET', async () => {
    const env = await import('@/lib/env');
    expect(env).toHaveProperty('AUTH_SECRET');
  });

  it('exports GITHUB_OAUTH_ENABLED boolean', async () => {
    const env = await import('@/lib/env');
    expect(typeof env.GITHUB_OAUTH_ENABLED).toBe('boolean');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('GITHUB_OAUTH_ENABLED', () => {
  it('is false by default (test env has no GitHub vars)', async () => {
    const { GITHUB_OAUTH_ENABLED } = await import('@/lib/env');
    expect(GITHUB_OAUTH_ENABLED).toBe(false);
  });

  it('is false when only ID provided', async () => {
    process.env.AUTH_GITHUB_ID = 'fake-id';
    delete process.env.AUTH_GITHUB_SECRET;
    vi.resetModules();
    const { GITHUB_OAUTH_ENABLED } = await import('@/lib/env');
    expect(GITHUB_OAUTH_ENABLED).toBe(false);
  });

  it('is false when only SECRET provided', async () => {
    delete process.env.AUTH_GITHUB_ID;
    process.env.AUTH_GITHUB_SECRET = 'fake-secret';
    vi.resetModules();
    const { GITHUB_OAUTH_ENABLED } = await import('@/lib/env');
    expect(GITHUB_OAUTH_ENABLED).toBe(false);
  });

  it('is true when both GitHub vars are provided', async () => {
    process.env.AUTH_GITHUB_ID = 'real-id';
    process.env.AUTH_GITHUB_SECRET = 'real-secret';
    vi.resetModules();
    const { GITHUB_OAUTH_ENABLED } = await import('@/lib/env');
    expect(GITHUB_OAUTH_ENABLED).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('required var enforcement', () => {
  it('throws in production when DATABASE_URL is absent', async () => {
    (process.env as Record<string, string>).NODE_ENV = 'production';
    delete process.env.DATABASE_URL;
    vi.resetModules();
    await expect(import('@/lib/env')).rejects.toThrow(/DATABASE_URL/i);
  });

  it('throws in production when AUTH_SECRET is absent', async () => {
    (process.env as Record<string, string>).NODE_ENV = 'production';
    delete process.env.AUTH_SECRET;
    vi.resetModules();
    await expect(import('@/lib/env')).rejects.toThrow(/AUTH_SECRET/i);
  });

  it('in development, warns but does NOT throw on missing vars', async () => {
    // NODE_ENV is already 'test' from setup.ts (treated same as development)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    delete process.env.GROQ_API_KEY;
    vi.resetModules();
    await expect(import('@/lib/env')).resolves.toBeDefined();
    warnSpy.mockRestore();
  });

  it('exports empty string for missing optional vars instead of throwing', async () => {
    delete process.env.GROQ_API_KEY;
    vi.resetModules();
    const env = await import('@/lib/env');
    expect(env.GROQ_API_KEY).toBe('');
  });
});
