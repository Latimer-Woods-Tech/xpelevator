/**
 * Deterministic tests for the standalone job-title CRUD routes —
 * `GET/POST /api/jobs` and `PUT/DELETE /api/jobs/[id]`.
 *
 * These routes manage the job-title catalog admins author (each title carries
 * scenarios + weighted scoring criteria). The `src/app/api/**` coverage sweep
 * (P2-7) reached the job↔criteria LINK route (`jobs/[id]/criteria`) and the
 * standalone `criteria` resource (#192), but skipped this standalone job-title
 * resource — so its tenant-isolation guarantee had no regression test. This
 * locks in the same invariants the sibling resources already gate:
 *
 *  - READ  is authenticated + org-scoped (anon → 401; an org member's query
 *          binds an org filter for own + global rows, and the org-less/platform
 *          path queries the global catalog only — no `org_id =` bind).
 *  - WRITE is ADMIN-only, and a create always lands in the caller's OWN org
 *          (the INSERT binds the session org, never a client-supplied value).
 *  - MUTATE (`PUT`/`DELETE`) is gated by the real `canMutateResource`: a tenant
 *          admin must never edit or delete a GLOBAL (null-org) job title — the
 *          shared catalog that underpins every other tenant — nor another org's
 *          row; a platform (null-org) admin owns the global catalog.
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

// The [id] route imports the real tenant-guard — exercise it for real (it is
// the actual authorization decision under test), not a mock.
import { GET, POST } from '@/app/api/jobs/route';
import { PUT, DELETE } from '@/app/api/jobs/[id]/route';

const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

const postReq = (body: Record<string, unknown>) =>
  new Request('http://localhost/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const mutateReq = (method: string, body: Record<string, unknown> = { name: 'x' }) =>
  new Request('http://localhost/api/jobs/j1', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

function authAs(role: 'ADMIN' | 'MEMBER', orgId: string | null) {
  requireAuthMock.mockResolvedValue({ session: { user: { id: 'u1', role, orgId } } });
}
function authRejects(status: number) {
  requireAuthMock.mockRejectedValue(new FakeAuthError('nope', status));
}

const text = (strings?: TemplateStringsArray) =>
  Array.isArray(strings) ? strings.join(' ') : String(strings);

function ran(fragment: string) {
  return sqlMock.mock.calls.some((c) => text(c[0] as TemplateStringsArray).includes(fragment));
}

beforeEach(() => {
  requireAuthMock.mockReset();
  sqlMock.mockReset();
});

describe('GET /api/jobs — authenticated, org-scoped read', () => {
  it('401s an unauthenticated caller (requireAuth throws)', async () => {
    authRejects(401);
    const res = await GET(new Request('http://localhost/api/jobs'));
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('binds an org filter for an org member (own + global rows)', async () => {
    authAs('MEMBER', 'orgA');
    sqlMock.mockResolvedValue([{ id: 'j1', name: 'Support Agent', orgId: 'orgA' }]);
    const res = await GET(new Request('http://localhost/api/jobs'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual([
      { id: 'j1', name: 'Support Agent', orgId: 'orgA' },
    ]);
    // The org-scoped branch filters on the caller's org.
    expect(ran('org_id =')).toBe(true);
  });

  it('queries the GLOBAL catalog only for an org-less (platform) caller', async () => {
    authAs('ADMIN', null);
    sqlMock.mockResolvedValue([{ id: 'g1', name: 'Global Title', orgId: null }]);
    const res = await GET(new Request('http://localhost/api/jobs'));
    expect(res.status).toBe(200);
    // The null-org branch never binds an org filter — global rows only.
    expect(ran('org_id IS NULL')).toBe(true);
    expect(ran('org_id =')).toBe(false);
  });

  it('maps an unexpected DB error to 500', async () => {
    authAs('MEMBER', 'orgA');
    sqlMock.mockRejectedValue(new Error('db down'));
    const res = await GET(new Request('http://localhost/api/jobs'));
    expect(res.status).toBe(500);
  });
});

describe('POST /api/jobs — ADMIN-only, tenant-scoped create', () => {
  it('403s a non-admin (requireAuth ADMIN throws)', async () => {
    authRejects(403);
    const res = await POST(postReq({ name: 'x' }));
    expect(res.status).toBe(403);
    expect(ran('INSERT INTO job_titles')).toBe(false);
  });

  it('inserts into the caller OWN org (no cross-tenant write) and returns 201', async () => {
    authAs('ADMIN', 'orgA');
    sqlMock.mockResolvedValue([{ id: 'new', name: 'Closer', orgId: 'orgA' }]);
    const res = await POST(postReq({ name: 'Closer', description: 'Sales closer' }));
    expect(res.status).toBe(201);
    expect(ran('INSERT INTO job_titles')).toBe(true);
    // The org bound to the INSERT is the caller's own org, taken from the
    // session — never a client-supplied value.
    const insert = sqlMock.mock.calls.find((c) =>
      text(c[0] as TemplateStringsArray).includes('INSERT INTO job_titles')
    );
    expect(insert).toBeDefined();
    expect((insert as unknown[]).includes('orgA')).toBe(true);
  });

  it('maps an unexpected DB error to 500', async () => {
    authAs('ADMIN', 'orgA');
    sqlMock.mockRejectedValue(new Error('db down'));
    const res = await POST(postReq({ name: 'x' }));
    expect(res.status).toBe(500);
  });
});

/**
 * Wire the existence lookup (`SELECT org_id ... FROM job_titles WHERE id`) and
 * the post-write re-read (`SELECT id, name, ... FROM job_titles WHERE id`)
 * separately; UPDATE/DELETE resolve to []. `existing === undefined` → not found
 * (empty rows).
 */
