/**
 * Unit tests for the shared end-of-session scoring module.
 *
 * Covers the pure decision logic and the batched-insert SQL shape. The full
 * finalizeAndScoreSession orchestration hits the DB and is exercised by the
 * (live) integration tier; here we mock @/lib/db and @/lib/ai to assert the
 * batch insert is ONE call and scoring_status is always written — including on
 * the phone path, which previously omitted it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted so the vi.mock factories (themselves hoisted) can reference them.
const { sqlMock, scoreSessionMock } = vi.hoisted(() => ({
  sqlMock: vi.fn(() => Promise.resolve([])),
  scoreSessionMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ sql: sqlMock, default: sqlMock }));
vi.mock('@/lib/ai', () => ({ scoreSession: scoreSessionMock }));

import {
  resolveScoringStatus,
  insertScoresBatch,
  loadScoringCriteria,
  finalizeAndScoreSession,
} from '@/lib/session-scoring';

beforeEach(() => {
  sqlMock.mockReset();
  sqlMock.mockResolvedValue([]);
  scoreSessionMock.mockReset();
});

describe('resolveScoringStatus', () => {
  it('NOT_SCORABLE when not scorable, regardless of count', () => {
    expect(resolveScoringStatus(false, 0)).toBe('NOT_SCORABLE');
    expect(resolveScoringStatus(false, 5)).toBe('NOT_SCORABLE');
  });
  it('SCORED when scorable and scores produced', () => {
    expect(resolveScoringStatus(true, 3)).toBe('SCORED');
  });
  it('FAILED when scorable but zero scores (engine failure)', () => {
    expect(resolveScoringStatus(true, 0)).toBe('FAILED');
  });
});

describe('insertScoresBatch', () => {
  it('does nothing (no query) for an empty score set', async () => {
    await insertScoresBatch('s1', []);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('inserts all rows in a SINGLE query with one JSON payload param', async () => {
    await insertScoresBatch('s1', [
      { criteriaId: 'c1', criteriaName: 'A', score: 8, justification: 'good' },
      { criteriaId: 'c2', criteriaName: 'B', score: 5, justification: 'ok' },
    ]);
    // One round trip, not N.
    expect(sqlMock).toHaveBeenCalledTimes(1);
    // The interpolated param is the JSON array of all rows.
    const params = sqlMock.mock.calls[0].slice(1);
    const jsonParam = params.find((p) => typeof p === 'string' && p.includes('criteriaId'));
    expect(jsonParam).toBeDefined();
    const parsed = JSON.parse(jsonParam as string);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({ criteriaId: 'c1', score: 8, feedback: 'good' });
  });
});

describe('loadScoringCriteria', () => {
  it('returns linked criteria when present (no fallback query)', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 'c1', name: 'A', description: null, weight: 5 }]);
    const out = await loadScoringCriteria('s1');
    expect(out).toHaveLength(1);
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to all active criteria when the job has no links', async () => {
    sqlMock
      .mockResolvedValueOnce([]) // linked → none
      .mockResolvedValueOnce([{ id: 'g1', name: 'G', description: null, weight: 3 }]); // fallback
    const out = await loadScoringCriteria('s1');
    expect(out).toEqual([{ id: 'g1', name: 'G', description: null, weight: 3 }]);
    expect(sqlMock).toHaveBeenCalledTimes(2);
  });

  // Tenant isolation: both the linked and the fallback selection must be scoped
  // to the session's org (+ global), or a real tenant's session gets scored
  // against another tenant's private criteria (the runtime-path IDOR).
  const queryText = (call: unknown[]) => {
    const strings = call[0];
    return Array.isArray(strings) ? strings.join(' ') : '';
  };

  it('scopes the LINKED query to the session org (org_id predicate present)', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 'c1', name: 'A', description: null, weight: 5 }]);
    await loadScoringCriteria('s1');
    const linkedText = queryText(sqlMock.mock.calls[0]);
    expect(linkedText).toMatch(/c\.org_id\s*=\s*ss\.org_id/);
    expect(linkedText).toMatch(/c\.org_id\s+IS\s+NULL/i);
    expect(linkedText).toMatch(/ss\.org_id\s+IS\s+NULL/i);
  });

  it('scopes the FALLBACK query to the session org (session-joined, not a global SELECT *)', async () => {
    sqlMock
      .mockResolvedValueOnce([]) // linked → none, triggers fallback
      .mockResolvedValueOnce([{ id: 'g1', name: 'G', description: null, weight: 3 }]);
    await loadScoringCriteria('s1');
    const fallbackText = queryText(sqlMock.mock.calls[1]);
    // The fallback must join the session to learn its org, and carry the same
    // org predicate — never the old unscoped `FROM criteria WHERE active = true`.
    expect(fallbackText).toMatch(/simulation_sessions/);
    expect(fallbackText).toMatch(/c\.org_id\s*=\s*ss\.org_id/);
    expect(fallbackText).toMatch(/ss\.org_id\s+IS\s+NULL/i);
    // The session id is bound as a parameter (org context, not a literal).
    expect(sqlMock.mock.calls[1][1]).toBe('s1');
  });
});

describe('finalizeAndScoreSession', () => {
  const twoLineTranscript = [
    { role: 'CUSTOMER' as const, content: 'help' },
    { role: 'AGENT' as const, content: 'sure' },
  ];

  it('always writes scoring_status — even when NOT_SCORABLE (the phone-path bug)', async () => {
    // Short transcript → not scorable. No criteria lookups matter.
    sqlMock.mockResolvedValue([]);
    const out = await finalizeAndScoreSession('s1', [{ role: 'AGENT', content: 'hi' }]);
    expect(out.scoringStatus).toBe('NOT_SCORABLE');
    expect(scoreSessionMock).not.toHaveBeenCalled();
    // A scoring_status UPDATE was issued.
    const wroteStatus = sqlMock.mock.calls.some((c) =>
      c.some((p) => p === 'NOT_SCORABLE')
    );
    expect(wroteStatus).toBe(true);
  });

  it('scores, batch-inserts, and marks SCORED on a scorable session', async () => {
    // 1: COMPLETED update, 2: linked criteria, 3: (no fallback), then score, insert, status.
    sqlMock.mockImplementation((strings?: TemplateStringsArray) => {
      const text = Array.isArray(strings) ? strings.join('') : '';
      if (text.includes('job_criteria')) {
        return Promise.resolve([{ id: 'c1', name: 'A', description: null, weight: 5 }]);
      }
      return Promise.resolve([]);
    });
    scoreSessionMock.mockResolvedValue([
      { criteriaId: 'c1', criteriaName: 'A', score: 9, justification: 'great' },
    ]);

    const out = await finalizeAndScoreSession('s1', twoLineTranscript);
    expect(out.scoringStatus).toBe('SCORED');
    expect(out.scoringFailed).toBe(false);
    expect(out.scores).toHaveLength(1);
    const wroteScored = sqlMock.mock.calls.some((c) => c.some((p) => p === 'SCORED'));
    expect(wroteScored).toBe(true);
  });

  it('marks FAILED (scoringFailed) when a scorable session yields no scores', async () => {
    sqlMock.mockImplementation((strings?: TemplateStringsArray) => {
      const text = Array.isArray(strings) ? strings.join('') : '';
      if (text.includes('job_criteria')) {
        return Promise.resolve([{ id: 'c1', name: 'A', description: null, weight: 5 }]);
      }
      return Promise.resolve([]);
    });
    scoreSessionMock.mockResolvedValue([]); // engine returned nothing

    const out = await finalizeAndScoreSession('s1', twoLineTranscript);
    expect(out.scoringStatus).toBe('FAILED');
    expect(out.scoringFailed).toBe(true);
  });

  it('treats a thrown scoreSession as a scoring failure, not a crash', async () => {
    sqlMock.mockImplementation((strings?: TemplateStringsArray) => {
      const text = Array.isArray(strings) ? strings.join('') : '';
      if (text.includes('job_criteria')) {
        return Promise.resolve([{ id: 'c1', name: 'A', description: null, weight: 5 }]);
      }
      return Promise.resolve([]);
    });
    scoreSessionMock.mockRejectedValue(new Error('groq 401'));

    const out = await finalizeAndScoreSession('s1', twoLineTranscript);
    expect(out.scoringStatus).toBe('FAILED');
    expect(out.scoringFailed).toBe(true);
  });
});
