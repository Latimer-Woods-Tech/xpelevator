/**
 * Deterministic tests for the standalone organization governance routes —
 * `GET/POST /api/orgs` and `GET/PUT/DELETE /api/orgs/[id]`.
 *
 * These are the last uncovered standalone CRUD resource in the `src/app/api/**`
 * sweep (P2-7) and the most security-loaded: they carry the platform-vs-tenant
 * scope split (R-043) plus two guards NARROWER than a plain rename —
 * `canSetOrgPlan` (the seat-tier billing-bypass gate) and `canDeleteOrg` (the
 * irreversible teardown gate). The nested `orgs/[id]/{branding,clients,members}`
 * sub-routes were already gated; the standalone parent resource was not, so
 * those invariants had no regression test here. This locks them in:
 *
 *  - LIST  `GET /api/orgs` is ADMIN-only and SCOPED: a platform admin (no org)
 *          sees every org (no `WHERE o.id`); a tenant/operator admin sees only
 *          their own org + the clients beneath them (`o.parent_org_id =`).
 *  - CREATE `POST /api/orgs` mints a top-level org — PLATFORM admin only. A
 *          tenant/operator admin (ADMIN WITH an org) is refused (403), even
 *          though they pass the ADMIN role gate.
 *  - READ  `GET /api/orgs/[id]` is governed by the real `canAccessOrg`: own org
 *          or an owned client → 200; another tenant's org → 403; missing → 404.
 *  - PLAN  a `plan` change on `PUT /api/orgs/[id]` runs the real `canSetOrgPlan`:
 *          an org's OWN admin may rename but may NOT self-upgrade the seat tier
 *          (403) — the billing-bypass hole — while an operator may set a client's
 *          plan; an invalid tier value is rejected (400) before any write.
 *  - DELETE `DELETE /api/orgs/[id]` runs the real `canDeleteOrg`: an org's own
 *          admin may NOT self-delete a provisioned workspace (403); an operator
 *          may delete a client they own, but only when it is session-free (409).
 *
 * The pure predicates driven here (`isPlatformAdmin`, `canAccessOrg`,
 * `canSetOrgPlan`, `canDeleteOrg`) also have direct unit tests in
 * tests/unit/lib/org-hierarchy.test.ts; this exercises them through the real
 * route wiring (auth gate + `getOrgGovernanceTarget` lookup + SQL routing).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireAuthMock, sqlMock, recordAuditMock, FakeAuthError } = vi.hoisted(() => {
  class FakeAuthError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
      this.name = 'AuthError';
    }
  }
  return { requireAuthMock: vi.fn(), sqlMock: vi.fn(), recordAuditMock: vi.fn(), FakeAuthError };
});

vi.mock('@/lib/auth-api', () => ({ requireAuth: requireAuthMock, AuthError: FakeAuthError }));
vi.mock('@/lib/db', () => ({ sql: sqlMock, default: sqlMock }));
// Audit wiring (issue #157 §10): a completed org.update / org.delete records one
// governance event; a rejected/no-op mutation records none. Mocked so the real
// best-effort writer never touches the shared sqlMock.
vi.mock('@/lib/audit', () => ({ recordAudit: (...a: unknown[]) => recordAuditMock(...a) }));

// The routes import the REAL tenant-guard predicates (`org-hierarchy`) and the
// REAL governance-target lookup (`org-guard`, which reads the mocked `sql`), and
// the REAL `isOrgPlan` validator — those are the actual authorization decisions
// under test, so none of them are mocked.
import { GET as LIST, POST as CREATE } from '@/app/api/orgs/route';
import { GET, PUT, DELETE } from '@/app/api/orgs/[id]/route';

const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

const postReq = (body: Record<string, unknown>) =>
  new Request('http://localhost/api/orgs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const mutateReq = (method: string, body: Record<string, unknown> = { name: 'x' }) =>
  new Request('http://localhost/api/orgs/o1', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const getReq = () => new Request('http://localhost/api/orgs/o1');

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

/**
 * Route the `/api/orgs/[id]` SQL by shape. Ordered so the governance-target
 * lookup (`parent_org_id as "parentOrgId"`) and the specific tables match
 * before the generic `FROM organizations` re-read.
 *   - `target`: the governance row (`{ id, parentOrgId }`) or `undefined` → []
 *     (route maps that to 404 via `getOrgGovernanceTarget`).
 *   - `sessionCount`: rows counted by the DELETE safety check.
 */
