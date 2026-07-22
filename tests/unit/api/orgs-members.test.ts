import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unit test for /api/orgs/[id]/members with DB + auth mocked. Focus: the
// cross-tenant member-hijack guard on POST — the email-keyed upsert sets
// `org_id = <destination>`, so an existing user could be RELOCATED out of an
// org the caller does not govern. The guard refuses to move a user whose
// current org the caller cannot reach (409, no INSERT), while still allowing
// new users, same-org re-invites, org-less adoption, and moves within the
// caller's own governance. The admin-only + destination-isolation gates on
// GET/POST/DELETE are covered too. The pure authorization predicate this drives
// (`canAccessOrg`) is unit-tested in tests/unit/lib/org-hierarchy.test.ts; the
// live route is exercised by the deploy gate.

const requireAuthMock = vi.fn();

vi.mock('@/lib/auth-api', () => {
  class AuthError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
      this.name = 'AuthError';
    }
  }
  return {
    AuthError,
    requireAuth: (...args: unknown[]) => requireAuthMock(...args),
  };
});

const sqlMock = vi.fn();
vi.mock('@/lib/db', () => ({
  sql: (...args: unknown[]) => sqlMock(...args),
}));

import { GET, POST, DELETE } from '@/app/api/orgs/[id]/members/route';
import { AuthError } from '@/lib/auth-api';

const DEST = 'org-B'; // the destination org the caller is governing

function params(id = DEST) {
  return { params: Promise.resolve({ id }) };
}

