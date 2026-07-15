import { describe, it, expect } from 'vitest';
import {
  percentile,
  summarizeLatency,
  type LatencyTurn,
} from '@/lib/latency-summary';

/** Build a turn with sensible defaults; override only what a case cares about. */
function turn(overrides: Partial<LatencyTurn> = {}): LatencyTurn {
  return {
    ttftMs: 100,
    totalMs: 200,
    tier: 'realtime',
    model: 'llama-fast',
    routeReason: 'difficulty=easy→fast',
    modality: 'CHAT',
    ...overrides,
  };
}

describe('percentile (nearest-rank)', () => {
  it('returns 0 for an empty sample', () => {
    expect(percentile([], 95)).toBe(0);
  });

  it('returns the single value for n=1', () => {
    expect(percentile([742], 95)).toBe(742);
  });

  it('picks the nearest-rank value without interpolation', () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]; // n=10
    // rank = ceil(0.95 * 10) = 10 → index 9 → 100
    expect(percentile(values, 95)).toBe(100);
    // rank = ceil(0.5 * 10) = 5 → index 4 → 50
    expect(percentile(values, 50)).toBe(50);
  });

  it('is order-independent (sorts internally)', () => {
    expect(percentile([90, 10, 50, 30, 70], 95)).toBe(90);
  });

  it('clamps p outside 0..100', () => {
    expect(percentile([1, 2, 3], 200)).toBe(3);
    expect(percentile([1, 2, 3], -5)).toBe(1);
  });
});

describe('summarizeLatency — empty', () => {
  it('returns a null-headline summary with zeroed breakdown', () => {
    const s = summarizeLatency([]);
    expect(s.measuredTurns).toBe(0);
    expect(s.avgTtftMs).toBeNull();
    expect(s.p95TtftMs).toBeNull();
    expect(s.avgTotalMs).toBeNull();
    expect(s.slowPct).toBeNull();
    expect(s.tierBreakdown).toEqual({ realtime: 0, acceptable: 0, slow: 0 });
    expect(s.byModel).toEqual([]);
    expect(s.byRouteReason).toEqual([]);
    expect(s.byModality).toEqual([]);
  });
});

describe('summarizeLatency — headline stats', () => {
  it('computes mean, p95, and the slow share', () => {
    const turns: LatencyTurn[] = [
      turn({ ttftMs: 100, totalMs: 300, tier: 'realtime' }),
      turn({ ttftMs: 300, totalMs: 600, tier: 'acceptable' }),
      turn({ ttftMs: 500, totalMs: 900, tier: 'slow' }),
      turn({ ttftMs: 3000, totalMs: 4000, tier: 'slow' }),
    ];
    const s = summarizeLatency(turns);
    expect(s.measuredTurns).toBe(4);
    expect(s.avgTtftMs).toBe(975); // (100+300+500+3000)/4 = 975
    expect(s.avgTotalMs).toBe(1450); // (300+600+900+4000)/4 = 1450
    // rank = ceil(0.95 * 4) = 4 → largest ttft = 3000
    expect(s.p95TtftMs).toBe(3000);
    expect(s.slowPct).toBe(50); // 2 of 4
    expect(s.tierBreakdown).toEqual({ realtime: 1, acceptable: 1, slow: 2 });
  });

  it('normalises negative / non-finite millis to 0', () => {
    const s = summarizeLatency([
      turn({ ttftMs: -50, totalMs: Number.NaN, tier: 'realtime' }),
      turn({ ttftMs: 200, totalMs: 400, tier: 'realtime' }),
    ]);
    expect(s.avgTtftMs).toBe(100); // (0 + 200)/2
    expect(s.avgTotalMs).toBe(200); // (0 + 400)/2
  });
});

describe('summarizeLatency — grouping', () => {
  it('splits by model, most-measured first', () => {
    const turns: LatencyTurn[] = [
      turn({ model: 'fast', ttftMs: 100, tier: 'realtime' }),
      turn({ model: 'fast', ttftMs: 200, tier: 'realtime' }),
      turn({ model: 'realism', ttftMs: 900, tier: 'slow' }),
    ];
    const s = summarizeLatency(turns);
    expect(s.byModel.map((g) => g.key)).toEqual(['fast', 'realism']);
    expect(s.byModel[0]).toMatchObject({ turns: 2, avgTtftMs: 150, slowPct: 0 });
    expect(s.byModel[1]).toMatchObject({ turns: 1, avgTtftMs: 900, slowPct: 100 });
  });

  it('splits by route reason', () => {
    const s = summarizeLatency([
      turn({ routeReason: 'difficulty=hard→realism', tier: 'slow' }),
      turn({ routeReason: 'difficulty=easy→fast', tier: 'realtime' }),
    ]);
    expect(s.byRouteReason.map((g) => g.key).sort()).toEqual([
      'difficulty=easy→fast',
      'difficulty=hard→realism',
    ]);
  });

  it('folds null keys into (unknown) instead of dropping them', () => {
    const s = summarizeLatency([
      turn({ model: null, routeReason: null, modality: null }),
      turn({ model: 'fast' }),
    ]);
    expect(s.measuredTurns).toBe(2);
    expect(s.byModel.find((g) => g.key === '(unknown)')?.turns).toBe(1);
    expect(s.byRouteReason.find((g) => g.key === '(unknown)')?.turns).toBe(1);
    expect(s.byModality.find((g) => g.key === '(unknown)')?.turns).toBe(1);
  });

  it('splits by modality (CHAT/VOICE/PHONE), most-measured first', () => {
    const turns: LatencyTurn[] = [
      turn({ modality: 'CHAT', ttftMs: 100, tier: 'realtime' }),
      turn({ modality: 'CHAT', ttftMs: 200, tier: 'realtime' }),
      turn({ modality: 'PHONE', ttftMs: 1500, tier: 'slow' }),
    ];
    const s = summarizeLatency(turns);
    expect(s.byModality.map((g) => g.key)).toEqual(['CHAT', 'PHONE']);
    expect(s.byModality[0]).toMatchObject({ turns: 2, avgTtftMs: 150, slowPct: 0 });
    expect(s.byModality[1]).toMatchObject({ turns: 1, avgTtftMs: 1500, slowPct: 100 });
  });
});

describe('summarizeLatency — unknown tiers', () => {
  it('counts them in totals/averages but excludes them from tierBreakdown', () => {
    const s = summarizeLatency([
      turn({ ttftMs: 100, tier: 'realtime' }),
      turn({ ttftMs: 300, tier: 'mystery' }),
    ]);
    expect(s.measuredTurns).toBe(2);
    expect(s.avgTtftMs).toBe(200); // both count toward the mean
    expect(s.tierBreakdown).toEqual({ realtime: 1, acceptable: 0, slow: 0 });
    // 'mystery' is not counted as slow
    expect(s.slowPct).toBe(0);
  });
});
