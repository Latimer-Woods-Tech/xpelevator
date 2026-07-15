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
  describeLatencyTier,
  latencyBadge,
  routeReasonForDifficulty,
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

describe('describeLatencyTier', () => {
  it('maps each felt-speed tier to a trainee-facing label', () => {
    expect(describeLatencyTier('realtime')).toBe('Real-time');
    expect(describeLatencyTier('acceptable')).toBe('Responsive');
    expect(describeLatencyTier('slow')).toBe('Slow');
  });

  it('never surfaces the banned "AI" token in any label', () => {
    for (const tier of ['realtime', 'acceptable', 'slow'] as const) {
      expect(describeLatencyTier(tier)).not.toMatch(/\bAI\b/);
    }
  });
});

describe('latencyBadge', () => {
  it('builds a labelled badge with one-decimal seconds from a real-time turn', () => {
    const badge = latencyBadge(classifyTurnLatency(91, 640));
    expect(badge).toEqual({
      tier: 'realtime',
      label: 'Real-time',
      detail: '0.1s to first reply',
    });
  });

  it('carries the tier and rounded detail for a slow (half-speed) turn', () => {
    const badge = latencyBadge(classifyTurnLatency(2400, 3000));
    expect(badge.tier).toBe('slow');
    expect(badge.label).toBe('Slow');
    expect(badge.detail).toBe('2.4s to first reply');
  });
})
;

describe('routeReasonForDifficulty (R-066 telemetry token)', () => {
  it('maps hard -> the realism model (the only non-fast route)', () => {
    expect(routeReasonForDifficulty('hard')).toBe('difficulty=hard→realism');
  });

  it('maps easy and medium -> the fast model', () => {
    expect(routeReasonForDifficulty('easy')).toBe('difficulty=easy→fast');
    expect(routeReasonForDifficulty('medium')).toBe('difficulty=medium→fast');
  });

  it('mirrors the model routing: anything but "hard" is the fast tier', () => {
    // customerModelForDifficulty returns the fast model for any non-"hard" input,
    // so the reason token must stay on the fast route for an unexpected value too
    // (it can never disagree with the model actually used).
    expect(routeReasonForDifficulty('unknown')).toBe('difficulty=unknown→fast');
  });
});
