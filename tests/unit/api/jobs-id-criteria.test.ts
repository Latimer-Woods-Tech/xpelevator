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

import { GET, POST } from '@/app/api/jobs/[id]/criteria/route';

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
