import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unit test for /api/orgs/[id]/clients (operator→client hierarchy) with DB +
// auth mocked — proves the admin-only gate, cross-tenant isolation, the
// two-level-hierarchy guard, parent promotion, and slug-conflict fallback
// without a live Neon binding. The pure authorization/slug logic it drives is
// covered in tests/unit/lib/org-hierarchy.test.ts; the live write path is
// exercised by the deploy gate.

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

import { GET, POST } from '@/app/api/orgs/[id]/clients/route';
import { AuthError } from '@/lib/auth-api';

const OPERATOR = 'op-1';

function params(id = OPERATOR) {
  return { params: Promise.resolve({ id }) };
}

function req(body?: unknown): Request {
  return new Request(`http://localhost/api/orgs/${OPERATOR}/clients`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function asAdmin(orgId: string | null = OPERATOR) {
  requireAuthMock.mockResolvedValue({
    session: { user: { id: 'u1', role: 'ADMIN', orgId } },
  });
}

/** Route sql calls by SQL text so a test can script each statement. */
function routeSql(cases: Array<[RegExp, (values: unknown[]) => unknown[]]>) {
  sqlMock.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
    for (const [pattern, fn] of cases) {
      if (pattern.test(text)) return Promise.resolve(fn(values));
    }
    throw new Error(`unmatched sql in test: ${text}`);
  });
}

beforeEach(() => {
  requireAuthMock.mockReset();
  sqlMock.mockReset();
});

describe('POST /api/orgs/[id]/clients — auth + tenant isolation', () => {
  it('anon → 401 (never touches the DB)', async () => {
    requireAuthMock.mockRejectedValue(new AuthError('Authentication required', 401));
    const res = await POST(req({ name: 'Acme' }), params());
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('non-admin → 403', async () => {
    requireAuthMock.mockRejectedValue(new AuthError('Admin access required', 403));
    const res = await POST(req({ name: 'Acme' }), params());
    expect(res.status).toBe(403);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('operator admin of a DIFFERENT operator → 403 (cross-tenant)', async () => {
    asAdmin('op-2');
    const res = await POST(req({ name: 'Acme' }), params(OPERATOR));
    expect(res.status).toBe(403);
    expect(sqlMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/orgs/[id]/clients — validation + hierarchy guards', () => {
  it('missing name → 400', async () => {
    asAdmin();
    const res = await POST(req({}), params());
    expect(res.status).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('unknown operator → 404', async () => {
    asAdmin();
    routeSql([[/SELECT id, kind FROM organizations/, () => []]]);
    const res = await POST(req({ name: 'Acme' }), params());
    expect(res.status).toBe(404);
  });

  it('parent is itself a CLIENT → 409 (two-level hierarchy)', async () => {
    asAdmin();
    routeSql([[/SELECT id, kind FROM organizations/, () => [{ id: OPERATOR, kind: 'CLIENT' }]]]);
    const res = await POST(req({ name: 'Acme' }), params());
    expect(res.status).toBe(409);
  });
});

describe('POST /api/orgs/[id]/clients — write path', () => {
  it('fresh create → 201, promotes parent, returns CLIENT row', async () => {
    asAdmin();
    let promoted = false;
    routeSql([
      [/SELECT id, kind FROM organizations/, () => [{ id: OPERATOR, kind: 'STANDALONE' }]],
      [/UPDATE organizations SET kind = 'OPERATOR'/, () => { promoted = true; return []; }],
      [
        /INSERT INTO organizations/,
        () => [{ id: 'c1', name: 'Acme', slug: 'acme', plan: 'FREE', kind: 'CLIENT', parentOrgId: OPERATOR, createdAt: 't' }],
      ],
    ]);
    const res = await POST(req({ name: 'Acme' }), params());
    expect(res.status).toBe(201);
    const b = await res.json();
    expect(b.kind).toBe('CLIENT');
    expect(b.parentOrgId).toBe(OPERATOR);
    expect(b.slug).toBe('acme');
    expect(promoted).toBe(true);
  });

  it('slug conflict on first try → falls back to a suffixed slug (201)', async () => {
    asAdmin();
    let insertCall = 0;
    routeSql([
      [/SELECT id, kind FROM organizations/, () => [{ id: OPERATOR, kind: 'OPERATOR' }]],
      [/UPDATE organizations SET kind = 'OPERATOR'/, () => []],
      [
        /INSERT INTO organizations/,
        () => (insertCall++ === 0 ? [] : [{ id: 'c2', name: 'Acme', slug: 'acme-abc123', plan: 'FREE', kind: 'CLIENT', parentOrgId: OPERATOR, createdAt: 't' }]),
      ],
    ]);
    const res = await POST(req({ name: 'Acme' }), params());
    expect(res.status).toBe(201);
    expect(insertCall).toBe(2); // retried after the conflict
  });

  it('all slug attempts conflict → 409', async () => {
    asAdmin();
    routeSql([
      [/SELECT id, kind FROM organizations/, () => [{ id: OPERATOR, kind: 'OPERATOR' }]],
      [/UPDATE organizations SET kind = 'OPERATOR'/, () => []],
      [/INSERT INTO organizations/, () => []],
    ]);
    const res = await POST(req({ name: 'Acme' }), params());
    expect(res.status).toBe(409);
  });

  it('DB error → 500', async () => {
    asAdmin();
    sqlMock.mockRejectedValue(new Error('neon down'));
    const res = await POST(req({ name: 'Acme' }), params());
    expect(res.status).toBe(500);
  });
});

describe('GET /api/orgs/[id]/clients', () => {
  it('anon → 401', async () => {
    requireAuthMock.mockRejectedValue(new AuthError('Authentication required', 401));
    const res = await GET(req(), params());
    expect(res.status).toBe(401);
  });

  it('cross-tenant operator admin → 403', async () => {
    asAdmin('op-2');
    const res = await GET(req(), params(OPERATOR));
    expect(res.status).toBe(403);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('unknown operator → 404', async () => {
    asAdmin();
    routeSql([[/SELECT id FROM organizations WHERE id/, () => []]]);
    const res = await GET(req(), params());
    expect(res.status).toBe(404);
  });

  it('lists client orgs with counts → 200', async () => {
    asAdmin();
    routeSql([
      [/SELECT id FROM organizations WHERE id/, () => [{ id: OPERATOR }]],
      [
        /o\.parent_org_id = /,
        () => [
          { id: 'c1', name: 'Acme', slug: 'acme', plan: 'FREE', kind: 'CLIENT', parentOrgId: OPERATOR, createdAt: 't', '_count.users': '3', '_count.sessions': '5' },
        ],
      ],
    ]);
    const res = await GET(req(), params());
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b).toHaveLength(1);
    expect(b[0]._count).toEqual({ users: 3, sessions: 5 });
    expect(b[0].kind).toBe('CLIENT');
  });
});
