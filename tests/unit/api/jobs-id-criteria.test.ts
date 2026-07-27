/**
 * Deterministic tests for POST /api/jobs/[id]/criteria.
 *
 * Locks in P1-2: linking criteria to a job title is gated on the job title
 * belonging to the caller's org (guardJobOwnership) AND the criterion being
 * visible to them (own org or global). Without the job-ownership check an
 * org-A admin could rewrite the scoring criteria of org-B's job titles.
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

import { GET, POST, DELETE } from '@/app/api/jobs/[id]/criteria/route';

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (criteriaId = 'c1') =>
  new Request('http://localhost/api/jobs/j1/criteria', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ criteriaId }),
  });

function asAdmin(orgId: string | null) {
  requireAuthMock.mockResolvedValue({ session: { user: { id: 'a', role: 'ADMIN', orgId } } });
}

/**
 * Wire the sql mock from the perspective of the rows each query returns.
 * jobOrg = owning org of the job title (null → not found).
 * critOrg = owning org of the criterion (undefined → not found).
 */
function wire({ jobOrg, critOrg }: { jobOrg?: string | null; critOrg?: string | null }) {
  sqlMock.mockImplementation((strings?: TemplateStringsArray) => {
    const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
    if (text.includes('FROM job_titles')) {
      return Promise.resolve(jobOrg === undefined ? [] : [{ orgId: jobOrg }]);
    }
    if (text.includes('FROM criteria')) {
      return Promise.resolve(critOrg === undefined ? [] : [{ orgId: critOrg }]);
    }
    // job_criteria existing-link check + re-read
    return Promise.resolve([{ jobTitleId: 'j1', criteriaId: 'c1' }]);
  });
}

function ranInsert() {
  return sqlMock.mock.calls.some((c) =>
    (Array.isArray(c[0]) ? c[0].join(' ') : '').includes('INSERT INTO job_criteria')
  );
}

beforeEach(() => {
  requireAuthMock.mockReset();
  sqlMock.mockReset();
});

