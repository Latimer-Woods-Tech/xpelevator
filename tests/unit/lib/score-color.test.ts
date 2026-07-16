/**
 * Unit tests for the single score→color scale (src/lib/score-color.ts).
 * Locks the band boundaries so the previously-divergent per-page thresholds
 * can't reappear.
 */

import { describe, it, expect } from 'vitest';
import { scoreBand, scoreTextClass, scoreBarClass } from '@/lib/score-color';

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
