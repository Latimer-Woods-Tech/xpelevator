import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unit test for GET /api/me (self identity + org context, R-051) with DB + auth
// mocked — proves the auth gate, that the org is read by the caller's OWN orgId
// (never an id from the request), that a platform admin (no org) never hits the
// DB, and the 500 path. The pure projection is covered in
// tests/unit/lib/self-context.test.ts; the live 401 is a deploy gate.

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

import { GET } from '@/app/api/me/route';
import { AuthError } from '@/lib/auth-api';

function req(): Request {
  return new Request('http://localhost/api/me');
}

function asUser(user: Record<string, unknown>) {
  requireAuthMock.mockResolvedValue({ session: { user } });
}

beforeEach(() => {
  requireAuthMock.mockReset();
  sqlMock.mockReset();
});

describe('GET /api/me — auth', () => {
  it('anon → 401 and never touches the DB', async () => {
    requireAuthMock.mockRejectedValue(new AuthError('Authentication required', 401));
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/me — self scoping', () => {
  it('platform admin (no org) → 200, org null, no DB query', async () => {
    asUser({ id: 'u1', email: 'a@x.io', name: 'Ada', role: 'ADMIN', orgId: null });
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.org).toBeNull();
    expect(body.user).toEqual({ id: 'u1', email: 'a@x.io', name: 'Ada', role: 'ADMIN' });
    expect(body.canManageClients).toBe(true);
    expect(sqlMock).not.toHaveBeenCalled();
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('operator admin → org read by the caller OWN orgId (not a request id)', async () => {
    asUser({ id: 'u1', email: 'b@acme.io', name: 'Bo', role: 'ADMIN', orgId: 'org-op' });
    let boundOrgId: unknown;
    sqlMock.mockImplementation((_strings: TemplateStringsArray, ...values: unknown[]) => {
      boundOrgId = values[0];
      return Promise.resolve([
        { id: 'org-op', name: 'Acme', slug: 'acme', plan: 'ENTERPRISE', kind: 'OPERATOR', parentOrgId: null },
      ]);
    });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(boundOrgId).toBe('org-op');
    const body = await res.json();
    expect(body.org).toEqual({
      id: 'org-op', name: 'Acme', slug: 'acme', kind: 'OPERATOR', plan: 'ENTERPRISE', parentOrgId: null,
    });
    expect(body.canManageClients).toBe(true);
  });

  it('org id present but row missing → org null (200, not 500)', async () => {
    asUser({ id: 'u1', role: 'MEMBER', orgId: 'gone' });
    sqlMock.mockResolvedValue([]);
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.org).toBeNull();
    expect(body.canManageClients).toBe(false);
  });

  it('DB failure → 500', async () => {
    asUser({ id: 'u1', role: 'ADMIN', orgId: 'org-op' });
    sqlMock.mockRejectedValue(new Error('neon down'));
    const res = await GET(req());
    expect(res.status).toBe(500);
  });
});
