/**
 * Deterministic tests for the standalone scoring-criteria CRUD routes —
 * `GET/POST /api/criteria` and `PUT/DELETE /api/criteria/[id]`.
 *
 * These routes manage the weighted scoring-criteria catalog admins author.
 * The `src/app/api/**` coverage sweep (P2-7) reached the job↔criteria LINK
 * route (`jobs/[id]/criteria`) but missed this standalone resource, so its
 * tenant-isolation guarantee had no regression test. This locks in:
 *
 *  - READ  is authenticated + org-scoped (anon → 401; own-org sees own +
 *          global rows, and the org-less path queries the global catalog only).
 *  - WRITE is ADMIN-only, and a create always lands in the caller's own org
 *          (no cross-tenant insert).
 *  - MUTATE (`PUT`/`DELETE`) is gated by `canMutateResource`: a tenant admin
 *          must never edit or delete a GLOBAL (null-org) criterion — the shared
 *          catalog that underpins every other tenant — nor another org's row.
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
import { GET, POST } from '@/app/api/criteria/route';
import { PUT, DELETE } from '@/app/api/criteria/[id]/route';

const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

const postReq = (body: Record<string, unknown>) =>
  new Request('http://localhost/api/criteria', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const mutateReq = (method: string, body: Record<string, unknown> = { name: 'x' }) =>
  new Request('http://localhost/api/criteria/c1', {
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

describe('GET /api/criteria — authenticated, org-scoped read', () => {
  it('401s an unauthenticated caller (requireAuth throws)', async () => {
    authRejects(401);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('queries org + global rows for an org member', async () => {
    authAs('MEMBER', 'orgA');
    sqlMock.mockResolvedValue([{ id: 'c1', name: 'Empathy', orgId: 'orgA' }]);
    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual([{ id: 'c1', name: 'Empathy', orgId: 'orgA' }]);
    // The org-scoped branch filters on the caller's org.
    expect(ran('org_id =')).toBe(true);
  });

  it('queries the GLOBAL catalog only for an org-less caller', async () => {
    authAs('ADMIN', null);
    sqlMock.mockResolvedValue([{ id: 'g1', name: 'Global', orgId: null }]);
    const res = await GET();
    expect(res.status).toBe(200);
    // The null-org branch never binds an org filter — global rows only.
    expect(ran('org_id IS NULL')).toBe(true);
    expect(ran('org_id =')).toBe(false);
  });

  it('maps an unexpected DB error to 500', async () => {
    authAs('MEMBER', 'orgA');
    sqlMock.mockRejectedValue(new Error('db down'));
    const res = await GET();
    expect(res.status).toBe(500);
  });
});

describe('POST /api/criteria — ADMIN-only, tenant-scoped create', () => {
  it('403s a non-admin (requireAuth ADMIN throws)', async () => {
    authRejects(403);
    const res = await POST(postReq({ name: 'x' }));
    expect(res.status).toBe(403);
    expect(ran('INSERT INTO criteria')).toBe(false);
  });

  it('inserts into the caller OWN org (no cross-tenant write) and returns 201', async () => {
    authAs('ADMIN', 'orgA');
    sqlMock.mockResolvedValue([{ id: 'new', name: 'Clarity', orgId: 'orgA' }]);
    const res = await POST(postReq({ name: 'Clarity', weight: 7, category: 'comms' }));
    expect(res.status).toBe(201);
    expect(ran('INSERT INTO criteria')).toBe(true);
    // The org bound to the INSERT is the caller's own org, taken from the
    // session — never a client-supplied value.
    const insert = sqlMock.mock.calls.find((c) =>
      text(c[0] as TemplateStringsArray).includes('INSERT INTO criteria')
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
 * Wire the existence lookup (`SELECT org_id ... FROM criteria WHERE id`) and the
 * post-write re-read (`SELECT id, name, ... FROM criteria WHERE id`) separately;
 * UPDATE/DELETE resolve to []. `existing === undefined` → not found (empty rows).
 */
