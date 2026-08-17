/**
 * Unit tests for the single score→color scale (src/lib/score-color.ts).
 * Locks the band boundaries so the previously-divergent per-page thresholds
 * can't reappear.
 */

import { describe, it, expect } from 'vitest';
import {
  scoreBand,
  scoreTextClass,
  scoreBarClass,
  scoreBarHex,
  scoreBandLabel,
} from '@/lib/score-color';

describe('scoreBand', () => {
  it('maps the four bands at their boundaries', () => {
    expect(scoreBand(10)).toBe('strong');
    expect(scoreBand(8)).toBe('strong');
    expect(scoreBand(7.9)).toBe('good');
    expect(scoreBand(6)).toBe('good');
    expect(scoreBand(5.9)).toBe('fair');
    expect(scoreBand(4)).toBe('fair');
    expect(scoreBand(3.9)).toBe('weak');
    expect(scoreBand(1)).toBe('weak');
    expect(scoreBand(0)).toBe('weak');
  });
});

describe('scoreTextClass / scoreBarClass', () => {
  it('returns a distinct class per band', () => {
    const bands = [9, 7, 5, 2];
    const textClasses = bands.map(scoreTextClass);
    const barClasses = bands.map(scoreBarClass);
    expect(new Set(textClasses).size).toBe(4);
    expect(new Set(barClasses).size).toBe(4);
  });

  it('a strong score is emerald, a weak score is rose', () => {
    expect(scoreTextClass(9)).toContain('emerald');
    expect(scoreBarClass(9)).toContain('emerald');
    expect(scoreTextClass(2)).toContain('rose');
    expect(scoreBarClass(2)).toContain('rose');
  });
});

describe('scoreBarHex', () => {
  const EMERALD = '#10b981';
  const SKY = '#0ea5e9';
  const AMBER = '#f59e0b';
  const ROSE = '#f43f5e';

  it('returns the *-500 hex for each of the four bands', () => {
    expect(scoreBarHex(9)).toBe(EMERALD); // strong
    expect(scoreBarHex(7)).toBe(SKY); // good
    expect(scoreBarHex(5)).toBe(AMBER); // fair
    expect(scoreBarHex(2)).toBe(ROSE); // weak
  });

  it('maps at the same band boundaries as scoreBand (never a 3-tier scale)', () => {
    expect(scoreBarHex(8)).toBe(EMERALD);
    expect(scoreBarHex(6)).toBe(SKY);
    expect(scoreBarHex(4)).toBe(AMBER);
    expect(scoreBarHex(3.9)).toBe(ROSE);
    // Four distinct colours — a 3-tier scale would collapse one band.
    expect(new Set([scoreBarHex(9), scoreBarHex(7), scoreBarHex(5), scoreBarHex(2)]).size).toBe(4);
  });

  it('agrees with the canonical band exactly where the old 3-tier trend scale diverged', () => {
    // The old trend chart used `>=8 green : >=5 yellow : red`. At 6.5 that gave
    // yellow; the canonical band calls 6.5 "good" (sky). At 4.5 the old scale
    // gave red; the canonical band calls it "fair" (amber). Lock both so the
    // divergent scale can never come back.
    expect(scoreBarHex(6.5)).toBe(SKY); // was yellow (#facc15) under the 3-tier scale
    expect(scoreBarHex(4.5)).toBe(AMBER); // was red (#ef4444) under the 3-tier scale
  });
});

describe('scoreBandLabel', () => {
  it('names each of the four bands, tracking scoreBand exactly', () => {
    expect(scoreBandLabel(9)).toBe('Strong');
    expect(scoreBandLabel(8)).toBe('Strong');
    expect(scoreBandLabel(7)).toBe('Good');
    expect(scoreBandLabel(6)).toBe('Good');
    expect(scoreBandLabel(5)).toBe('Fair');
    expect(scoreBandLabel(4)).toBe('Fair');
    expect(scoreBandLabel(3.9)).toBe('Weak');
    expect(scoreBandLabel(0)).toBe('Weak');
  });

  it('provides four distinct labels — a colour-free way to read the band', () => {
    expect(new Set([9, 7, 5, 2].map(scoreBandLabel)).size).toBe(4);
  });
});
