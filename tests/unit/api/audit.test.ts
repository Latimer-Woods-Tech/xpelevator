import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unit test for GET /api/audit (governance audit-trail read surface, issue #157
// §10) with DB + auth mocked — proves the admin-only gate, the org-scoped read,
// operator↔client authorization (via the real pure `canAccessOrgReport`), the
// unknown-org 404, cross-tenant 403, the platform-admin unscoped read, the
// action filter, and limit clamping — without a live Neon binding. The live
// route is exercised by the deploy gate.

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

// The real pure org-hierarchy authorizer is used (no mock) — the point is to
// exercise the actual own-org / operator-client / platform-admin logic.
import { GET } from '@/app/api/audit/route';
import { AuthError } from '@/lib/auth-api';

function getReq(qs = ''): Request {
  return new Request(`http://localhost/api/audit${qs}`);
}

function asAdmin(orgId: string | null = null) {
  requireAuthMock.mockResolvedValue({
    session: { user: { id: 'u1', dbUserId: 'u1', email: 'a@x.com', role: 'ADMIN', orgId } },
  });
}

const AUDIT_ROW = {
  id: 'a1',
  action: 'org.update',
  actorUserId: 'u1',
  actorEmail: 'a@x.com',
  orgId: 'org-1',
  targetType: 'organization',
  targetId: 'org-1',
  metadata: { changed: ['plan'] },
  createdAt: '2026-08-07T00:00:00.000Z',
};

/** Route sql calls by SQL text so a test can script the org lookup vs the read. */
function routeSql(cases: Array<[RegExp, (values: unknown[]) => unknown[]]>) {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  sqlMock.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = Array.isArray(strings) ? strings.join('?') : String(strings);
    calls.push({ text, values });
    for (const [pattern, fn] of cases) {
      if (pattern.test(text)) return Promise.resolve(fn(values));
    }
    throw new Error(`unmatched sql in test: ${text}`);
  });
  return calls;
}

/** The interpolated values of the `FROM audit_log` read (the last such call). */
function auditReadValues(calls: Array<{ text: string; values: unknown[] }>): unknown[] {
  const read = calls.filter((c) => /FROM audit_log/.test(c.text)).at(-1);
  return read?.values ?? [];
}

beforeEach(() => {
  requireAuthMock.mockReset();
  sqlMock.mockReset();
});

describe('GET /api/audit — auth gate', () => {
  it('anon → 401 (never touches the DB)', async () => {
    requireAuthMock.mockRejectedValue(new AuthError('Authentication required', 401));
    const res = await GET(getReq());
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('non-admin member → 403 (never touches the DB)', async () => {
    requireAuthMock.mockRejectedValue(new AuthError('Admin access required', 403));
    const res = await GET(getReq());
    expect(res.status).toBe(403);
    expect(sqlMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/audit — org-scoped read', () => {
  it('own-org admin (no params) reads only their org, most-recent-first', async () => {
    asAdmin('org-1');
    const calls = routeSql([[/FROM audit_log/, () => [AUDIT_ROW]]]);
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].action).toBe('org.update');
    // scoped to the caller's org, default limit 50
    expect(auditReadValues(calls)).toEqual(['org-1', 50]);
  });

  it('?action=<name> narrows the read to that action (own org)', async () => {
    asAdmin('org-1');
    const calls = routeSql([[/FROM audit_log/, () => [AUDIT_ROW]]]);
    const res = await GET(getReq('?action=org.update'));
    expect(res.status).toBe(200);
    // org + action + limit interpolated in order
    expect(auditReadValues(calls)).toEqual(['org-1', 'org.update', 50]);
  });

  it('?limit clamps: >200 caps to 200, invalid falls back to 50', async () => {
    asAdmin('org-1');
    let calls = routeSql([[/FROM audit_log/, () => []]]);
    await GET(getReq('?limit=9999'));
    expect(auditReadValues(calls)).toEqual(['org-1', 200]);

    sqlMock.mockReset();
    calls = routeSql([[/FROM audit_log/, () => []]]);
    await GET(getReq('?limit=abc'));
    expect(auditReadValues(calls)).toEqual(['org-1', 50]);
  });
});

describe('GET /api/audit — cross-tenant authorization (?orgId)', () => {
  it('operator admin reads a CLIENT org beneath them → 200', async () => {
    asAdmin('op-1'); // viewer org = op-1
    const calls = routeSql([
      [/FROM organizations/, () => [{ id: 'client-1', parentOrgId: 'op-1' }]],
      [/FROM audit_log/, () => [AUDIT_ROW]],
    ]);
    const res = await GET(getReq('?orgId=client-1'));
    expect(res.status).toBe(200);
    expect(auditReadValues(calls)).toEqual(['client-1', 50]);
  });

  it('operator admin reading ANOTHER operator’s client → 403 (no audit read)', async () => {
    asAdmin('op-1');
    const calls = routeSql([
      [/FROM organizations/, () => [{ id: 'other-client', parentOrgId: 'op-2' }]],
    ]);
    const res = await GET(getReq('?orgId=other-client'));
    expect(res.status).toBe(403);
    expect(calls.some((c) => /FROM audit_log/.test(c.text))).toBe(false);
  });

  it('?orgId of an unknown org → 404', async () => {
    asAdmin('op-1');
    routeSql([[/FROM organizations/, () => []]]);
    const res = await GET(getReq('?orgId=ghost'));
    expect(res.status).toBe(404);
  });

  it('platform admin (no org) may read any org via ?orgId', async () => {
    asAdmin(null);
    const calls = routeSql([
      [/FROM organizations/, () => [{ id: 'any-org', parentOrgId: null }]],
      [/FROM audit_log/, () => [AUDIT_ROW]],
    ]);
    const res = await GET(getReq('?orgId=any-org'));
    expect(res.status).toBe(200);
    expect(auditReadValues(calls)).toEqual(['any-org', 50]);
  });
});

describe('GET /api/audit — platform-admin unscoped read', () => {
  it('platform admin with no ?orgId reads the platform-wide trail', async () => {
    asAdmin(null);
    const calls = routeSql([[/FROM audit_log/, () => [AUDIT_ROW]]]);
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    // no org lookup, no org filter — only the limit is interpolated
    expect(calls.some((c) => /FROM organizations/.test(c.text))).toBe(false);
    expect(auditReadValues(calls)).toEqual([50]);
  });

  it('platform admin ?action filter, still unscoped', async () => {
    asAdmin(null);
    const calls = routeSql([[/FROM audit_log/, () => []]]);
    const res = await GET(getReq('?action=org.delete'));
    expect(res.status).toBe(200);
    expect(auditReadValues(calls)).toEqual(['org.delete', 50]);
  });
});

describe('GET /api/audit — error boundary', () => {
  it('DB error → 500', async () => {
    asAdmin('org-1');
    routeSql([[/FROM audit_log/, () => { throw new Error('neon down'); }]]);
    const res = await GET(getReq());
    expect(res.status).toBe(500);
  });
});
