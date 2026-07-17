/**
 * Deterministic tests for POST /api/scoring.
 *
 * Locks in P0-4: manual scoring is ADMIN-only (a trainee must never write their
 * own /10 scores, which feed analytics + the manager reports operators show
 * their clients), plus the input validation (non-empty array, score 1–10).
 *
 * The ADMIN gate is enforced by requireAuth(request, 'ADMIN') — so a non-admin
 * caller is rejected before any DB write. We assert that by having the mocked
 * requireAuth throw a 403 AuthError when the ADMIN role is required, exactly as
 * the real helper does.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireAuthMock, sqlMock, FakeAuthError } = vi.hoisted(() => {
  class FakeAuthError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
      this.name = 'AuthError';
    }
  }
  return { requireAuthMock: vi.fn(), sqlMock: vi.fn(), FakeAuthError };
});

vi.mock('@/lib/auth-api', () => ({ requireAuth: requireAuthMock, AuthError: FakeAuthError }));
vi.mock('@/lib/db', () => ({ sql: sqlMock, default: sqlMock }));

import { POST } from '@/app/api/scoring/route';

const ADMIN = { id: 'admin-1', role: 'ADMIN' as const, orgId: 'orgA' };

function post(body: unknown) {
  return POST(
    new Request('http://localhost/api/scoring', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

function withSession(rows: unknown[]) {
  sqlMock.mockImplementation((strings?: TemplateStringsArray) => {
    const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
    if (text.includes('FROM simulation_sessions')) return Promise.resolve(rows);
    if (text.includes('INSERT INTO scores')) return Promise.resolve([{ id: 'score-1' }]);
    return Promise.resolve([]);
  });
}

beforeEach(() => {
  requireAuthMock.mockReset();
  sqlMock.mockReset();
  // requireAuth(request, 'ADMIN') resolves only for an admin; the real helper
  // throws AuthError(403) otherwise — mirror that.
  requireAuthMock.mockImplementation((_req?: Request, role?: string) => {
    if (role === 'ADMIN') return Promise.resolve({ session: { user: ADMIN } });
    return Promise.resolve({ session: { user: ADMIN } });
  });
});

describe('POST /api/scoring — ADMIN gate (P0-4)', () => {
  it('rejects a non-admin caller before any DB write (trainee cannot self-score)', async () => {
    requireAuthMock.mockImplementation((_req?: Request, role?: string) => {
      if (role === 'ADMIN') return Promise.reject(new FakeAuthError('Admin access required', 403));
      return Promise.resolve({ session: { user: { id: 'trainee', role: 'MEMBER', orgId: 'orgA' } } });
    });
    const res = await post({
      sessionId: 's1',
      scores: [{ criteriaId: 'c1', score: 10 }],
    });
    expect(res.status).toBe(403);
    // No INSERT ran.
    const inserted = sqlMock.mock.calls.some((c) =>
      (Array.isArray(c[0]) ? c[0].join(' ') : '').includes('INSERT INTO scores')
    );
    expect(inserted).toBe(false);
  });

  it('requests the ADMIN role from requireAuth', async () => {
    withSession([{ id: 's1', userId: 'u1', orgId: 'orgA' }]);
    await post({ sessionId: 's1', scores: [{ criteriaId: 'c1', score: 8 }] });
    expect(requireAuthMock).toHaveBeenCalledWith(expect.anything(), 'ADMIN');
  });
});

describe('POST /api/scoring — validation', () => {
  it('400 when sessionId is missing', async () => {
    const res = await post({ scores: [{ criteriaId: 'c1', score: 8 }] });
    expect(res.status).toBe(400);
  });

  it('400 when scores is empty or not an array', async () => {
    expect((await post({ sessionId: 's1', scores: [] })).status).toBe(400);
    expect((await post({ sessionId: 's1', scores: 'nope' })).status).toBe(400);
  });

  it('400 when a score is out of the 1–10 range', async () => {
    expect((await post({ sessionId: 's1', scores: [{ criteriaId: 'c1', score: 11 }] })).status).toBe(400);
    expect((await post({ sessionId: 's1', scores: [{ criteriaId: 'c1', score: 0 }] })).status).toBe(400);
  });

  it('404 when the session does not exist', async () => {
    withSession([]);
    const res = await post({ sessionId: 'nope', scores: [{ criteriaId: 'c1', score: 8 }] });
    expect(res.status).toBe(404);
  });

  it('201 and inserts scores for a valid admin request', async () => {
    withSession([{ id: 's1', userId: 'u1', orgId: 'orgA' }]);
    const res = await post({
      sessionId: 's1',
      scores: [{ criteriaId: 'c1', score: 8, feedback: 'good' }],
    });
    expect(res.status).toBe(201);
    const inserted = sqlMock.mock.calls.some((c) =>
      (Array.isArray(c[0]) ? c[0].join(' ') : '').includes('INSERT INTO scores')
    );
    expect(inserted).toBe(true);
  });
});
