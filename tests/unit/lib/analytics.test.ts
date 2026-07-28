import { describe, it, expect } from 'vitest';
import {
  computeAnalytics,
  TREND_WINDOW_DAYS,
  type SessionFull,
} from '@/lib/analytics';

/** Build a completed session with sensible defaults for the fields under test. */
function session(overrides: Partial<SessionFull> = {}): SessionFull {
  return {
    type: 'CHAT',
    jobTitleId: 'job-1',
    endedAt: new Date('2026-07-20T12:00:00.000Z'),
    createdAt: new Date('2026-07-20T11:00:00.000Z'),
    jobTitle: { name: 'Support Specialist' },
    scoringStatus: 'SCORED',
    scores: [],
    ...overrides,
  };
}

/** A score row for a given criteria. */
function score(
  criteriaId: string,
  name: string,
  weight: number,
  value: number,
) {
  return { score: value, criteriaId, criteria: { name, weight } };
}

const NOW = new Date('2026-07-26T00:00:00.000Z');

describe('computeAnalytics', () => {
  it('returns an empty, well-typed summary for no sessions', () => {
    const out = computeAnalytics([], NOW);
    expect(out.totalSessions).toBe(0);
    expect(out.overallAvg).toBeNull();
    expect(out.scoringHealth).toEqual({ scored: 0, failed: 0, notScorable: 0, unknown: 0 });
    expect(out.scoreTrend).toEqual([]);
    expect(out.byJobTitle).toEqual([]);
    expect(out.byCriteria).toEqual([]);
    // byType always reports EVERY modality (PHONE | CHAT | VOICE), even at zero
    // volume — VOICE is a first-class type and must never be dropped.
    expect(out.byType).toEqual([
      { type: 'PHONE', sessions: 0, avg: null },
      { type: 'CHAT', sessions: 0, avg: null },
      { type: 'VOICE', sessions: 0, avg: null },
    ]);
  });

  it('computes the weighted overall average across all scores', () => {
    // weights 3 and 1 → (8*3 + 4*1) / (3+1) = 28/4 = 7
    const out = computeAnalytics(
      [
        session({
          scores: [score('c1', 'Empathy', 3, 8), score('c2', 'Clarity', 1, 4)],
        }),
      ],
      NOW,
    );
    expect(out.overallAvg).toBe(7);
    expect(out.totalSessions).toBe(1);
  });

  it('classifies scoring health via the canonical scoringLabel (no drift)', () => {
    const out = computeAnalytics(
      [
        session({ scoringStatus: 'SCORED' }),
        session({ scoringStatus: 'FAILED' }),
        session({ scoringStatus: 'NOT_SCORABLE' }),
        // pre-instrumentation (null status) WITH scores → inferred Scored
        session({ scoringStatus: null, scores: [score('c1', 'Empathy', 1, 5)] }),
        // pre-instrumentation (null status) WITHOUT scores → Unknown
        session({ scoringStatus: null, scores: [] }),
      ],
      NOW,
    );
    expect(out.scoringHealth).toEqual({
      scored: 2, // one SCORED + one inferred-from-scores
      failed: 1,
      notScorable: 1,
      unknown: 1,
    });
  });

  it('builds a UTC-daily trend of per-session averages, newest-window only', () => {
    const out = computeAnalytics(
      [
        // same UTC day → averaged together: avgs 6 and 8 → 7
        session({
          endedAt: new Date('2026-07-20T23:00:00.000Z'),
          scores: [score('c1', 'A', 1, 6)],
        }),
        session({
          endedAt: new Date('2026-07-20T01:00:00.000Z'),
          scores: [score('c1', 'A', 1, 8)],
        }),
        // different day
        session({
          endedAt: new Date('2026-07-21T10:00:00.000Z'),
          scores: [score('c1', 'A', 1, 5)],
        }),
      ],
      NOW,
    );
    expect(out.scoreTrend).toEqual([
      { date: '2026-07-20', avg: 7, count: 2 },
      { date: '2026-07-21', avg: 5, count: 1 },
    ]);
  });

  it('excludes sessions older than the trend window and score-less sessions', () => {
    const old = new Date(NOW);
    old.setDate(old.getDate() - (TREND_WINDOW_DAYS + 5));
    const out = computeAnalytics(
      [
        session({ endedAt: old, scores: [score('c1', 'A', 1, 9)] }), // too old
        session({
          endedAt: new Date('2026-07-25T10:00:00.000Z'),
          scores: [], // no scores → skipped from trend
        }),
        session({
          endedAt: new Date('2026-07-25T12:00:00.000Z'),
          scores: [score('c1', 'A', 1, 4)],
        }),
      ],
      NOW,
    );
    expect(out.scoreTrend).toEqual([{ date: '2026-07-25', avg: 4, count: 1 }]);
  });

  it('falls back to createdAt for the trend day when endedAt is null', () => {
    const out = computeAnalytics(
      [
        session({
          endedAt: null,
          createdAt: new Date('2026-07-22T09:00:00.000Z'),
          scores: [score('c1', 'A', 1, 6)],
        }),
      ],
      NOW,
    );
    expect(out.scoreTrend).toEqual([{ date: '2026-07-22', avg: 6, count: 1 }]);
  });

  it('breaks down by job title: counts every session, weighted avg, sorted by volume', () => {
    const out = computeAnalytics(
      [
        session({ jobTitleId: 'a', jobTitle: { name: 'Alpha' }, scores: [score('c1', 'A', 2, 6)] }),
        session({ jobTitleId: 'a', jobTitle: { name: 'Alpha' }, scores: [] }), // counts, no score
        session({ jobTitleId: 'b', jobTitle: { name: 'Beta' }, scores: [score('c1', 'A', 1, 9)] }),
      ],
      NOW,
    );
    expect(out.byJobTitle).toEqual([
      { name: 'Alpha', sessions: 2, avg: 6 },
      { name: 'Beta', sessions: 1, avg: 9 },
    ]);
  });

  it('reports a null job-title average when every session is score-less', () => {
    const out = computeAnalytics(
      [
        session({ jobTitleId: 'x', jobTitle: { name: 'Unscored Role' }, scores: [] }),
        session({ jobTitleId: 'x', jobTitle: { name: 'Unscored Role' }, scores: [] }),
      ],
      NOW,
    );
    expect(out.byJobTitle).toEqual([{ name: 'Unscored Role', sessions: 2, avg: null }]);
    expect(out.overallAvg).toBeNull();
  });

  it('breaks down by criteria: simple mean per criteria, ascending by avg', () => {
    const out = computeAnalytics(
      [
        session({
          scores: [score('emp', 'Empathy', 1, 9), score('clr', 'Clarity', 1, 3)],
        }),
        session({ scores: [score('emp', 'Empathy', 1, 7)] }),
      ],
      NOW,
    );
    // Empathy mean = (9+7)/2 = 8 (count 2); Clarity mean = 3 (count 1). Ascending by avg.
    expect(out.byCriteria).toEqual([
      { name: 'Clarity', weight: 1, avg: 3, count: 1 },
      { name: 'Empathy', weight: 1, avg: 8, count: 2 },
    ]);
  });

  it('breaks down by modality with weighted averages and counts', () => {
    const out = computeAnalytics(
      [
        session({ type: 'PHONE', scores: [score('c1', 'A', 1, 8)] }),
        session({ type: 'CHAT', scores: [score('c1', 'A', 1, 4)] }),
        session({ type: 'CHAT', scores: [score('c1', 'A', 3, 6)] }),
      ],
      NOW,
    );
    // CHAT weighted: (4*1 + 6*3)/(1+3) = 22/4 = 5.5; VOICE present at zero volume.
    expect(out.byType).toEqual([
      { type: 'PHONE', sessions: 1, avg: 8 },
      { type: 'CHAT', sessions: 2, avg: 5.5 },
      { type: 'VOICE', sessions: 0, avg: null },
    ]);
  });

  it('counts VOICE sessions in the modality breakdown and reconciles with totalSessions', () => {
    // Regression: browser-voice (VOICE) is a first-class shipped modality, but
    // `byType` previously filtered only PHONE and CHAT — so every VOICE session's
    // count and scores silently vanished from the manager's per-modality view and
    // `sum(byType.sessions)` no longer matched `totalSessions`.
    const out = computeAnalytics(
      [
        session({ type: 'PHONE', scores: [score('c1', 'A', 1, 8)] }),
        session({ type: 'CHAT', scores: [score('c1', 'A', 1, 4)] }),
        session({ type: 'VOICE', scores: [score('c1', 'A', 1, 9)] }),
        session({ type: 'VOICE', scores: [score('c1', 'A', 3, 5)] }),
      ],
      NOW,
    );
    const voice = out.byType.find(t => t.type === 'VOICE');
    // VOICE weighted: (9*1 + 5*3)/(1+3) = 24/4 = 6
    expect(voice).toEqual({ type: 'VOICE', sessions: 2, avg: 6 });
    // The modality breakdown accounts for every session — no modality is dropped.
    const modalityTotal = out.byType.reduce((n, t) => n + t.sessions, 0);
    expect(modalityTotal).toBe(out.totalSessions);
  });
});
