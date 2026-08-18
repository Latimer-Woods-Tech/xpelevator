/**
 * Unit tests for the Worker-safe PostHog product-event sink (src/lib/posthog.ts,
 * #154). The sink is the sibling half of the Sentry error sink: it captures the
 * core-loop "session_scored" product event. These tests exercise the pure
 * resolver + body builder deterministically and drive `captureEvent` /
 * `dispatchEvent` with an INJECTED fetch (never a live network call), so the
 * suite stays in the deterministic CI tier.
 *
 * Standing Law 1 (proof-of-rejection) is honoured throughout: each guard is
 * proven to REJECT the bad input, not merely accept the good one — an empty key
 * or malformed host yields `null`, an unset key no-ops WITHOUT ever calling
 * fetch, an empty distinct id is refused, and the sink swallows a throwing /
 * non-2xx transport instead of surfacing it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_POSTHOG_HOST,
  buildCaptureBody,
  captureEvent,
  dispatchEvent,
  resolvePosthog,
} from '@/lib/posthog';

const KEY = 'phc_test_project_key';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.POSTHOG_KEY;
  delete process.env.POSTHOG_HOST;
});

describe('resolvePosthog()', () => {
  it('resolves a key to the default US-cloud /capture/ URL', () => {
    const cfg = resolvePosthog(KEY);
    expect(cfg).not.toBeNull();
    expect(cfg!.apiKey).toBe(KEY);
    expect(cfg!.captureUrl).toBe(`${DEFAULT_POSTHOG_HOST}/capture/`);
  });

  it('honours a custom host (self-hosted / EU cloud), keeping port', () => {
    expect(resolvePosthog(KEY, 'https://eu.i.posthog.com')!.captureUrl).toBe(
      'https://eu.i.posthog.com/capture/'
    );
    expect(resolvePosthog(KEY, 'http://localhost:8000')!.captureUrl).toBe(
      'http://localhost:8000/capture/'
    );
  });

  it('trims surrounding whitespace off the key', () => {
    expect(resolvePosthog(`  ${KEY}  `)!.apiKey).toBe(KEY);
  });

  // ── Proof-of-rejection: bad inputs resolve to null ──────────────────────────
  it.each([undefined, null, '', '   '])('rejects an empty key (%p) → null', (bad) => {
    expect(resolvePosthog(bad as string | undefined | null)).toBeNull();
  });

  it.each(['not-a-url', 'ftp://posthog.example', 'posthog.example.com'])(
    'rejects a non-http(s) host (%p) → null',
    (host) => {
      expect(resolvePosthog(KEY, host)).toBeNull();
    }
  );

  it('falls back to the default host when host is blank', () => {
    expect(resolvePosthog(KEY, '   ')!.captureUrl).toBe(`${DEFAULT_POSTHOG_HOST}/capture/`);
  });
});

describe('buildCaptureBody()', () => {
  it('builds the /capture/ payload with api_key, event, distinct_id, $lib and ISO ts', () => {
    const body = JSON.parse(
      buildCaptureBody(KEY, 'session_scored', 'user-1', { scoringStatus: 'SCORED' }, 0)
    );
    expect(body).toMatchObject({
      api_key: KEY,
      event: 'session_scored',
      distinct_id: 'user-1',
      properties: { scoringStatus: 'SCORED', $lib: 'xpelevator-worker' },
      timestamp: '1970-01-01T00:00:00.000Z',
    });
  });
});

describe('captureEvent()', () => {
  it('POSTs the envelope and returns true on a 2xx', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"status":1}', { status: 200 }));
    const ok = await captureEvent(
      'session_scored',
      'user-1',
      { modality: 'CHAT' },
      { apiKey: KEY, now: 0, fetchImpl: fetchImpl as unknown as typeof fetch }
    );
    expect(ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${DEFAULT_POSTHOG_HOST}/capture/`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toMatchObject({
      api_key: KEY,
      event: 'session_scored',
      distinct_id: 'user-1',
    });
  });

  // ── Proof-of-rejection ──────────────────────────────────────────────────────
  it('no-ops and NEVER calls fetch when the key is unset', async () => {
    const fetchImpl = vi.fn();
    const ok = await captureEvent('session_scored', 'user-1', {}, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses an empty distinct id WITHOUT calling fetch', async () => {
    const fetchImpl = vi.fn();
    const ok = await captureEvent('session_scored', '   ', {}, {
      apiKey: KEY,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('swallows a throwing transport → false (never throws)', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });
    await expect(
      captureEvent('e', 'user-1', {}, { apiKey: KEY, fetchImpl: fetchImpl as unknown as typeof fetch })
    ).resolves.toBe(false);
  });

  it('treats a non-2xx ingest response as failure → false', async () => {
    const fetchImpl = vi.fn(async () => new Response('rate limited', { status: 429 }));
    const ok = await captureEvent('e', 'user-1', {}, {
      apiKey: KEY,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(ok).toBe(false);
  });
});

describe('dispatchEvent()', () => {
  it('returns null and does no work when POSTHOG_KEY is unset', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(dispatchEvent('session_scored', 'user-1', {})).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('schedules a capture (fire-and-forget) when POSTHOG_KEY is set', async () => {
    process.env.POSTHOG_KEY = KEY;
    const fetchSpy = vi.fn(async () => new Response('{"status":1}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const p = dispatchEvent('session_scored', 'user-1', { scoringStatus: 'SCORED' });
    expect(p).not.toBeNull();
    await expect(p).resolves.toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('hands the capture to the platform waitUntil so it survives the response', async () => {
    process.env.POSTHOG_KEY = KEY;
    const fetchSpy = vi.fn(async () => new Response('{"status":1}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const waitUntil = vi.fn();
    // Emulate the OpenNext/Cloudflare request context getWaitUntil() reads.
    const ctxKey = Symbol.for('__cloudflare-context__');
    (globalThis as unknown as Record<symbol, unknown>)[ctxKey] = { ctx: { waitUntil } };
    try {
      const p = dispatchEvent('session_scored', 'user-1', {});
      expect(p).not.toBeNull();
      await p;
      expect(waitUntil).toHaveBeenCalledTimes(1);
    } finally {
      delete (globalThis as unknown as Record<symbol, unknown>)[ctxKey];
    }
  });
});
