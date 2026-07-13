/**
 * Unit tests for src/lib/latency.ts — conversation-turn latency instrumentation.
 *
 * Covers:
 *   1. ttftTier boundaries (realtime / acceptable / slow, exact thresholds)
 *   2. classifyTurnLatency rounding + non-negative clamping
 *   3. totalMs clamped to be >= ttftMs (impossible ordering can't leak out)
 *   4. NaN / negative / fractional inputs normalise safely
 */

import { describe, it, expect } from 'vitest';
import {
  classifyTurnLatency,
  ttftTier,
  TTFT_REALTIME_MS,
  TTFT_ACCEPTABLE_MS,
} from '../../../src/lib/latency';

describe('ttftTier', () => {
  it('classifies sub-800ms as realtime', () => {
    expect(ttftTier(0)).toBe('realtime');
    expect(ttftTier(799)).toBe('realtime');
  });

  it('treats the realtime threshold itself as acceptable (exclusive lower bound)', () => {
    expect(ttftTier(TTFT_REALTIME_MS)).toBe('acceptable');
    expect(ttftTier(1999)).toBe('acceptable');
  });

  it('classifies the acceptable threshold and beyond as slow', () => {
    expect(ttftTier(TTFT_ACCEPTABLE_MS)).toBe('slow');
    expect(ttftTier(5000)).toBe('slow');
  });

  it('normalises NaN / negative TTFT to realtime (0ms)', () => {
    expect(ttftTier(Number.NaN)).toBe('realtime');
    expect(ttftTier(-50)).toBe('realtime');
  });
});

describe('classifyTurnLatency', () => {
  it('rounds millis to integers and derives the tier from ttft', () => {
    expect(classifyTurnLatency(120.4, 640.6)).toEqual({
      ttftMs: 120,
      totalMs: 641,
      tier: 'realtime',
    });
  });

  it('clamps totalMs up to ttftMs when a skewed clock reports total < ttft', () => {
    const t = classifyTurnLatency(900, 400);
    expect(t.ttftMs).toBe(900);
    expect(t.totalMs).toBe(900);
    expect(t.tier).toBe('acceptable');
  });

  it('clamps negative / NaN inputs to 0', () => {
    expect(classifyTurnLatency(-10, Number.NaN)).toEqual({
      ttftMs: 0,
      totalMs: 0,
      tier: 'realtime',
    });
  });

  it('flags a genuinely slow turn as slow', () => {
    const t = classifyTurnLatency(3200, 5400);
    expect(t.tier).toBe('slow');
    expect(t.totalMs).toBe(5400);
  });
});