function wireById(existingOrgId: string | null | undefined) {
  sqlMock.mockImplementation((strings?: TemplateStringsArray) => {
    const t = text(strings);
    if (t.includes('UPDATE job_titles') || t.includes('DELETE FROM job_titles')) {
      return Promise.resolve([]);
    }
    if (t.includes('FROM job_titles') && t.includes('description')) {
      // the re-read after a successful UPDATE
      return Promise.resolve([{ id: 'j1', name: 'x', orgId: existingOrgId ?? null }]);
    }
    // the existence lookup (SELECT org_id ... WHERE id)
    return Promise.resolve(existingOrgId === undefined ? [] : [{ orgId: existingOrgId }]);
  });
}

describe('PUT /api/jobs/[id] — global-catalog + cross-org mutate guard', () => {
  it('404s when the job title does not exist (no UPDATE)', async () => {
    authAs('ADMIN', 'orgA');
    wireById(undefined);
    const res = await PUT(mutateReq('PUT'), idParams('j1'));
    expect(res.status).toBe(404);
    expect(ran('UPDATE job_titles')).toBe(false);
  });

  it('DENIES a tenant admin editing a GLOBAL (null-org) job title → 403, no UPDATE', async () => {
    authAs('ADMIN', 'orgA');
    wireById(null);
    const res = await PUT(mutateReq('PUT'), idParams('j1'));
    expect(res.status).toBe(403);
    expect(ran('UPDATE job_titles')).toBe(false);
  });

  it('DENIES an org-A admin editing an org-B job title → 403, no UPDATE', async () => {
    authAs('ADMIN', 'orgA');
    wireById('orgB');
    const res = await PUT(mutateReq('PUT'), idParams('j1'));
    expect(res.status).toBe(403);
    expect(ran('UPDATE job_titles')).toBe(false);
  });

  it('ALLOWS a same-org admin to update → 200 + UPDATE ran', async () => {
    authAs('ADMIN', 'orgA');
    wireById('orgA');
    const res = await PUT(mutateReq('PUT'), idParams('j1'));
    expect(res.status).toBe(200);
    expect(ran('UPDATE job_titles')).toBe(true);
  });

  it('ALLOWS a platform (null-org) admin to update a GLOBAL job title → 200', async () => {
    authAs('ADMIN', null);
    wireById(null);
    const res = await PUT(mutateReq('PUT'), idParams('j1'));
    expect(res.status).toBe(200);
    expect(ran('UPDATE job_titles')).toBe(true);
  });

  it('401s an unauthenticated caller (no lookup)', async () => {
    authRejects(401);
    const res = await PUT(mutateReq('PUT'), idParams('j1'));
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('maps an unexpected DB error to 500', async () => {
    authAs('ADMIN', 'orgA');
    sqlMock.mockRejectedValue(new Error('db down'));
    const res = await PUT(mutateReq('PUT'), idParams('j1'));
    expect(res.status).toBe(500);
  });
});

describe('DELETE /api/jobs/[id] — global-catalog + cross-org mutate guard', () => {
  it('404s when the job title does not exist (no DELETE)', async () => {
    authAs('ADMIN', 'orgA');
    wireById(undefined);
    const res = await DELETE(mutateReq('DELETE'), idParams('j1'));
    expect(res.status).toBe(404);
    expect(ran('DELETE FROM job_titles')).toBe(false);
  });

  it('DENIES a tenant admin deleting a GLOBAL (null-org) job title → 403, no DELETE', async () => {
    authAs('ADMIN', 'orgA');
    wireById(null);
    const res = await DELETE(mutateReq('DELETE'), idParams('j1'));
    expect(res.status).toBe(403);
    expect(ran('DELETE FROM job_titles')).toBe(false);
  });

  it('DENIES an org-A admin deleting an org-B job title → 403, no DELETE', async () => {
    authAs('ADMIN', 'orgA');
    wireById('orgB');
    const res = await DELETE(mutateReq('DELETE'), idParams('j1'));
    expect(res.status).toBe(403);
    expect(ran('DELETE FROM job_titles')).toBe(false);
  });

  it('ALLOWS a same-org admin to delete → 204 + DELETE ran', async () => {
    authAs('ADMIN', 'orgA');
    wireById('orgA');
    const res = await DELETE(mutateReq('DELETE'), idParams('j1'));
    expect(res.status).toBe(204);
    expect(ran('DELETE FROM job_titles')).toBe(true);
  });

  it('ALLOWS a platform (null-org) admin to delete a GLOBAL job title → 204', async () => {
    authAs('ADMIN', null);
    wireById(null);
    const res = await DELETE(mutateReq('DELETE'), idParams('j1'));
    expect(res.status).toBe(204);
    expect(ran('DELETE FROM job_titles')).toBe(true);
  });

  it('401s an unauthenticated caller (no lookup)', async () => {
    authRejects(401);
    const res = await DELETE(mutateReq('DELETE'), idParams('j1'));
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('maps an unexpected DB error to 500', async () => {
    authAs('ADMIN', 'orgA');
    sqlMock.mockRejectedValue(new Error('db down'));
    const res = await DELETE(mutateReq('DELETE'), idParams('j1'));
    expect(res.status).toBe(500);
  });
});