describe('POST /api/jobs/[id]/criteria — cross-org IDOR guard (P1-2)', () => {
  it('DENIES an org-A admin linking criteria to an org-B job title', async () => {
    asAdmin('orgA');
    wire({ jobOrg: 'orgB', critOrg: 'orgA' });
    const res = await POST(req(), params('j1'));
    expect(res.status).toBe(403);
    expect(ranInsert()).toBe(false);
  });

  it('DENIES linking a job title that is GLOBAL to a tenant admin', async () => {
    asAdmin('orgA');
    wire({ jobOrg: null, critOrg: 'orgA' });
    const res = await POST(req(), params('j1'));
    expect(res.status).toBe(403);
    expect(ranInsert()).toBe(false);
  });

  it('404 when the job title does not exist', async () => {
    asAdmin('orgA');
    wire({ jobOrg: undefined });
    const res = await POST(req(), params('nope'));
    expect(res.status).toBe(404);
  });

  it('DENIES linking a criterion the caller cannot see (another org)', async () => {
    asAdmin('orgA');
    wire({ jobOrg: 'orgA', critOrg: 'orgB' });
    const res = await POST(req(), params('j1'));
    expect(res.status).toBe(403);
    expect(ranInsert()).toBe(false);
  });

  it('400 when criteriaId is missing', async () => {
    asAdmin('orgA');
    wire({ jobOrg: 'orgA' });
    const res = await POST(
      new Request('http://localhost/api/jobs/j1/criteria', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      params('j1')
    );
    expect(res.status).toBe(400);
  });

  // The link path issues TWO `FROM job_criteria` reads: the existing-link check
  // (must be empty to trigger the INSERT) then the post-insert re-read (returns
  // the row). Distinguish them by call order.
  function wireLinkHappy(critOrg: string | null) {
    let jcCall = 0;
    sqlMock.mockImplementation((strings?: TemplateStringsArray) => {
      const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
      if (text.includes('FROM job_titles')) return Promise.resolve([{ orgId: 'orgA' }]);
      if (text.includes('FROM criteria')) return Promise.resolve([{ orgId: critOrg }]);
      if (text.includes('FROM job_criteria')) {
        jcCall += 1;
        return Promise.resolve(jcCall === 1 ? [] : [{ jobTitleId: 'j1', criteriaId: 'c1' }]);
      }
      return Promise.resolve([]);
    });
  }

  it('allows an admin to link an own-org criterion to an own-org job title', async () => {
    asAdmin('orgA');
    wireLinkHappy('orgA');
    const res = await POST(req(), params('j1'));
    expect(res.status).toBe(201);
    expect(ranInsert()).toBe(true);
  });

  it('allows linking a GLOBAL criterion (visible to all) to an own-org job title', async () => {
    asAdmin('orgA');
    wireLinkHappy(null); // global criterion
    const res = await POST(req(), params('j1'));
    expect(res.status).toBe(201);
  });
});

describe('GET /api/jobs/[id]/criteria — cross-org read IDOR guard', () => {
  const getReq = () => new Request('http://localhost/api/jobs/j1/criteria');

  function asMember(orgId: string | null) {
    requireAuthMock.mockResolvedValue({ session: { user: { id: 'u', role: 'MEMBER', orgId } } });
  }

  /**
   * Wire the GET path: the org-scope check reads `FROM job_titles`, then the
   * list query reads `FROM job_criteria` (INNER JOIN criteria).
   * jobOrg = owning org of the job title (undefined → not found).
   */
  function wireGet({ jobOrg }: { jobOrg?: string | null }) {
    sqlMock.mockImplementation((strings?: TemplateStringsArray) => {
      const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
      if (text.includes('FROM job_titles')) {
        return Promise.resolve(jobOrg === undefined ? [] : [{ orgId: jobOrg }]);
      }
      if (text.includes('FROM job_criteria')) {
        return Promise.resolve([{ id: 'c1', name: 'Empathy', description: 'secret rubric', orgId: jobOrg }]);
      }
      return Promise.resolve([]);
    });
  }

  function listQueryRan() {
    return sqlMock.mock.calls.some((c) =>
      (Array.isArray(c[0]) ? c[0].join(' ') : '').includes('FROM job_criteria')
    );
  }

  it("DENIES a member in org A reading org B's job-title criteria", async () => {
    asMember('orgA');
    wireGet({ jobOrg: 'orgB' });
    const res = await GET(getReq(), params('j1'));
    expect(res.status).toBe(403);
    // Never reaches the rubric-leaking list query.
    expect(listQueryRan()).toBe(false);
  });

  it("DENIES a null-org user reading a tenant's job-title criteria", async () => {
    asMember(null);
    wireGet({ jobOrg: 'orgB' });
    const res = await GET(getReq(), params('j1'));
    expect(res.status).toBe(403);
    expect(listQueryRan()).toBe(false);
  });

  it('404 when the job title does not exist', async () => {
    asMember('orgA');
    wireGet({ jobOrg: undefined });
    const res = await GET(getReq(), params('nope'));
    expect(res.status).toBe(404);
    expect(listQueryRan()).toBe(false);
  });

  it("allows reading an own-org job title's criteria", async () => {
    asMember('orgA');
    wireGet({ jobOrg: 'orgA' });
    const res = await GET(getReq(), params('j1'));
    expect(res.status).toBe(200);
    expect(listQueryRan()).toBe(true);
  });

  it('allows reading a GLOBAL job title’s criteria (shared catalog)', async () => {
    asMember('orgA');
    wireGet({ jobOrg: null });
    const res = await GET(getReq(), params('j1'));
    expect(res.status).toBe(200);
    expect(listQueryRan()).toBe(true);
  });
});

describe('/api/jobs/[id]/criteria — auth + error boundaries (GET/POST)', () => {
  const getReq = () => new Request('http://localhost/api/jobs/j1/criteria');

  it('GET → 401 when the caller is unauthenticated (no DB touched)', async () => {
    requireAuthMock.mockRejectedValue(new FakeAuthError('Unauthorized', 401));
    const res = await GET(getReq(), params('j1'));
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('GET → 500 when the org-scope read throws a non-auth error', async () => {
    requireAuthMock.mockResolvedValue({ session: { user: { id: 'u', role: 'MEMBER', orgId: 'orgA' } } });
    sqlMock.mockRejectedValue(new Error('neon down'));
    const res = await GET(getReq(), params('j1'));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to fetch criteria' });
  });

  it('POST → 401 when the caller is not an admin / unauthenticated', async () => {
    requireAuthMock.mockRejectedValue(new FakeAuthError('Forbidden', 403));
    const res = await POST(req(), params('j1'));
    expect(res.status).toBe(403);
    expect(ranInsert()).toBe(false);
  });

  it('POST → 404 when the criterion being linked does not exist', async () => {
    asAdmin('orgA');
    // job title owned by caller, but the criterion row is missing.
    wire({ jobOrg: 'orgA', critOrg: undefined });
    const res = await POST(req(), params('j1'));
    expect(res.status).toBe(404);
    expect(ranInsert()).toBe(false);
  });

  it('POST is idempotent — an already-linked pair returns 201 without a second INSERT', async () => {
    asAdmin('orgA');
    // wire()'s job_criteria branch returns a non-empty existing row → INSERT skipped.
    wire({ jobOrg: 'orgA', critOrg: 'orgA' });
    const res = await POST(req(), params('j1'));
    expect(res.status).toBe(201);
    expect(ranInsert()).toBe(false);
    expect(await res.json()).toEqual({ jobTitleId: 'j1', criteriaId: 'c1' });
  });

  it('POST → 500 when a write throws a non-auth error', async () => {
    asAdmin('orgA');
    sqlMock.mockRejectedValue(new Error('neon down'));
    const res = await POST(req(), params('j1'));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to link criteria' });
  });
});

describe('DELETE /api/jobs/[id]/criteria — unlink guards + boundaries', () => {
  const delReq = (body?: unknown) =>
    new Request('http://localhost/api/jobs/j1/criteria', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  function ranSpecificDelete() {
    return sqlMock.mock.calls.some((c) => {
      const t = Array.isArray(c[0]) ? c[0].join(' ') : '';
      return t.includes('DELETE FROM job_criteria') && t.includes('criteria_id');
    });
  }
  function ranDeleteAll() {
    return sqlMock.mock.calls.some((c) => {
      const t = Array.isArray(c[0]) ? c[0].join(' ') : '';
      return t.includes('DELETE FROM job_criteria') && !t.includes('criteria_id');
    });
  }

  it('→ 401/403 when the caller is not an authenticated admin (no delete issued)', async () => {
    requireAuthMock.mockRejectedValue(new FakeAuthError('Forbidden', 403));
    const res = await DELETE(delReq({ criteriaId: 'c1' }), params('j1'));
    expect(res.status).toBe(403);
    expect(ranSpecificDelete()).toBe(false);
    expect(ranDeleteAll()).toBe(false);
  });

  it('→ 404 when the job title does not exist', async () => {
    asAdmin('orgA');
    wire({ jobOrg: undefined });
    const res = await DELETE(delReq({ criteriaId: 'c1' }), params('nope'));
    expect(res.status).toBe(404);
    expect(ranSpecificDelete()).toBe(false);
  });

  it("DENIES an org-A admin unlinking criteria from an org-B job title (403)", async () => {
    asAdmin('orgA');
    wire({ jobOrg: 'orgB' });
    const res = await DELETE(delReq({ criteriaId: 'c1' }), params('j1'));
    expect(res.status).toBe(403);
    expect(ranSpecificDelete()).toBe(false);
    expect(ranDeleteAll()).toBe(false);
  });

  it('DENIES unlinking from a GLOBAL job title (tenant admin cannot touch the shared catalog)', async () => {
    asAdmin('orgA');
    wire({ jobOrg: null });
    const res = await DELETE(delReq({ criteriaId: 'c1' }), params('j1'));
    expect(res.status).toBe(403);
  });

  it('unlinks a SPECIFIC criterion when criteriaId is supplied → 204', async () => {
    asAdmin('orgA');
    wire({ jobOrg: 'orgA' });
    const res = await DELETE(delReq({ criteriaId: 'c1' }), params('j1'));
    expect(res.status).toBe(204);
    expect(ranSpecificDelete()).toBe(true);
    expect(ranDeleteAll()).toBe(false);
  });

  it('unlinks ALL criteria when the body carries no criteriaId → 204', async () => {
    asAdmin('orgA');
    wire({ jobOrg: 'orgA' });
    const res = await DELETE(delReq({}), params('j1'));
    expect(res.status).toBe(204);
    expect(ranDeleteAll()).toBe(true);
    expect(ranSpecificDelete()).toBe(false);
  });

  it('treats an unparseable body as "delete all" (the .catch fallback) → 204', async () => {
    asAdmin('orgA');
    // guardJobOwnership reads job_titles; the malformed body makes request.json() reject.
    sqlMock.mockImplementation((strings?: TemplateStringsArray) => {
      const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
      if (text.includes('FROM job_titles')) return Promise.resolve([{ orgId: 'orgA' }]);
      return Promise.resolve([]);
    });
    const res = await DELETE(
      new Request('http://localhost/api/jobs/j1/criteria', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json{',
      }),
      params('j1')
    );
    expect(res.status).toBe(204);
    expect(ranDeleteAll()).toBe(true);
  });

  it('→ 500 when the delete throws a non-auth error', async () => {
    asAdmin('orgA');
    sqlMock.mockImplementation((strings?: TemplateStringsArray) => {
      const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
      if (text.includes('FROM job_titles')) return Promise.resolve([{ orgId: 'orgA' }]);
      throw new Error('neon down');
    });
    const res = await DELETE(delReq({ criteriaId: 'c1' }), params('j1'));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to unlink criteria' });
  });
});
