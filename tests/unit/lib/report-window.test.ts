import { describe, it, expect } from 'vitest';
import { parseReportWindow } from '@/lib/report-window';

// Unit tests for the pure `?since`/`?until` report date-window parser (R-065):
// absent bounds are all-time; valid dates pass through with `until` widened to
// an exclusive next-day bound; malformed dates and an inverted window are 400.

function params(qs: string): URLSearchParams {
  return new URL(`http://x/r${qs}`).searchParams;
}

describe('parseReportWindow', () => {
  it('no params → all-time (both bounds null)', () => {
    const w = parseReportWindow(params(''));
    expect(w).toEqual({ ok: true, since: null, until: null, untilExclusive: null });
  });

  it('empty-string params are treated as absent', () => {
    const w = parseReportWindow(params('?since=&until='));
    expect(w.ok).toBe(true);
    if (w.ok) {
      expect(w.since).toBeNull();
      expect(w.until).toBeNull();
      expect(w.untilExclusive).toBeNull();
    }
  });

  it('since only → inclusive lower bound, no upper', () => {
    const w = parseReportWindow(params('?since=2026-07-01'));
    expect(w).toEqual({
      ok: true,
      since: '2026-07-01',
      until: null,
      untilExclusive: null,
    });
  });

  it('until only → exclusive bound is the day AFTER until (whole-day cover)', () => {
    const w = parseReportWindow(params('?until=2026-07-31'));
    expect(w).toEqual({
      ok: true,
      since: null,
      until: '2026-07-31',
      untilExclusive: '2026-08-01',
    });
  });

  it('full window → both bounds, until made exclusive', () => {
    const w = parseReportWindow(params('?since=2026-07-01&until=2026-07-31'));
    expect(w).toEqual({
      ok: true,
      since: '2026-07-01',
      until: '2026-07-31',
      untilExclusive: '2026-08-01',
    });
  });

  it('until at a month/year boundary rolls over correctly', () => {
    const w = parseReportWindow(params('?until=2026-12-31'));
    expect(w.ok && w.untilExclusive).toBe('2027-01-01');
  });

  it('same-day window is allowed (since == until)', () => {
    const w = parseReportWindow(params('?since=2026-07-15&until=2026-07-15'));
    expect(w.ok).toBe(true);
    if (w.ok) expect(w.untilExclusive).toBe('2026-07-16');
  });

  it('since after until → 400', () => {
    const w = parseReportWindow(params('?since=2026-08-01&until=2026-07-01'));
    expect(w).toEqual({ ok: false, error: 'since must be on or before until' });
  });

  it('malformed since → 400', () => {
    const w = parseReportWindow(params('?since=07-01-2026'));
    expect(w.ok).toBe(false);
    if (!w.ok) expect(w.error).toMatch(/since/);
  });

  it('malformed until → 400', () => {
    const w = parseReportWindow(params('?until=nonsense'));
    expect(w.ok).toBe(false);
    if (!w.ok) expect(w.error).toMatch(/until/);
  });

  it('overflow calendar date (2026-02-30) → 400, not silently rolled forward', () => {
    const w = parseReportWindow(params('?since=2026-02-30'));
    expect(w.ok).toBe(false);
  });

  it('impossible month (2026-13-01) → 400', () => {
    const w = parseReportWindow(params('?until=2026-13-01'));
    expect(w.ok).toBe(false);
  });
});