function wireOrg(
  target: { id: string; parentOrgId: string | null } | undefined,
  opts: { sessionCount?: number } = {}
) {
  sqlMock.mockImplementation((strings?: TemplateStringsArray) => {
    const t = text(strings);
    if (t.includes('parent_org_id as "parentOrgId"')) {
      return Promise.resolve(target === undefined ? [] : [{ id: target.id, parentOrgId: target.parentOrgId }]);
    }
    if (t.includes('json_agg')) {
      // GET details
      return Promise.resolve([
        {
          id: target?.id ?? 'o1',
          name: 'Acme',
          slug: 'acme',
          plan: 'FREE',
          createdAt: 't',
          users: [],
          '_count.sessions': 0,
          '_count.jobTitles': 0,
          '_count.scenarios': 0,
        },
      ]);
    }
    if (t.includes('FROM simulation_sessions')) {
      return Promise.resolve([{ count: opts.sessionCount ?? 0 }]);
    }
    if (t.includes('UPDATE organizations') || t.includes('DELETE FROM organizations')) {
      return Promise.resolve([]);
    }
    // PUT post-write re-read: SELECT ... FROM organizations WHERE id (no join).
    if (t.includes('FROM organizations')) {
      return Promise.resolve([{ id: target?.id ?? 'o1', name: 'Acme', slug: 'acme', plan: 'FREE', createdAt: 't' }]);
    }
    return Promise.resolve([]);
  });
}

beforeEach(() => {
  requireAuthMock.mockReset();
  sqlMock.mockReset();
  recordAuditMock.mockReset();
});

