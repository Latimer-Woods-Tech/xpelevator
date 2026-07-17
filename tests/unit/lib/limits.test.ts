/**
 * Unit tests for the conversation abuse/cost limits (src/lib/limits.ts).
 *
 * Root cause this covers: no rate limiting existed anywhere, and /api/chat
 * accepted unbounded message bodies — a single scripted client could exhaust
 * the org-wide Groq budget. Limits are enforced against DB state (timestamps,
 * counts); these tests cover the pure decision helpers.
 */

import { describe, it, expect } from 'vitest';
import {
  MAX_AGENT_MESSAGE_CHARS,
  MAX_SESSIONS_PER_DAY,
  MIN_TURN_INTERVAL_MS,
  MAX_PAGE_SIZE,
  DEFAULT_PAGE_SIZE,
  exceedsTurnRate,
  parsePagination,
} from '@/lib/limits';

describe('limits constants', () => {
  it('are generous enough for real trainees', () => {
    expect(MAX_AGENT_MESSAGE_CHARS).toBeGreaterThanOrEqual(1_000);
    expect(MAX_SESSIONS_PER_DAY).toBeGreaterThanOrEqual(20);
    // But strict enough to stop scripts.
    expect(MIN_TURN_INTERVAL_MS).toBeGreaterThan(0);
  });
});

describe('exceedsTurnRate', () => {
  const now = Date.parse('2026-07-12T12:00:00.000Z');

  it('allows the first turn (no prior message)', () => {
    expect(exceedsTurnRate(null, now)).toBe(false);
    expect(exceedsTurnRate(undefined, now)).toBe(false);
  });

  it('rejects a turn arriving inside the minimum interval', () => {
    const justNow = new Date(now - MIN_TURN_INTERVAL_MS + 100).toISOString();
    expect(exceedsTurnRate(justNow, now)).toBe(true);
  });

  it('allows a turn after the minimum interval', () => {
    const earlier = new Date(now - MIN_TURN_INTERVAL_MS - 100).toISOString();
    expect(exceedsTurnRate(earlier, now)).toBe(false);
  });

  it('accepts Date objects as well as ISO strings', () => {
    expect(exceedsTurnRate(new Date(now - 10), now)).toBe(true);
    expect(exceedsTurnRate(new Date(now - MIN_TURN_INTERVAL_MS - 10), now)).toBe(false);
  });

  it('fails open on an unparseable timestamp (never blocks a real trainee)', () => {
    expect(exceedsTurnRate('not-a-date', now)).toBe(false);
  });
});

describe('parsePagination', () => {
  const p = (qs: string) => parsePagination(new URLSearchParams(qs));

  it('defaults when no params are given', () => {
    expect(p('')).toEqual({ limit: DEFAULT_PAGE_SIZE, offset: 0 });
  });

  it('honors valid limit/offset', () => {
    expect(p('limit=10&offset=20')).toEqual({ limit: 10, offset: 20 });
  });

  it('clamps limit to [1, MAX_PAGE_SIZE] — no unbounded scan', () => {
    expect(p('limit=99999').limit).toBe(MAX_PAGE_SIZE);
    expect(p('limit=0').limit).toBe(1);
    expect(p('limit=-5').limit).toBe(1);
  });

  it('floors offset at 0 and falls back on garbage', () => {
    expect(p('offset=-10').offset).toBe(0);
    expect(p('limit=abc&offset=xyz')).toEqual({ limit: DEFAULT_PAGE_SIZE, offset: 0 });
  });
});
