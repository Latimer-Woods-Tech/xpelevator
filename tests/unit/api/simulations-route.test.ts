/**
 * Deterministic tests for the /api/simulations route ERROR / GUARD branches and
 * the GET list handler (issue #16, Phase 3 — P2-7 CI coverage gate).
 *
 * The companion `simulations-modality-gate.test.ts` already covers the POST
 * happy path + per-seat modality gating. This file closes the remaining
 * branches so the route can join the deterministic CI coverage gate:
 *
 *   POST guards — auth (401), body validation (400), scenario/job not found
 *   (404), cross-tenant scenario/job (403), daily session cap (429), and the
 *   unexpected-error boundary (500 AuthError vs non-AuthError).
 *
 *   GET list — auth (401), the ADMIN-with-org branch (org-wide list), the
 *   MEMBER / admin-without-org branch (own sessions only), pagination pass-
 *   through, hidden-script sanitization, and the 500 error boundary.
 *
 * `requireAuth`/`sql` are mocked; the real pure logic in `tenant-guard`,
 * `limits`, `plans`, and `scenario-safety` is exercised (no live Neon/Groq, no
 * `DISABLE_AUTH`).
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

import { POST, GET } from '@/app/api/simulations/route';

function postReq(body: Record<string, unknown>) {
  return new Request('http://localhost/api/simulations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function getReq(query = '') {
  return new Request(`http://localhost/api/simulations${query}`, { method: 'GET' });
}

function asUser(
  orgId: string | null,
  role: 'ADMIN' | 'MEMBER' = 'MEMBER',
  extra: Record<string, unknown> = {}
) {
  requireAuthMock.mockResolvedValue({
    session: { user: { id: 'u1', dbUserId: 'db1', role, orgId, ...extra } },
  });
}

function asAnon() {
  requireAuthMock.mockRejectedValue(new FakeAuthError('Unauthorized', 401));
}

function queryText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(' ') : String(strings);
}

/**
 * Wire the POST sql mock for a create attempt. `refs` overrides the visibility/
 * plan row; `count` drives the daily-cap SELECT. INSERT + response SELECTs
 * resolve to plausible rows so a permitted request reaches 201.
 */
function wirePost(
  refs: Partial<{
    scenarioOrgId: string | null;
    scenarioExists: string | null;
    jobOrgId: string | null;
    jobExists: string | null;
    orgPlan: string | null;
  }>,
  count = 0
) {
  const row = {
    scenarioOrgId: null,
    scenarioExists: 's1',
    jobOrgId: null,
    jobExists: 'j1',
    orgPlan: 'ENTERPRISE',
    ...refs,
  };
  sqlMock.mockImplementation((strings?: TemplateStringsArray) => {
    const text = queryText(strings);
    if (text.includes('"scenarioExists"')) return Promise.resolve([row]);
    if (text.includes('FROM simulation_sessions') && text.includes('COUNT(*)')) {
      return Promise.resolve([{ count }]);
    }
    if (text.includes('INSERT INTO simulation_sessions')) return Promise.resolve([{ id: 'sess1' }]);
    if (text.includes('FROM simulation_sessions ss')) {
      return Promise.resolve([
        { id: 'sess1', type: 'CHAT', status: 'IN_PROGRESS', scenario: { id: 's1' }, jobTitle: { id: 'j1' } },
      ]);
    }
    return Promise.resolve([]);
  });
}

function ranInsert() {
  return sqlMock.mock.calls.some((c) => queryText(c[0]).includes('INSERT INTO simulation_sessions'));
}

beforeEach(() => {
  requireAuthMock.mockReset();
  sqlMock.mockReset();
});