describe('GET /api/orgs — admin-only, scoped org list', () => {
  it('401s an unauthenticated caller (requireAuth throws)', async () => {
    authRejects(401);
    const res = await LIST(new Request('http://localhost/api/orgs'));
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('a platform admin (null org) sees EVERY org — no org filter bound', async () => {
    authAs('ADMIN', null);
    sqlMock.mockResolvedValue([
      { id: 'o1', name: 'Acme', slug: 'acme', plan: 'FREE', createdAt: 't', '_count.users': 3, '_count.sessions': 9 },
    ]);
    const res = await LIST(new Request('http://localhost/api/orgs'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual([
      { id: 'o1', name: 'Acme', slug: 'acme', plan: 'FREE', createdAt: 't', _count: { users: 3, sessions: 9 } },
    ]);
    // The platform branch has no WHERE / parent scoping — it lists all orgs.
    expect(ran('o.parent_org_id =')).toBe(false);
    expect(ran('WHERE o.id =')).toBe(false);
  });

  it('a tenant/operator admin sees ONLY their own org + owned clients (scoped)', async () => {
    authAs('ADMIN', 'orgA');
    sqlMock.mockResolvedValue([
      { id: 'orgA', name: 'Op', slug: 'op', plan: 'ENTERPRISE', createdAt: 't', '_count.users': 1, '_count.sessions': 0 },
    ]);
    const res = await LIST(new Request('http://localhost/api/orgs'));
    expect(res.status).toBe(200);
    // The scoped branch binds own-org + client (parent_org_id) — never all orgs.
    expect(ran('o.parent_org_id =')).toBe(true);
    expect(ran('WHERE o.id =')).toBe(true);
  });

  it('maps an unexpected DB error to 500', async () => {
    authAs('ADMIN', null);
    sqlMock.mockRejectedValue(new Error('db down'));
    const res = await LIST(new Request('http://localhost/api/orgs'));
    expect(res.status).toBe(500);
  });
});

describe('POST /api/orgs — PLATFORM-admin-only top-level create', () => {
  it('403s a non-admin (requireAuth ADMIN throws)', async () => {
    authRejects(403);
    const res = await CREATE(postReq({ name: 'x' }));
    expect(res.status).toBe(403);
    expect(ran('INSERT INTO organizations')).toBe(false);
  });

  it('DENIES a tenant/operator admin (ADMIN WITH an org) minting a top-level org → 403, no INSERT', async () => {
    authAs('ADMIN', 'orgA');
    const res = await CREATE(postReq({ name: 'Rogue Top-Level' }));
    expect(res.status).toBe(403);
    expect(ran('INSERT INTO organizations')).toBe(false);
  });

  it('400s a platform admin with a blank name (no INSERT)', async () => {
    authAs('ADMIN', null);
    const res = await CREATE(postReq({ name: '   ' }));
    expect(res.status).toBe(400);
    expect(ran('INSERT INTO organizations')).toBe(false);
  });

  it('ALLOWS a platform admin to create a top-level org → 201 + INSERT ran', async () => {
    authAs('ADMIN', null);
    sqlMock.mockResolvedValue([{ id: 'new', name: 'Acme', slug: 'acme', plan: 'FREE', createdAt: 't' }]);
    const res = await CREATE(postReq({ name: 'Acme' }));
    expect(res.status).toBe(201);
    expect(ran('INSERT INTO organizations')).toBe(true);
  });

  it('maps an unexpected DB error to 500', async () => {
    authAs('ADMIN', null);
    sqlMock.mockRejectedValue(new Error('db down'));
    const res = await CREATE(postReq({ name: 'Acme' }));
    expect(res.status).toBe(500);
  });
});

describe('GET /api/orgs/[id] — canAccessOrg tenant-isolation guard', () => {
  it('401s an unauthenticated caller (no lookup)', async () => {
    authRejects(401);
    const res = await GET(getReq(), idParams('o1'));
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('404s when the org does not exist (no details query)', async () => {
    authAs('ADMIN', 'orgA');
    wireOrg(undefined);
    const res = await GET(getReq(), idParams('o1'));
    expect(res.status).toBe(404);
    expect(ran('json_agg')).toBe(false);
  });

  it('DENIES an org-A admin reading org-B → 403, no details query', async () => {
    authAs('ADMIN', 'orgA');
    wireOrg({ id: 'orgB', parentOrgId: null });
    const res = await GET(getReq(), idParams('orgB'));
    expect(res.status).toBe(403);
    expect(ran('json_agg')).toBe(false);
  });

  it('ALLOWS a same-org admin to read own org → 200', async () => {
    authAs('ADMIN', 'orgA');
    wireOrg({ id: 'orgA', parentOrgId: null });
    const res = await GET(getReq(), idParams('orgA'));
    expect(res.status).toBe(200);
    expect(ran('json_agg')).toBe(true);
  });

  it('ALLOWS an operator admin to read a CLIENT they own → 200', async () => {
    authAs('ADMIN', 'orgOp');
    wireOrg({ id: 'orgC', parentOrgId: 'orgOp' });
    const res = await GET(getReq(), idParams('orgC'));
    expect(res.status).toBe(200);
    expect(ran('json_agg')).toBe(true);
  });

  it('ALLOWS a platform (null-org) admin to read any org → 200', async () => {
    authAs('ADMIN', null);
    wireOrg({ id: 'orgX', parentOrgId: null });
    const res = await GET(getReq(), idParams('orgX'));
    expect(res.status).toBe(200);
    expect(ran('json_agg')).toBe(true);
  });

  it('maps an unexpected DB error to 500', async () => {
    authAs('ADMIN', 'orgA');
    sqlMock.mockRejectedValue(new Error('db down'));
    const res = await GET(getReq(), idParams('orgA'));
    expect(res.status).toBe(500);
  });
});

describe('PUT /api/orgs/[id] — access + canSetOrgPlan (self-upgrade) guard', () => {
  it('404s when the org does not exist (no UPDATE)', async () => {
    authAs('ADMIN', 'orgA');
    wireOrg(undefined);
    const res = await PUT(mutateReq('PUT'), idParams('o1'));
    expect(res.status).toBe(404);
    expect(ran('UPDATE organizations')).toBe(false);
  });

  it('DENIES an org-A admin editing org-B → 403, no UPDATE', async () => {
    authAs('ADMIN', 'orgA');
    wireOrg({ id: 'orgB', parentOrgId: null });
    const res = await PUT(mutateReq('PUT'), idParams('orgB'));
    expect(res.status).toBe(403);
    expect(ran('UPDATE organizations')).toBe(false);
  });

  it('400s an invalid plan value before any write (own org)', async () => {
    authAs('ADMIN', 'orgA');
    wireOrg({ id: 'orgA', parentOrgId: null });
    const res = await PUT(mutateReq('PUT', { plan: 'PLATINUM' }), idParams('orgA'));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: 'INVALID_PLAN' });
    expect(ran('UPDATE organizations')).toBe(false);
  });

  it('DENIES an org OWN admin self-upgrading the plan (billing bypass) → 403, no UPDATE', async () => {
    authAs('ADMIN', 'orgA');
    wireOrg({ id: 'orgA', parentOrgId: null });
    const res = await PUT(mutateReq('PUT', { plan: 'ENTERPRISE' }), idParams('orgA'));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: 'PLAN_CHANGE_FORBIDDEN' });
    expect(ran('UPDATE organizations')).toBe(false);
    // Rejected mutation → no audit row (issue #157 §10).
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it('ALLOWS an operator admin to set a CLIENT’s plan → 200 + UPDATE ran', async () => {
    authAs('ADMIN', 'orgOp');
    wireOrg({ id: 'orgC', parentOrgId: 'orgOp' });
    const res = await PUT(mutateReq('PUT', { plan: 'ENTERPRISE' }), idParams('orgC'));
    expect(res.status).toBe(200);
    expect(ran('UPDATE organizations')).toBe(true);
    // Audits the completed plan change with the plan in metadata (issue #157 §10).
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'org.update',
        orgId: 'orgC',
        targetId: 'orgC',
        metadata: expect.objectContaining({ changed: ['plan'], plan: 'ENTERPRISE' }),
      }),
    );
  });

  it('ALLOWS an org OWN admin a name-only rename (no plan) → 200 + UPDATE ran', async () => {
    authAs('ADMIN', 'orgA');
    wireOrg({ id: 'orgA', parentOrgId: null });
    const res = await PUT(mutateReq('PUT', { name: 'Renamed' }), idParams('orgA'));
    expect(res.status).toBe(200);
    expect(ran('UPDATE organizations')).toBe(true);
    // A rename records `changed: ['name']` and no plan key.
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'org.update', metadata: { changed: ['name'] } }),
    );
  });

  it('ALLOWS a platform (null-org) admin to set any org’s plan → 200', async () => {
    authAs('ADMIN', null);
    wireOrg({ id: 'orgX', parentOrgId: null });
    const res = await PUT(mutateReq('PUT', { plan: 'PRO' }), idParams('orgX'));
    expect(res.status).toBe(200);
    expect(ran('UPDATE organizations')).toBe(true);
  });

  it('401s an unauthenticated caller (no lookup)', async () => {
    authRejects(401);
    const res = await PUT(mutateReq('PUT'), idParams('o1'));
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('maps an unexpected DB error to 500', async () => {
    authAs('ADMIN', 'orgA');
    sqlMock.mockRejectedValue(new Error('db down'));
    const res = await PUT(mutateReq('PUT'), idParams('orgA'));
    expect(res.status).toBe(500);
  });
});

