/**
 * Unit tests for the Worker-safe Sentry error sink (src/lib/sentry.ts, #154).
 *
 * The sink is the secret-dependent half of the #154 observability foundation:
 * `log('error', …)` fires a best-effort capture to Sentry. These tests exercise
 * the pure DSN parser + envelope builder deterministically, and drive
 * `captureException` / `dispatchCapture` with an INJECTED fetch (never a live
 * network call), so the suite stays in the deterministic CI tier.
 *
 * Standing Law 1 (proof-of-rejection) is honoured throughout: each guard is
 * proven to REJECT the bad input, not merely accept the good one — a malformed
 * DSN yields `null`/`false`, an unset DSN no-ops, and the sink swallows a
 * throwing transport instead of surfacing it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildEnvelope,
  captureException,
  dispatchCapture,
  getWaitUntil,
  newEventId,
  parseDsn,
  type SentryEvent,
} from '@/lib/sentry';

const DSN = 'https://abc123def456@o42.ingest.sentry.io/4511926121070592';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.SENTRY_DSN;
  delete process.env.SENTRY_RELEASE;
});

describe('parseDsn()', () => {
  it('parses a SaaS DSN into the envelope URL with the sentry_key query auth', () => {
    const parsed = parseDsn(DSN);
    expect(parsed).not.toBeNull();
    expect(parsed!.publicKey).toBe('abc123def456');
    expect(parsed!.projectId).toBe('4511926121070592');
    expect(parsed!.envelopeUrl).toBe(
      'https://o42.ingest.sentry.io/api/4511926121070592/envelope/?sentry_key=abc123def456'
    );
  });

  it('preserves a self-hosted path prefix before /api/<id>/envelope/', () => {
    const parsed = parseDsn('https://key@sentry.example.com/base/7');
    expect(parsed!.envelopeUrl).toBe(
      'https://sentry.example.com/base/api/7/envelope/?sentry_key=key'
    );
  });

  it('honours a non-default port', () => {
    const parsed = parseDsn('https://key@localhost:9000/9');
    expect(parsed!.envelopeUrl).toBe(
      'https://localhost:9000/api/9/envelope/?sentry_key=key'
    );
  });

  // ── Proof-of-rejection: every malformed shape returns null ──────────────────
  it.each([
    ['empty', ''],
    ['whitespace', '   '],
    ['undefined', undefined],
    ['null', null],
    ['not a url', 'definitely-not-a-dsn'],
    ['no public key', 'https://sentry.io/4511926121070592'],
    ['non-numeric project id', 'https://key@sentry.io/not-a-number'],
    ['no project id', 'https://key@sentry.io/'],
  ])('rejects %s → null', (_label, dsn) => {
    expect(parseDsn(dsn as string | undefined | null)).toBeNull();
  });
});

describe('newEventId()', () => {
  it('returns a 32-char hex id (uuid v4, hyphens stripped) and is unique', () => {
    const a = newEventId();
    const b = newEventId();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
});

describe('buildEnvelope()', () => {
  const baseEvent: SentryEvent = {
    eventId: 'e'.repeat(32),
    timestamp: 1_700_000_000,
    message: 'jobs.list_failed',
    errorName: 'TypeError',
    level: 'error',
    context: { requestId: 'req-1', path: '/api/jobs', extra: { a: 1 } },
    environment: 'production',
    release: 'deadbeef',
  };

  it('emits three newline-delimited JSON lines: header, item header, payload', () => {
    const env = buildEnvelope(DSN, baseEvent);
    const lines = env.split('\n');
    // trailing newline → a 4th empty segment
    expect(lines).toHaveLength(4);
    expect(lines[3]).toBe('');

    const header = JSON.parse(lines[0]);
    expect(header).toEqual({
      event_id: 'e'.repeat(32),
      sent_at: '2023-11-14T22:13:20.000Z',
      dsn: DSN,
    });
    expect(JSON.parse(lines[1])).toEqual({ type: 'event' });

    const payload = JSON.parse(lines[2]);
    expect(payload.level).toBe('error');
    expect(payload.platform).toBe('javascript');
    expect(payload.exception.values[0]).toEqual({
      type: 'TypeError',
      value: 'jobs.list_failed',
    });
    // requestId + path are promoted to indexed tags
    expect(payload.tags).toEqual({ request_id: 'req-1', path: '/api/jobs' });
    expect(payload.extra).toEqual({ a: 1 });
    expect(payload.environment).toBe('production');
    expect(payload.release).toBe('deadbeef');
  });

  it('never includes a stack trace (only the class name + message)', () => {
    const env = buildEnvelope(DSN, baseEvent);
    expect(env).not.toContain('stack');
    expect(env).not.toContain('\n    at ');
  });

  it('defaults the exception type to Error and omits empty tags/extra/env', () => {
    const payload = JSON.parse(
      buildEnvelope(DSN, {
        eventId: 'f'.repeat(32),
        timestamp: 1_700_000_000,
        message: 'boom',
        level: 'error',
        context: {},
      }).split('\n')[2]
    );
    expect(payload.exception.values[0].type).toBe('Error');
    expect(payload.tags).toBeUndefined();
    expect(payload.extra).toBeUndefined();
    expect(payload.environment).toBeUndefined();
    expect(payload.release).toBeUndefined();
  });

  it('merges caller tags with the promoted requestId/path tags', () => {
    const payload = JSON.parse(
      buildEnvelope(DSN, {
        eventId: 'a'.repeat(32),
        timestamp: 1,
        message: 'x',
        level: 'warning',
        context: { requestId: 'r', tags: { modality: 'phone' } },
      }).split('\n')[2]
    );
    expect(payload.tags).toEqual({ modality: 'phone', request_id: 'r' });
  });
});

describe('captureException()', () => {
  it('POSTs the envelope to the ingest URL and returns true on 2xx', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const ok = await captureException(
      'jobs.create_failed',
      { requestId: 'req-9', path: '/api/jobs' },
      { dsn: DSN, errorName: 'RangeError', now: 1_700_000_000_000, fetchImpl }
    );
    expect(ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      'https://o42.ingest.sentry.io/api/4511926121070592/envelope/?sentry_key=abc123def456'
    );
    expect(init!.method).toBe('POST');
    expect((init!.headers as Record<string, string>)['Content-Type']).toBe(
      'application/x-sentry-envelope'
    );
    const body = init!.body as string;
    expect(body).toContain('jobs.create_failed');
    expect(body).toContain('"request_id":"req-9"');
    expect(body).toContain('"type":"RangeError"');
  });

  it('returns false on a non-2xx response without throwing', async () => {
    const fetchImpl = vi.fn(async () => new Response('rate limited', { status: 429 }));
    await expect(
      captureException('x', {}, { dsn: DSN, fetchImpl })
    ).resolves.toBe(false);
  });

  // Proof-of-rejection: a throwing transport is swallowed, never surfaced.
  it('swallows a throwing fetch and returns false', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });
    await expect(
      captureException('x', {}, { dsn: DSN, fetchImpl })
    ).resolves.toBe(false);
  });

  // Proof-of-rejection: no DSN → no-op, and it must NOT call fetch.
  it('no-ops (false) with an unconfigured DSN and never calls fetch', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    delete process.env.SENTRY_DSN;
    await expect(captureException('x', {}, { fetchImpl })).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // Proof-of-rejection: a malformed DSN → no-op.
  it('no-ops (false) with a malformed DSN', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    await expect(
      captureException('x', {}, { dsn: 'not-a-dsn', fetchImpl })
    ).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('falls back to process.env.SENTRY_DSN when no dsn override is given', async () => {
    process.env.SENTRY_DSN = DSN;
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    await expect(captureException('x', {}, { fetchImpl })).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('stamps SENTRY_RELEASE into the payload when present', async () => {
    process.env.SENTRY_RELEASE = 'v1.2.3';
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    await captureException('x', {}, { dsn: DSN, fetchImpl });
    const body = fetchImpl.mock.calls[0][1]!.body as string;
    expect(body).toContain('"release":"v1.2.3"');
  });
});

describe('getWaitUntil()', () => {
  const KEY = Symbol.for('__cloudflare-context__');

  it('returns null off-platform (no cloudflare context)', () => {
    expect(getWaitUntil()).toBeNull();
  });

  it('returns a bound waitUntil when the OpenNext context exposes one', () => {
    const waitUntil = vi.fn();
    (globalThis as Record<symbol, unknown>)[KEY] = { ctx: { waitUntil } };
    try {
      const wu = getWaitUntil();
      expect(wu).toBeTypeOf('function');
      const p = Promise.resolve();
      wu!(p);
      expect(waitUntil).toHaveBeenCalledWith(p);
    } finally {
      delete (globalThis as Record<symbol, unknown>)[KEY];
    }
  });

  it('returns null when the context has no waitUntil function', () => {
    (globalThis as Record<symbol, unknown>)[KEY] = { ctx: {} };
    try {
      expect(getWaitUntil()).toBeNull();
    } finally {
      delete (globalThis as Record<symbol, unknown>)[KEY];
    }
  });
});

describe('dispatchCapture()', () => {
  beforeEach(() => {
    delete process.env.SENTRY_DSN;
  });

  // Proof-of-rejection: the fast no-op path — no DSN, no work, returns null.
  it('returns null and does no work when SENTRY_DSN is unset', () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal('fetch', fetchImpl);
    expect(dispatchCapture('boom', { requestId: 'r' })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fires a capture (fire-and-forget) when SENTRY_DSN is set', async () => {
    process.env.SENTRY_DSN = DSN;
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchImpl);
    const p = dispatchCapture('jobs.list_failed', { requestId: 'r-2' }, 'TypeError');
    expect(p).not.toBeNull();
    await expect(p).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1]!.body).toContain('"type":"TypeError"');
  });

  it('routes the promise through the platform waitUntil when present', async () => {
    process.env.SENTRY_DSN = DSN;
    const KEY = Symbol.for('__cloudflare-context__');
    const waitUntil = vi.fn();
    (globalThis as Record<symbol, unknown>)[KEY] = { ctx: { waitUntil } };
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchImpl);
    try {
      const p = dispatchCapture('x', {});
      expect(waitUntil).toHaveBeenCalledTimes(1);
      await p;
    } finally {
      delete (globalThis as Record<symbol, unknown>)[KEY];
    }
  });
});

describe('log() → sentry wiring (integration of the two modules)', () => {
  it("log('error', …) fires a capture when SENTRY_DSN is set", async () => {
    process.env.SENTRY_DSN = DSN;
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchImpl);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { log } = await import('@/lib/log');
    log('error', 'jobs.list_failed', { requestId: 'r-3', path: '/api/jobs', errorName: 'TypeError' });
    // flush the fire-and-forget microtask
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = fetchImpl.mock.calls[0][1]!.body as string;
    expect(body).toContain('"request_id":"r-3"');
    expect(body).toContain('"path":"/api/jobs"');
    expect(body).toContain('"type":"TypeError"');
  });

  // Proof-of-rejection: a non-error log level must NEVER capture.
  it("log('info'/'warn', …) never fires a capture", async () => {
    process.env.SENTRY_DSN = DSN;
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchImpl);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { log } = await import('@/lib/log');
    log('info', 'ok');
    log('warn', 'auth.denied', { requestId: 'r' });
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