function postReq(body?: unknown): Request {
  return new Request(`http://localhost/api/orgs/${DEST}/members`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function getReq(): Request {
  return new Request(`http://localhost/api/orgs/${DEST}/members`);
}

function deleteReq(body?: unknown): Request {
  return new Request(`http://localhost/api/orgs/${DEST}/members`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function asAdmin(orgId: string | null = null) {
  requireAuthMock.mockResolvedValue({
    session: { user: { id: 'u1', role: 'ADMIN', orgId } },
  });
}

/**
 * Script the route's SQL by shape.
 *  - `orgs`: id -> governance target ({ parentOrgId }) or `undefined` (→ 404/absent)
 *  - `existingUser`: the row returned by the email lookup, or `null`
 *  - captures whether the upsert INSERT ran (via `state.inserted`)
 */
function routeSql(opts: {
  orgs?: Record<string, { parentOrgId: string | null }>;
  existingUser?: { orgId: string | null } | null;
  members?: Array<Record<string, unknown>>;
  userInOrg?: boolean;
}) {
  const state = { inserted: false, orgIdCleared: false };
  const orgs = opts.orgs ?? { [DEST]: { parentOrgId: null } };
  sqlMock.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = (Array.isArray(strings) ? strings.join(' ') : String(strings)).replace(/\s+/g, ' ');
    if (/FROM organizations/.test(text)) {
      const id = values[0] as string;
      const t = orgs[id];
      return Promise.resolve(t ? [{ id, parentOrgId: t.parentOrgId }] : []);
    }
    if (/FROM users WHERE email/.test(text)) {
      return Promise.resolve(opts.existingUser ? [opts.existingUser] : []);
    }
    if (/INSERT INTO users/.test(text)) {
      state.inserted = true;
      return Promise.resolve([
        { id: 'new-user', email: values[0], name: null, orgId: DEST, role: 'MEMBER', createdAt: 'now' },
      ]);
    }
    if (/FROM users WHERE org_id/.test(text)) {
      return Promise.resolve(opts.members ?? []);
    }
    if (/SELECT id FROM users WHERE id/.test(text)) {
      return Promise.resolve(opts.userInOrg ? [{ id: values[0] }] : []);
    }
    if (/UPDATE\s+users/.test(text)) {
      state.orgIdCleared = true;
      return Promise.resolve([]);
    }
    throw new Error(`unmatched sql in test: ${text}`);
  });
  return state;
}

beforeEach(() => {
  requireAuthMock.mockReset();
  sqlMock.mockReset();
});

describe('POST /api/orgs/[id]/members — cross-tenant member-hijack guard', () => {
  it('anon → 401 (never touches the DB)', async () => {
    requireAuthMock.mockRejectedValue(new AuthError('Authentication required', 401));
    const res = await POST(postReq({ email: 'x@y.com' }), params());
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('non-admin → 403', async () => {
    requireAuthMock.mockRejectedValue(new AuthError('Admin access required', 403));
    const res = await POST(postReq({ email: 'x@y.com' }), params());
    expect(res.status).toBe(403);
  });

  it('destination org not found → 404', async () => {
    asAdmin(null);
    routeSql({ orgs: {} });
    const res = await POST(postReq({ email: 'x@y.com' }), params());
    expect(res.status).toBe(404);
  });

  it('cross-tenant admin on the destination org → 403', async () => {
    asAdmin('other-op'); // governs neither DEST nor its parent
    routeSql({ orgs: { [DEST]: { parentOrgId: null } } });
    const res = await POST(postReq({ email: 'x@y.com' }), params());
    expect(res.status).toBe(403);
  });

  it('BLOCKS relocating a user out of an org the caller cannot govern → 409, no INSERT', async () => {
    asAdmin(DEST); // governs the destination org B, but NOT org-A
    const state = routeSql({
      orgs: { [DEST]: { parentOrgId: null }, 'org-A': { parentOrgId: null } },
      existingUser: { orgId: 'org-A' }, // victim currently belongs to another tenant
    });
    const res = await POST(postReq({ email: 'victim@org-a.com', role: 'ADMIN' }), params());
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('USER_IN_ANOTHER_ORG');
    expect(state.inserted).toBe(false); // the hijack upsert never ran
  });

  it('creates a brand-new user (no existing email) → 201', async () => {
    asAdmin(DEST);
    const state = routeSql({ orgs: { [DEST]: { parentOrgId: null } }, existingUser: null });
    const res = await POST(postReq({ email: 'new@org-b.com' }), params());
    expect(res.status).toBe(201);
    expect(state.inserted).toBe(true);
  });

  it('re-invites a user already in this org → 201 (same-org, guard skipped)', async () => {
    asAdmin(DEST);
    const state = routeSql({
      orgs: { [DEST]: { parentOrgId: null } },
      existingUser: { orgId: DEST },
    });
    const res = await POST(postReq({ email: 'member@org-b.com', role: 'ADMIN' }), params());
    expect(res.status).toBe(201);
    expect(state.inserted).toBe(true);
  });

  it('adopts an org-less existing user → 201 (no tenant to steal from)', async () => {
    asAdmin(DEST);
    const state = routeSql({
      orgs: { [DEST]: { parentOrgId: null } },
      existingUser: { orgId: null },
    });
    const res = await POST(postReq({ email: 'personal@gmail.com' }), params());
    expect(res.status).toBe(201);
    expect(state.inserted).toBe(true);
  });

  it('platform admin may relocate a user across orgs → 201', async () => {
    asAdmin(null); // platform admin governs any source
    const state = routeSql({
      orgs: { [DEST]: { parentOrgId: null }, 'org-A': { parentOrgId: null } },
      existingUser: { orgId: 'org-A' },
    });
    const res = await POST(postReq({ email: 'anyone@org-a.com' }), params());
    expect(res.status).toBe(201);
    expect(state.inserted).toBe(true);
  });

  it('operator may move a user between its OWN client orgs → 201', async () => {
    asAdmin('op-1'); // operator; DEST and the source are both clients beneath op-1
    const state = routeSql({
      orgs: { [DEST]: { parentOrgId: 'op-1' }, 'client-A': { parentOrgId: 'op-1' } },
      existingUser: { orgId: 'client-A' },
    });
    const res = await POST(postReq({ email: 'trainee@client-a.com' }), params());
    expect(res.status).toBe(201);
    expect(state.inserted).toBe(true);
  });

  it('email is required → 400', async () => {
    asAdmin(DEST);
    routeSql({ orgs: { [DEST]: { parentOrgId: null } } });
    const res = await POST(postReq({ email: '  ' }), params());
    expect(res.status).toBe(400);
  });
});

describe('GET /api/orgs/[id]/members — auth + destination isolation', () => {
  it('anon → 401 (never touches the DB)', async () => {
    requireAuthMock.mockRejectedValue(new AuthError('Authentication required', 401));
    const res = await GET(getReq(), params());
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('cross-tenant admin → 403', async () => {
    asAdmin('other-op');
    routeSql({ orgs: { [DEST]: { parentOrgId: null } } });
    const res = await GET(getReq(), params());
    expect(res.status).toBe(403);
  });

  it('own-org admin → 200 with the roster', async () => {
    asAdmin(DEST);
    routeSql({
      orgs: { [DEST]: { parentOrgId: null } },
      members: [{ id: 'm1', email: 'a@b.com', name: null, role: 'MEMBER', createdAt: 'now' }],
    });
    const res = await GET(getReq(), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveLength(1);
  });
});

describe('DELETE /api/orgs/[id]/members — auth + destination isolation', () => {
  it('anon → 401 (never touches the DB)', async () => {
    requireAuthMock.mockRejectedValue(new AuthError('Authentication required', 401));
    const res = await DELETE(deleteReq({ userId: 'u9' }), params());
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('cross-tenant admin → 403 (no eviction)', async () => {
    asAdmin('other-op');
    const state = routeSql({ orgs: { [DEST]: { parentOrgId: null } } });
    const res = await DELETE(deleteReq({ userId: 'u9' }), params());
    expect(res.status).toBe(403);
    expect(state.orgIdCleared).toBe(false);
  });

  it('own-org admin removes a member in the org → 204', async () => {
    asAdmin(DEST);
    const state = routeSql({ orgs: { [DEST]: { parentOrgId: null } }, userInOrg: true });
    const res = await DELETE(deleteReq({ userId: 'u9' }), params());
    expect(res.status).toBe(204);
    expect(state.orgIdCleared).toBe(true);
  });

  it('member not in this org → 404', async () => {
    asAdmin(DEST);
    routeSql({ orgs: { [DEST]: { parentOrgId: null } }, userInOrg: false });
    const res = await DELETE(deleteReq({ userId: 'ghost' }), params());
    expect(res.status).toBe(404);
  });
});