describe('DELETE /api/orgs/[id] — access + canDeleteOrg + session-safety guard', () => {
  it('404s when the org does not exist (no DELETE)', async () => {
    authAs('ADMIN', 'orgA');
    wireOrg(undefined);
    const res = await DELETE(mutateReq('DELETE'), idParams('o1'));
    expect(res.status).toBe(404);
    expect(ran('DELETE FROM organizations')).toBe(false);
  });

  it('DENIES an org-A admin deleting org-B → 403, no DELETE', async () => {
    authAs('ADMIN', 'orgA');
    wireOrg({ id: 'orgB', parentOrgId: null });
    const res = await DELETE(mutateReq('DELETE'), idParams('orgB'));
    expect(res.status).toBe(403);
    expect(ran('DELETE FROM organizations')).toBe(false);
  });

  it('DENIES an org OWN admin self-deleting a provisioned workspace → 403, no DELETE', async () => {
    authAs('ADMIN', 'orgA');
    wireOrg({ id: 'orgA', parentOrgId: null });
    const res = await DELETE(mutateReq('DELETE'), idParams('orgA'));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: 'ORG_DELETE_FORBIDDEN' });
    expect(ran('DELETE FROM organizations')).toBe(false);
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it('409s when an owned client still has sessions (no DELETE)', async () => {
    authAs('ADMIN', 'orgOp');
    wireOrg({ id: 'orgC', parentOrgId: 'orgOp' }, { sessionCount: 4 });
    const res = await DELETE(mutateReq('DELETE'), idParams('orgC'));
    expect(res.status).toBe(409);
    expect(ran('DELETE FROM organizations')).toBe(false);
  });

  it('ALLOWS an operator admin to delete a session-free CLIENT they own → 204 + DELETE ran', async () => {
    authAs('ADMIN', 'orgOp');
    wireOrg({ id: 'orgC', parentOrgId: 'orgOp' }, { sessionCount: 0 });
    const res = await DELETE(mutateReq('DELETE'), idParams('orgC'));
    expect(res.status).toBe(204);
    expect(ran('DELETE FROM organizations')).toBe(true);
    // Audits the deletion — the FK-free row outlives the org (issue #157 §10).
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'org.delete', orgId: 'orgC', targetId: 'orgC' }),
    );
  });

  it('ALLOWS a platform (null-org) admin to delete a session-free org → 204', async () => {
    authAs('ADMIN', null);
    wireOrg({ id: 'orgX', parentOrgId: null }, { sessionCount: 0 });
    const res = await DELETE(mutateReq('DELETE'), idParams('orgX'));
    expect(res.status).toBe(204);
    expect(ran('DELETE FROM organizations')).toBe(true);
  });

  it('401s an unauthenticated caller (no lookup)', async () => {
    authRejects(401);
    const res = await DELETE(mutateReq('DELETE'), idParams('o1'));
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('maps an unexpected DB error to 500', async () => {
    authAs('ADMIN', 'orgA');
    sqlMock.mockRejectedValue(new Error('db down'));
    const res = await DELETE(mutateReq('DELETE'), idParams('orgA'));
    expect(res.status).toBe(500);
  });
});
