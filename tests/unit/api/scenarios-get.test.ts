/**
 * Deterministic tests for GET /api/scenarios (the org-scoped list) plus the
 * auth/500 boundaries on POST. Complements `scenarios-post-tenant.test.ts`
 * (POST tenant-scope) so the whole route clears the CI branch floor (P2-7).
 *
 * The GET list is the hidden-mechanic boundary: a trainee (non-admin) must
 * receive scripts stripped of persona / objective / hints — only the
 * presentational `ttsVoiceName` may survive — while an admin sees the full
 * script. All four query shapes (org × jobTitleId) are exercised so a
 * regression that drops the org filter (a tenant leak) or the sanitizer (a
 * hint leak) fails CI.
 *
 * requireAuth/sql are mocked; the real pure sanitizeScenarioScript runs.
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

import { GET, POST } from '@/app/api/scenarios/route';

const HIDDEN_SCRIPT = {
  customerPersona: 'Furious enterprise buyer',
  customerObjective: 'demand a full refund',
  hints: ['open hostile', 'soften only if apologised to'],
  ttsVoiceName: 'Rachel',
};

function getReq(query = '') {
  return new Request(`http://localhost/api/scenarios${query}`);
}

function asRole(role: 'ADMIN' | 'MEMBER', orgId: string | null) {
  requireAuthMock.mockResolvedValue({ session: { user: { id: 'u', role, orgId } } });
}

/** The list SELECT resolves to one scenario carrying the hidden script. */
function wireList() {
  sqlMock.mockImplementation((strings?: TemplateStringsArray) => {
    const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
    if (text.includes('FROM scenarios s')) {
      return Promise.resolve([
        { id: 's1', name: 'S', script: { ...HIDDEN_SCRIPT }, orgId: 'orgA', jobTitleId: 'j1' },
      ]);
    }
    return Promise.resolve([]);
  });
}

/** Joined SQL text of whichever list query ran. */
function listQueryText() {
  const call = sqlMock.mock.calls.find((c) =>
    (Array.isArray(c[0]) ? c[0].join(' ') : '').includes('FROM scenarios s')
  );
  return call ? (call[0] as TemplateStringsArray).join(' ') : '';
}

beforeEach(() => {
  requireAuthMock.mockReset();
  sqlMock.mockReset();
});

describe('GET /api/scenarios — hidden-mechanic sanitization', () => {
  it('strips persona/objective/hints for a non-admin trainee (only ttsVoiceName survives)', async () => {
    asRole('MEMBER', 'orgA');
    wireList();
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0].script).toEqual({ ttsVoiceName: 'Rachel' });
    expect(body[0].script.hints).toBeUndefined();
    expect(body[0].script.customerObjective).toBeUndefined();
    expect(body[0].script.customerPersona).toBeUndefined();
  });

  it('returns the FULL script (persona/objective/hints) to an admin author', async () => {
    asRole('ADMIN', 'orgA');
    wireList();
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0].script).toEqual(HIDDEN_SCRIPT);
  });
});

describe('GET /api/scenarios — org-scoped query selection (tenant isolation)', () => {
  it('org caller + jobTitleId → org-OR-global filter, job-title constrained', async () => {
    asRole('MEMBER', 'orgA');
    wireList();
    const res = await GET(getReq('?jobTitleId=j1'));
    expect(res.status).toBe(200);
    const q = listQueryText();
    expect(q).toContain('s.org_id = ');
    expect(q).toContain('OR s.org_id IS NULL');
    expect(q).toContain('s.job_title_id = ');
  });

  it('org caller, no jobTitleId → org-OR-global filter, no job-title constraint', async () => {
    asRole('MEMBER', 'orgA');
    wireList();
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const q = listQueryText();
    expect(q).toContain('OR s.org_id IS NULL');
    expect(q).not.toContain('s.job_title_id = ');
  });

  it('org-less caller + jobTitleId → GLOBAL-only filter, job-title constrained', async () => {
    asRole('MEMBER', null);
    wireList();
    const res = await GET(getReq('?jobTitleId=j1'));
    expect(res.status).toBe(200);
    const q = listQueryText();
    expect(q).toContain('s.org_id IS NULL');
    expect(q).not.toContain('s.org_id = ');
    expect(q).toContain('s.job_title_id = ');
  });

  it('org-less caller, no jobTitleId → GLOBAL-only filter, no job-title constraint', async () => {
    asRole('MEMBER', null);
    wireList();
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const q = listQueryText();
    expect(q).toContain('s.org_id IS NULL');
    expect(q).not.toContain('s.org_id = ');
    expect(q).not.toContain('s.job_title_id = ');
  });
});

describe('GET /api/scenarios — error boundaries', () => {
  it('anonymous caller → 401 (AuthError re-mapped), no DB touched', async () => {
    requireAuthMock.mockRejectedValue(new FakeAuthError('Unauthorized', 401));
    const res = await GET(getReq());
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('unexpected DB failure → 500', async () => {
    asRole('MEMBER', 'orgA');
    sqlMock.mockRejectedValue(new Error('connection reset'));
    const res = await GET(getReq());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to fetch scenarios' });
  });
});

describe('POST /api/scenarios — auth + error boundaries', () => {
  it('non-admin/anon → 401 (AuthError re-mapped), no INSERT', async () => {
    requireAuthMock.mockRejectedValue(new FakeAuthError('Forbidden', 403));
    const req = new Request('http://localhost/api/scenarios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobTitleId: 'j1', name: 'x', type: 'CHAT' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    expect(
      sqlMock.mock.calls.some((c) =>
        (Array.isArray(c[0]) ? c[0].join(' ') : '').includes('INSERT INTO scenarios')
      )
    ).toBe(false);
  });

  it('unexpected DB failure after auth → 500', async () => {
    asRole('ADMIN', 'orgA');
    sqlMock.mockRejectedValue(new Error('boom'));
    const req = new Request('http://localhost/api/scenarios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobTitleId: 'j1', name: 'x', type: 'CHAT' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to create scenario' });
  });
});
