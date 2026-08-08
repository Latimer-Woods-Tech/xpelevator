import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  REQUEST_ID_HEADER,
  log,
  newRequestId,
  requestIdFrom,
} from '@/lib/log';

describe('log() — structured single-line JSON', () => {
  afterEach(() => vi.restoreAllMocks());

  it('emits one JSON object with level + msg + merged fields', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    log('info', 'hello', { requestId: 'r1', path: '/api/x' });
    expect(spy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed).toEqual({
      level: 'info',
      msg: 'hello',
      requestId: 'r1',
      path: '/api/x',
    });
  });

  it('defaults fields to an empty object', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    log('debug', 'no-fields');
    expect(JSON.parse(spy.mock.calls[0][0] as string)).toEqual({
      level: 'debug',
      msg: 'no-fields',
    });
  });

  it('routes error → console.error and warn → console.warn', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    log('error', 'boom');
    log('warn', 'careful');

    expect(err).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
    expect(JSON.parse(err.mock.calls[0][0] as string).level).toBe('error');
    expect(JSON.parse(warn.mock.calls[0][0] as string).level).toBe('warn');
  });
});

describe('newRequestId()', () => {
  it('returns a distinct RFC-4122 v4 uuid each call', () => {
    const a = newRequestId();
    const b = newRequestId();
    const uuidV4 =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(a).toMatch(uuidV4);
    expect(b).toMatch(uuidV4);
    expect(a).not.toBe(b);
  });
});

describe('requestIdFrom()', () => {
  it('honours a caller-supplied non-empty x-request-id', () => {
    const h = new Headers({ [REQUEST_ID_HEADER]: 'upstream-trace-123' });
    expect(requestIdFrom(h)).toBe('upstream-trace-123');
  });

  it('mints a fresh id when the header is absent', () => {
    expect(requestIdFrom(new Headers())).toMatch(/[0-9a-f-]{36}/i);
  });

  it('mints a fresh id when the header is present but blank', () => {
    const h = new Headers({ [REQUEST_ID_HEADER]: '   ' });
    const id = requestIdFrom(h);
    expect(id.trim()).not.toBe('');
    expect(id).toMatch(/[0-9a-f-]{36}/i);
  });
});
