import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unit test for /api/orgs/[id]/branding (white-label operator branding) with DB
// + auth mocked — proves the admin-only gate, cross-tenant isolation, the
// not-found + validation guards, and the partial-merge write path without a
// live Neon binding. The pure validation/authorization logic it drives is
// covered in tests/unit/lib/branding.test.ts; the live route is exercised by
// the deploy gate.

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

import { GET, PUT } from '@/app/api/orgs/[id]/branding/route';
import { AuthError } from '@/lib/auth-api';

const ORG = 'org-1';

function params(id = ORG) {
  return { params: Promise.resolve({ id }) };
}

function putReq(body?: unknown): Request {
  return new Request(`http://localhost/api/orgs/${ORG}/branding`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function getReq(): Request {
  return new Request(`http://localhost/api/orgs/${ORG}/branding`);
}

function asAdmin(orgId: string | null = null) {
  requireAuthMock.mockResolvedValue({
    session: { user: { id: 'u1', role: 'ADMIN', orgId } },
  });
}

/** A stored org row as the route's SELECT/RETURNING shape. */
function orgRow(over: Record<string, unknown> = {}) {
  return {
    id: ORG,
    parentOrgId: null,
    brandDisplayName: null,
    brandLogoUrl: null,
    brandPrimaryColor: null,
    brandAccentColor: null,
    ...over,
  };
}

/** Route sql calls by SQL text so a test can script SELECT vs UPDATE. */
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

describe('GET /api/orgs/[id]/branding — auth + tenant isolation', () => {
  it('anon → 401 (never touches the DB)', async () => {
    requireAuthMock.mockRejectedValue(new AuthError('Authentication required', 401));
    const res = await GET(getReq(), params());
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('non-admin → 403', async () => {
    requireAuthMock.mockRejectedValue(new AuthError('Admin access required', 403));
    const res = await GET(getReq(), params());
    expect(res.status).toBe(403);
  });

  it('org not found → 404', async () => {
    asAdmin(null);
    routeSql([[/SELECT/, () => []]]);
    const res = await GET(getReq(), params());
    expect(res.status).toBe(404);
  });

  it('cross-tenant admin (other org) → 403', async () => {
    asAdmin('other-org');
    routeSql([[/SELECT/, () => [orgRow({ parentOrgId: null })]]]);
    const res = await GET(getReq(), params());
    expect(res.status).toBe(403);
  });

  it('platform admin reads branding → 200', async () => {
    asAdmin(null);
    routeSql([[/SELECT/, () => [orgRow({ brandDisplayName: 'Acme', brandPrimaryColor: '#ff0000' })]]]);
    const res = await GET(getReq(), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      displayName: 'Acme',
      logoUrl: null,
      primaryColor: '#ff0000',
      accentColor: null,
    });
  });

  it('operator admin reads a CLIENT beneath them → 200', async () => {
    asAdmin('op-1');
    routeSql([[/SELECT/, () => [orgRow({ parentOrgId: 'op-1' })]]]);
    const res = await GET(getReq(), params());
    expect(res.status).toBe(200);
  });
});

describe('PUT /api/orgs/[id]/branding — validation + merge write', () => {
  it('anon → 401 (never touches the DB)', async () => {
    requireAuthMock.mockRejectedValue(new AuthError('Authentication required', 401));
    const res = await PUT(putReq({ displayName: 'X' }), params());
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('invalid JSON body → 400 (before any DB read)', async () => {
    asAdmin(null);
    const res = await PUT(putReq(), params()); // no body
    expect(res.status).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('invalid color → 400 (before any DB read)', async () => {
    asAdmin(null);
    const res = await PUT(putReq({ primaryColor: 'red' }), params());
    expect(res.status).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('org not found → 404', async () => {
    asAdmin(null);
    routeSql([[/SELECT/, () => []]]);
    const res = await PUT(putReq({ displayName: 'X' }), params());
    expect(res.status).toBe(404);
  });

  it('cross-tenant admin → 403 (no UPDATE)', async () => {
    asAdmin('other-org');
    let updated = false;
    routeSql([
      [/UPDATE/, () => { updated = true; return []; }],
      [/SELECT/, () => [orgRow({ parentOrgId: null })]],
    ]);
    const res = await PUT(putReq({ displayName: 'X' }), params());
    expect(res.status).toBe(403);
    expect(updated).toBe(false);
  });

  it('own-org admin merges only the patched field → 200', async () => {
    asAdmin(ORG);
    let writtenValues: unknown[] = [];
    routeSql([
      [/UPDATE/, (values) => {
        writtenValues = values;
        return [orgRow({ brandDisplayName: 'Fresh', brandLogoUrl: 'https://cdn/x.png' })];
      }],
      [/SELECT/, () => [orgRow({ brandLogoUrl: 'https://cdn/x.png', brandPrimaryColor: '#111111' })]],
    ]);
    const res = await PUT(putReq({ displayName: 'Fresh' }), params());
    expect(res.status).toBe(200);
    // merge kept the existing logo + color, changed only the display name
    expect(writtenValues).toContain('Fresh');
    expect(writtenValues).toContain('https://cdn/x.png');
    expect(writtenValues).toContain('#111111');
    expect(await res.json()).toMatchObject({ displayName: 'Fresh' });
  });

  it('a null clears a field via the merge', async () => {
    asAdmin(null);
    let writtenValues: unknown[] = [];
    routeSql([
      [/UPDATE/, (values) => { writtenValues = values; return [orgRow()]; }],
      [/SELECT/, () => [orgRow({ brandLogoUrl: 'https://cdn/x.png' })]],
    ]);
    const res = await PUT(putReq({ logoUrl: null }), params());
    expect(res.status).toBe(200);
    expect(writtenValues).toContain(null);
  });

  it('DB error → 500', async () => {
    asAdmin(null);
    routeSql([[/SELECT/, () => { throw new Error('neon down'); }]]);
    const res = await PUT(putReq({ displayName: 'X' }), params());
    expect(res.status).toBe(500);
  });
});