describe('POST /api/simulations — guard branches', () => {
  it('anonymous caller → 401 (AuthError re-mapped), no DB touched', async () => {
    asAnon();
    const res = await POST(postReq({ jobTitleId: 'j1', scenarioId: 's1', type: 'CHAT' }));
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('missing jobTitleId/scenarioId → 400 before any DB read', async () => {
    asUser('orgA');
    wirePost({});
    const res = await POST(postReq({ type: 'CHAT' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'jobTitleId and scenarioId are required' });
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('empty-string scenarioId is rejected as 400 (falsy guard)', async () => {
    asUser('orgA');
    wirePost({});
    const res = await POST(postReq({ jobTitleId: 'j1', scenarioId: '', type: 'CHAT' }));
    expect(res.status).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('scenario or job title not found → 404, no session created', async () => {
    asUser('orgA');
    wirePost({ scenarioExists: null });
    const res = await POST(postReq({ jobTitleId: 'j1', scenarioId: 's1', type: 'CHAT' }));
    expect(res.status).toBe(404);
    expect(ranInsert()).toBe(false);
  });

  it('scenario belonging to ANOTHER org → 403 Access denied (tenant scope on create)', async () => {
    asUser('orgA');
    wirePost({ scenarioOrgId: 'orgB', jobOrgId: 'orgA' });
    const res = await POST(postReq({ jobTitleId: 'j1', scenarioId: 's1', type: 'CHAT' }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('Access denied');
    expect(ranInsert()).toBe(false);
  });

  it('job title belonging to ANOTHER org → 403 (both refs are checked)', async () => {
    asUser('orgA');
    wirePost({ scenarioOrgId: 'orgA', jobOrgId: 'orgB' });
    const res = await POST(postReq({ jobTitleId: 'j1', scenarioId: 's1', type: 'CHAT' }));
    expect(res.status).toBe(403);
    expect(ranInsert()).toBe(false);
  });

  it('daily session cap reached → 429, no session created', async () => {
    asUser('orgA');
    wirePost({ scenarioOrgId: 'orgA', jobOrgId: 'orgA' }, 100);
    const res = await POST(postReq({ jobTitleId: 'j1', scenarioId: 's1', type: 'CHAT' }));
    expect(res.status).toBe(429);
    expect(ranInsert()).toBe(false);
  });

  it('a global (org-less) scenario is startable by any tenant → 201', async () => {
    asUser('orgA');
    wirePost({ scenarioOrgId: null, jobOrgId: null });
    const res = await POST(postReq({ jobTitleId: 'j1', scenarioId: 's1', type: 'CHAT' }));
    expect(res.status).toBe(201);
    expect(ranInsert()).toBe(true);
  });

  it('creates a session for a user without a dbUserId, tolerating an empty count row → 201', async () => {
    // No `dbUserId` on the session (→ null), and the daily-count SELECT returns
    // an empty result set (→ the `countRows[0]?.count ?? 0` nullish path).
    requireAuthMock.mockResolvedValue({ session: { user: { id: 'u1', role: 'MEMBER', orgId: 'orgA' } } });
    sqlMock.mockImplementation((strings?: TemplateStringsArray) => {
      const text = queryText(strings);
      if (text.includes('"scenarioExists"')) {
        return Promise.resolve([
          { scenarioOrgId: 'orgA', scenarioExists: 's1', jobOrgId: 'orgA', jobExists: 'j1', orgPlan: 'ENTERPRISE' },
        ]);
      }
      if (text.includes('COUNT(*)')) return Promise.resolve([]);
      if (text.includes('INSERT INTO simulation_sessions')) return Promise.resolve([{ id: 'sess1' }]);
      if (text.includes('FROM simulation_sessions ss')) {
        return Promise.resolve([{ id: 'sess1', scenario: { id: 's1' }, jobTitle: { id: 'j1' } }]);
      }
      return Promise.resolve([]);
    });
    const res = await POST(postReq({ jobTitleId: 'j1', scenarioId: 's1', type: 'CHAT' }));
    expect(res.status).toBe(201);
    expect(ranInsert()).toBe(true);
  });

  it('an unexpected (non-Auth) DB error → 500 boundary', async () => {
    asUser('orgA');
    sqlMock.mockRejectedValue(new Error('connection reset'));
    const res = await POST(postReq({ jobTitleId: 'j1', scenarioId: 's1', type: 'CHAT' }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Failed to create simulation');
  });

  it('a thrown non-Error value still yields a 500 (String() fallback branch)', async () => {
    asUser('orgA');
    sqlMock.mockRejectedValue('kaboom-string');
    const res = await POST(postReq({ jobTitleId: 'j1', scenarioId: 's1', type: 'CHAT' }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Failed to create simulation');
  });
});

describe('GET /api/simulations — list handler', () => {
  /** Wire the GET sql mock; captures which WHERE-branch query ran. */
  function wireGet(rows: unknown[]) {
    sqlMock.mockImplementation((strings?: TemplateStringsArray) => {
      const text = queryText(strings);
      if (text.includes('FROM simulation_sessions ss')) return Promise.resolve(rows);
      return Promise.resolve([]);
    });
  }

  function lastListQuery(): string {
    const call = sqlMock.mock.calls.find((c) => queryText(c[0]).includes('FROM simulation_sessions ss'));
    return call ? queryText(call[0]) : '';
  }

  it('anonymous caller → 401, no DB touched', async () => {
    asAnon();
    const res = await GET(getReq());
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('ADMIN with an org → 200, runs the org-wide branch (WHERE ss.org_id)', async () => {
    asUser('orgA', 'ADMIN');
    wireGet([{ id: 'sess1', scenario: { id: 's1', script: { hints: ['secret'] } } }]);
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    expect(lastListQuery()).toContain('ss.org_id =');
    expect(lastListQuery()).not.toContain('WHERE ss.user_id =');
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
  });

  it('MEMBER → 200, runs the own-sessions branch (WHERE ss.user_id) and strips the hidden script', async () => {
    asUser('orgA', 'MEMBER');
    wireGet([{ id: 'sess1', scenario: { id: 's1', name: 'x', script: { hints: ['do-not-leak'] } } }]);
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    expect(lastListQuery()).toContain('ss.user_id =');
    const body = await res.json();
    // sanitizeSessionScenario collapses a hints-only script to null for a
    // non-admin payload — the hidden mechanics never reach the trainee.
    expect(body[0].scenario.script).toBeNull();
  });

  it('ADMIN WITHOUT an org falls to the own-sessions branch (no org-wide leak)', async () => {
    asUser(null, 'ADMIN');
    wireGet([]);
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    expect(lastListQuery()).toContain('ss.user_id =');
    expect(await res.json()).toEqual([]);
  });

  it('honours bounded pagination — ?limit over the max is clamped, ?offset is passed through', async () => {
    asUser('orgA', 'MEMBER');
    const captured: unknown[] = [];
    sqlMock.mockImplementation((strings?: TemplateStringsArray, ...vals: unknown[]) => {
      if (queryText(strings).includes('FROM simulation_sessions ss')) {
        captured.push(...vals);
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });
    const res = await GET(getReq('?limit=9999&offset=20'));
    expect(res.status).toBe(200);
    // limit clamped to MAX_PAGE_SIZE (100); offset preserved. Both are bound
    // parameters, so they appear as interpolated values on the list query.
    expect(captured).toContain(100);
    expect(captured).toContain(20);
  });

  it('an unexpected DB error → 500 boundary', async () => {
    asUser('orgA', 'MEMBER');
    sqlMock.mockRejectedValue(new Error('connection reset'));
    const res = await GET(getReq());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Failed to list simulations');
  });

  it('a thrown non-Error value in GET still yields a 500 (no-stack + String fallback)', async () => {
    asUser('orgA', 'MEMBER');
    sqlMock.mockRejectedValue('boom-string');
    const res = await GET(getReq());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Failed to list simulations');
  });
});
