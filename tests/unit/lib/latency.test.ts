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
  classifyPhoneTurn,
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

describe('classifyPhoneTurn', () => {
  it('exposes the phone legs and rounds millis to integers', () => {
    expect(classifyPhoneTurn(1200.6, 1450.2)).toEqual({
      replyReadyMs: 1201,
      speakDispatchMs: 1450,
      tier: 'acceptable',
    });
  });

  it('tiers on the full dispatch gap, not on reply-ready (the phone difference)', () => {
    // Reply generated fast (realtime) but the dispatched-audio gap crosses into
    // acceptable — the trainee feels the dispatch gap, so that drives the tier.
    const t = classifyPhoneTurn(700, 1500);
    expect(ttftTier(t.replyReadyMs)).toBe('realtime');
    expect(t.tier).toBe('acceptable');
  });

  it('flags the founder-felt "half-speed" phone turn as slow', () => {
    // A 70B reply that takes ~2.4s to generate + dispatch reads as slow.
    const t = classifyPhoneTurn(2100, 2400);
    expect(t.tier).toBe('slow');
    expect(t.speakDispatchMs).toBe(2400);
  });

  it('clamps speakDispatchMs up to replyReadyMs when a skewed clock reverses them', () => {
    const t = classifyPhoneTurn(1500, 900);
    expect(t.replyReadyMs).toBe(1500);
    expect(t.speakDispatchMs).toBe(1500);
    expect(t.tier).toBe('acceptable');
  });

  it('normalises NaN / negative inputs to a 0ms realtime turn', () => {
    expect(classifyPhoneTurn(Number.NaN, -5)).toEqual({
      replyReadyMs: 0,
      speakDispatchMs: 0,
      tier: 'realtime',
    });
  });
});