function wireById(existingOrgId: string | null | undefined) {
  sqlMock.mockImplementation((strings?: TemplateStringsArray) => {
    const t = text(strings);
    if (t.includes('UPDATE criteria') || t.includes('DELETE FROM criteria')) {
      return Promise.resolve([]);
    }
    if (t.includes('FROM criteria') && t.includes('description')) {
      // the re-read after a successful UPDATE
      return Promise.resolve([{ id: 'c1', name: 'x', orgId: existingOrgId ?? null }]);
    }
    // the existence lookup
    return Promise.resolve(existingOrgId === undefined ? [] : [{ orgId: existingOrgId }]);
  });
}

describe('PUT /api/criteria/[id] — global-catalog + cross-org mutate guard', () => {
  it('404s when the criterion does not exist (no UPDATE)', async () => {
    authAs('ADMIN', 'orgA');
    wireById(undefined);
    const res = await PUT(mutateReq('PUT'), idParams('c1'));
    expect(res.status).toBe(404);
    expect(ran('UPDATE criteria')).toBe(false);
  });

  it('DENIES a tenant admin editing a GLOBAL (null-org) criterion → 403, no UPDATE', async () => {
    authAs('ADMIN', 'orgA');
    wireById(null);
    const res = await PUT(mutateReq('PUT'), idParams('c1'));
    expect(res.status).toBe(403);
    expect(ran('UPDATE criteria')).toBe(false);
  });

  it("DENIES an org-A admin editing an org-B criterion → 403, no UPDATE", async () => {
    authAs('ADMIN', 'orgA');
    wireById('orgB');
    const res = await PUT(mutateReq('PUT'), idParams('c1'));
    expect(res.status).toBe(403);
    expect(ran('UPDATE criteria')).toBe(false);
  });

  it('ALLOWS a same-org admin to update → 200 + UPDATE ran', async () => {
    authAs('ADMIN', 'orgA');
    wireById('orgA');
    const res = await PUT(mutateReq('PUT'), idParams('c1'));
    expect(res.status).toBe(200);
    expect(ran('UPDATE criteria')).toBe(true);
  });

  it('401s an unauthenticated caller (no lookup)', async () => {
    authRejects(401);
    const res = await PUT(mutateReq('PUT'), idParams('c1'));
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('maps an unexpected DB error to 500', async () => {
    authAs('ADMIN', 'orgA');
    sqlMock.mockRejectedValue(new Error('db down'));
    const res = await PUT(mutateReq('PUT'), idParams('c1'));
    expect(res.status).toBe(500);
  });
});

describe('DELETE /api/criteria/[id] — global-catalog + cross-org mutate guard', () => {
  it('404s when the criterion does not exist (no DELETE)', async () => {
    authAs('ADMIN', 'orgA');
    wireById(undefined);
    const res = await DELETE(mutateReq('DELETE'), idParams('c1'));
    expect(res.status).toBe(404);
    expect(ran('DELETE FROM criteria')).toBe(false);
  });

  it('DENIES a tenant admin deleting a GLOBAL (null-org) criterion → 403, no DELETE', async () => {
    authAs('ADMIN', 'orgA');
    wireById(null);
    const res = await DELETE(mutateReq('DELETE'), idParams('c1'));
    expect(res.status).toBe(403);
    expect(ran('DELETE FROM criteria')).toBe(false);
  });

  it('ALLOWS a same-org admin to delete → 200 {success:true} + DELETE ran', async () => {
    authAs('ADMIN', 'orgA');
    wireById('orgA');
    const res = await DELETE(mutateReq('DELETE'), idParams('c1'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });
    expect(ran('DELETE FROM criteria')).toBe(true);
  });

  it('ALLOWS a platform (null-org) admin to delete a GLOBAL criterion → 200', async () => {
    authAs('ADMIN', null);
    wireById(null);
    const res = await DELETE(mutateReq('DELETE'), idParams('c1'));
    expect(res.status).toBe(200);
    expect(ran('DELETE FROM criteria')).toBe(true);
  });

  it('401s an unauthenticated caller (no lookup)', async () => {
    authRejects(401);
    const res = await DELETE(mutateReq('DELETE'), idParams('c1'));
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('maps an unexpected DB error to 500', async () => {
    authAs('ADMIN', 'orgA');
    sqlMock.mockRejectedValue(new Error('db down'));
    const res = await DELETE(mutateReq('DELETE'), idParams('c1'));
    expect(res.status).toBe(500);
  });
});
