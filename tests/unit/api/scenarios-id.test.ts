/**
 * Deterministic tests for PUT/DELETE /api/scenarios/[id].
 *
 * Locks in P1-1: the shared GLOBAL catalog (org_id IS NULL) is read-only to
 * tenant admins — only a platform (null-org) admin may mutate it — and a tenant
 * admin can never mutate another org's scenario. The previous guard
 * `if (existing.orgId && existing.orgId !== userOrgId)` silently skipped
 * global rows; canMutateResource requires an exact org match.
 *
 * requireAuth/sql are mocked; the real pure canMutateResource is exercised.
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

import { PUT, DELETE } from '@/app/api/scenarios/[id]/route';

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function putReq(body: unknown = { name: 'x', type: 'CHAT' }) {
  return new Request('http://localhost/api/scenarios/s1', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
const delReq = () => new Request('http://localhost/api/scenarios/s1', { method: 'DELETE' });

/** SELECT returns a scenario with the given owning org; UPDATE/DELETE resolve empty. */
function ownedByOrg(orgId: string | null) {
  sqlMock.mockImplementation((strings?: TemplateStringsArray) => {
    const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
    // Both the ownership-check SELECT and the post-update re-fetch read
    // FROM scenarios; return the row for either so the happy path completes.
    if (text.includes('FROM scenarios')) {
      return Promise.resolve([
        { orgId, id: 's1', name: 'S', description: null, type: 'CHAT', script: {}, jobTitleId: 'j1', createdAt: null, jobTitle: { id: 'j1', name: 'J' } },
      ]);
    }
    return Promise.resolve([]);
  });
}

function asAdmin(orgId: string | null) {
  requireAuthMock.mockResolvedValue({ session: { user: { id: 'a', role: 'ADMIN', orgId } } });
}

function ranWrite(kind: 'UPDATE scenarios' | 'DELETE FROM scenarios') {
  return sqlMock.mock.calls.some((c) =>
    (Array.isArray(c[0]) ? c[0].join(' ') : '').includes(kind)
  );
}

beforeEach(() => {
  requireAuthMock.mockReset();
  sqlMock.mockReset();
});

describe('PUT /api/scenarios/[id] — global catalog protection (P1-1)', () => {
  it('DENIES a tenant admin editing a GLOBAL (null-org) scenario', async () => {
    asAdmin('orgA');
    ownedByOrg(null); // global row
    const res = await PUT(putReq(), params('s1'));
    expect(res.status).toBe(403);
    expect(ranWrite('UPDATE scenarios')).toBe(false);
  });

  it('DENIES a tenant admin editing ANOTHER org\'s scenario', async () => {
    asAdmin('orgA');
    ownedByOrg('orgB');
    const res = await PUT(putReq(), params('s1'));
    expect(res.status).toBe(403);
    expect(ranWrite('UPDATE scenarios')).toBe(false);
  });

  it('allows a tenant admin to edit their OWN org\'s scenario', async () => {
    asAdmin('orgA');
    ownedByOrg('orgA');
    const res = await PUT(putReq(), params('s1'));
    expect(res.status).toBe(200);
    expect(ranWrite('UPDATE scenarios')).toBe(true);
  });

  it('allows a platform (null-org) admin to manage the global catalog', async () => {
    asAdmin(null);
    ownedByOrg(null);
    const res = await PUT(putReq(), params('s1'));
    expect(res.status).toBe(200);
    expect(ranWrite('UPDATE scenarios')).toBe(true);
  });

  it('404 when the scenario does not exist', async () => {
    asAdmin('orgA');
    sqlMock.mockResolvedValue([]);
    const res = await PUT(putReq(), params('nope'));
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/scenarios/[id] — global catalog protection (P1-1)', () => {
  it('DENIES a tenant admin deleting a GLOBAL scenario', async () => {
    asAdmin('orgA');
    ownedByOrg(null);
    const res = await DELETE(delReq(), params('s1'));
    expect(res.status).toBe(403);
    expect(ranWrite('DELETE FROM scenarios')).toBe(false);
  });

  it('allows a tenant admin to delete their own org\'s scenario', async () => {
    asAdmin('orgA');
    ownedByOrg('orgA');
    const res = await DELETE(delReq(), params('s1'));
    expect(res.status).toBe(204);
    expect(ranWrite('DELETE FROM scenarios')).toBe(true);
  });
});
