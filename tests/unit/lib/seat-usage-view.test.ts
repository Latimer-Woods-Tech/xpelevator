/**
 * Unit tests for the seat-usage VIEW helpers (src/lib/seat-usage-view.ts) — the
 * pure display transforms behind the operator workspace seat meter (issue #16,
 * Phase 4 item 2). Each case is a proof-of-rejection: it fails if the transform
 * regresses (wrong tier order, missing zero-fill, a leaked non-catalog key, a
 * mis-counted junk value, or a blank org name rendering empty).
 */
import { describe, it, expect } from 'vitest';
import {
  tierLines,
  hasSeatUsage,
  orgDisplayName,
} from '@/lib/seat-usage-view';

describe('tierLines', () => {
  it('returns every catalog tier in canonical rank order (Chat → Voice → Phone)', () => {
    const lines = tierLines({ phone: 2, chat: 5, voice: 1 });
    expect(lines.map(l => l.id)).toEqual(['chat', 'voice', 'phone']);
    expect(lines.map(l => l.name)).toEqual(['Chat', 'Voice', 'Phone']);
    // Counts follow the tier, not the input key order.
    expect(lines.map(l => l.seats)).toEqual([5, 1, 2]);
  });

  it('zero-fills a tier the record omits', () => {
    const lines = tierLines({ chat: 3 });
    expect(lines.find(l => l.id === 'voice')?.seats).toBe(0);
    expect(lines.find(l => l.id === 'phone')?.seats).toBe(0);
  });

  it('ignores a key that is not a catalog tier (no leak into the lines)', () => {
    const lines = tierLines({ chat: 1, bogus: 99 } as Record<string, number>);
    expect(lines).toHaveLength(3);
    expect(lines.some(l => (l.id as string) === 'bogus')).toBe(false);
    expect(lines.find(l => l.id === 'chat')?.seats).toBe(1);
  });

  it('collapses junk / negative / fractional counts to a safe integer', () => {
    const lines = tierLines({
      chat: -4,
      voice: 2.9,
      phone: Number.NaN,
    } as Record<string, number>);
    expect(lines.find(l => l.id === 'chat')?.seats).toBe(0); // negative → 0
    expect(lines.find(l => l.id === 'voice')?.seats).toBe(2); // truncated
    expect(lines.find(l => l.id === 'phone')?.seats).toBe(0); // NaN → 0
  });

  it('is all-zero for null / undefined / empty input', () => {
    for (const input of [null, undefined, {}]) {
      const lines = tierLines(input);
      expect(lines).toHaveLength(3);
      expect(lines.every(l => l.seats === 0)).toBe(true);
    }
  });
});

describe('hasSeatUsage', () => {
  it('is true only when the summed totals carry at least one billable seat', () => {
    expect(
      hasSeatUsage({ totals: { activeSeats: 3, sessions: 9, seatsByTier: {} } })
    ).toBe(true);
    expect(
      hasSeatUsage({ totals: { activeSeats: 0, sessions: 0, seatsByTier: {} } })
    ).toBe(false);
  });

  it('fails closed (false) on a missing / malformed report', () => {
    expect(hasSeatUsage(null)).toBe(false);
    expect(hasSeatUsage(undefined)).toBe(false);
    expect(
      hasSeatUsage({
        totals: { activeSeats: -2, sessions: 0, seatsByTier: {} },
      })
    ).toBe(false);
  });
});

describe('orgDisplayName', () => {
  it('uses the org name when present', () => {
    expect(orgDisplayName({ orgName: 'Northwind Retail' })).toBe(
      'Northwind Retail'
    );
  });

  it('falls back to a stable label for a null / blank name', () => {
    expect(orgDisplayName({ orgName: null })).toBe('Unnamed workspace');
    expect(orgDisplayName({ orgName: '   ' })).toBe('Unnamed workspace');
  });
});
