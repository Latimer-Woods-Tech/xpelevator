/**
 * Unit tests for src/lib/runtime-env.ts — getRuntimeEnv.
 *
 * The resolver must prefer the Cloudflare runtime binding (the source of truth
 * in the deployed OpenNext Worker) and fall back to process.env only for local
 * dev / tests. Reading process.env directly reports a binding-only secret as
 * absent in production (#125) — the failure this helper exists to prevent.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * Load getRuntimeEnv with an optional stand-in for the Cloudflare runtime
 * binding. When cfEnv is provided, getCloudflareContext() returns it (the
 * production path). When omitted, getCloudflareContext throws (as it does
 * outside a Worker) and the resolver falls back to process.env.
 */
async function loadRuntimeEnv(cfEnv?: Record<string, string | undefined>) {
  vi.resetModules();
  if (cfEnv) {
    vi.doMock('@opennextjs/cloudflare', () => ({
      getCloudflareContext: () => ({ env: cfEnv }),
    }));
  } else {
    vi.doMock('@opennextjs/cloudflare', () => ({
      getCloudflareContext: () => {
        throw new Error('not in a Worker context');
      },
    }));
  }
  const mod = await import('@/lib/runtime-env');
  return mod.getRuntimeEnv;
}

describe('lib/runtime-env — getRuntimeEnv', () => {
  afterEach(() => {
    delete process.env.__RTE_TEST_KEY;
    vi.resetModules();
    vi.doUnmock('@opennextjs/cloudflare');
  });

  it('reads the value from the Cloudflare runtime binding (production path)', async () => {
    const getRuntimeEnv = await loadRuntimeEnv({ __RTE_TEST_KEY: 'from-binding' });
    // process.env deliberately unset — proves the binding is the source of truth
    delete process.env.__RTE_TEST_KEY;
    expect(getRuntimeEnv('__RTE_TEST_KEY')).toBe('from-binding');
  });

  it('prefers the binding over a differing process.env value', async () => {
    const getRuntimeEnv = await loadRuntimeEnv({ __RTE_TEST_KEY: 'from-binding' });
    process.env.__RTE_TEST_KEY = 'from-process-env';
    expect(getRuntimeEnv('__RTE_TEST_KEY')).toBe('from-binding');
  });

  it('falls back to process.env when the binding is unavailable (local dev)', async () => {
    const getRuntimeEnv = await loadRuntimeEnv();
    process.env.__RTE_TEST_KEY = 'from-process-env';
    expect(getRuntimeEnv('__RTE_TEST_KEY')).toBe('from-process-env');
  });

  it('trims a trailing newline/CR (the GCP Secret Manager trap)', async () => {
    const getRuntimeEnv = await loadRuntimeEnv({ __RTE_TEST_KEY: 'gsk_live\r\n' });
    expect(getRuntimeEnv('__RTE_TEST_KEY')).toBe('gsk_live');
  });

  it('treats a whitespace-only value as unset', async () => {
    const getRuntimeEnv = await loadRuntimeEnv({ __RTE_TEST_KEY: '  \n' });
    expect(getRuntimeEnv('__RTE_TEST_KEY')).toBeUndefined();
  });

  it('returns undefined when unset in both the binding and process.env', async () => {
    const getRuntimeEnv = await loadRuntimeEnv({});
    delete process.env.__RTE_TEST_KEY;
    expect(getRuntimeEnv('__RTE_TEST_KEY')).toBeUndefined();
  });
});
