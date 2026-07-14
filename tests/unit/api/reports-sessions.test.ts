import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unit test for GET /api/reports/sessions with DB + auth mocked. Proves the
// admin-only gate, the default own-org scoping, and — the point of this slice —
// the `?clientOrgId=` operator→client scoping: an operator may pull a client
// they own (200, query scoped to the CLIENT's org id), a cross-operator client
// is refused (403), an unknown id is 404, and anon/non-admin never reach the
// data. The pure authorization rule is covered in
// tests/unit/lib/org-hierarchy.test.ts (`canAccessOrgReport`).

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

import { GET } from '@/app/api/reports/sessions/route';
import { AuthError } from '@/lib/auth-api';

const OPERATOR = 'operator-1';
const CLIENT = 'client-1';

function req(query = ''): Request {
  return new Request(`http://localhost/api/reports/sessions${query}`);
}

function asAdmin(orgId: string | null = OPERATOR) {
  requireAuthMock.mockResolvedValue({
    session: { user: { id: 'u1', role: 'ADMIN', orgId } },
  });
}

/** The org id the main query was scoped to (captured from the `ss.org_id =`
 * filter fragment) — the security-critical value. `null` when unscoped. */
let scopedTo: unknown;

/**
 * Route sql calls by SQL text: the org lookup, the embedded `ss.org_id =`
 * filter (whose value we capture to prove scoping), and the main session query.
 */
function routeSql(orgLookup: (values: unknown[]) => unknown[]) {
  scopedTo = null;
  sqlMock.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
    if (/FROM organizations\s+WHERE id =/.test(text)) {
      return Promise.resolve(orgLookup(values));
    }
    if (/ss\.org_id =/.test(text)) {
      scopedTo = values[0];
      return Promise.resolve([]);
    }
    if (/FROM simulation_sessions/.test(text)) {
      return Promise.resolve([]); // no sessions → header-only CSV
    }
    throw new Error(`unmatched sql in test: ${text}`);
  });
}

beforeEach(() => {
  requireAuthMock.mockReset();
  sqlMock.mockReset();
  scopedTo = undefined;
});

describe('GET /api/reports/sessions — auth', () => {
  it('anon → 401 (never touches the DB)', async () => {
    requireAuthMock.mockRejectedValue(new AuthError('Authentication required', 401));
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('non-admin → 403', async () => {
    requireAuthMock.mockRejectedValue(new AuthError('Admin access required', 403));
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(sqlMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/reports/sessions — default own-org scope', () => {
  it('with no clientOrgId, scopes to the admin’s own org and returns CSV', async () => {
    asAdmin(OPERATOR);
    routeSql(() => []);
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    expect(res.headers.get('Content-Disposition')).toContain('attachment');
    // No organizations lookup happens on the default path.
    expect(scopedTo).toBe(OPERATOR);
  });
});

describe('GET /api/reports/sessions — ?clientOrgId operator→client scope', () => {
  it('unknown clientOrgId → 404 (before any session read)', async () => {
    asAdmin(OPERATOR);
    routeSql(() => []); // org lookup finds nothing
    const res = await GET(req(`?clientOrgId=${CLIENT}`));
    expect(res.status).toBe(404);
  });

  it('a client owned by the operator → 200, scoped to the CLIENT org', async () => {
    asAdmin(OPERATOR);
    routeSql(() => [{ id: CLIENT, parentOrgId: OPERATOR }]);
    const res = await GET(req(`?clientOrgId=${CLIENT}`));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    // The report must cover the CLIENT's sessions, not the operator's own org.
    expect(scopedTo).toBe(CLIENT);
  });

  it('another operator’s client → 403 (no session read)', async () => {
    asAdmin(OPERATOR);
    routeSql(() => [{ id: CLIENT, parentOrgId: 'operator-2' }]);
    const res = await GET(req(`?clientOrgId=${CLIENT}`));
    expect(res.status).toBe(403);
    // Never reached the session query.
    expect(scopedTo).toBe(null);
  });

  it('a platform admin (no org) may report on any client, scoped to it', async () => {
    asAdmin(null);
    routeSql(() => [{ id: CLIENT, parentOrgId: 'operator-2' }]);
    const res = await GET(req(`?clientOrgId=${CLIENT}`));
    expect(res.status).toBe(200);
    expect(scopedTo).toBe(CLIENT);
  });

  it('?format=pdf on a client report returns a PDF', async () => {
    asAdmin(OPERATOR);
    routeSql(() => [{ id: CLIENT, parentOrgId: OPERATOR }]);
    const res = await GET(req(`?clientOrgId=${CLIENT}&format=pdf`));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/pdf');
    expect(scopedTo).toBe(CLIENT);
  });
});

describe('GET /api/reports/sessions — ?scope=clients portfolio roll-up', () => {
  /** The operator id the roll-up query scoped to (from `o.parent_org_id =`). */
  let operatorScope: unknown;

  /**
   * Route sql for the roll-up path: the `o.parent_org_id =` filter fragment
   * (value captured) and the main session query (returns `sessions`). No
   * `organizations WHERE id =` lookup happens on the roll-up path.
   */
  function routeRollupSql(sessions: unknown[] = []) {
    operatorScope = null;
    sqlMock.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
      if (/o\.parent_org_id =/.test(text)) {
        operatorScope = values[0];
        return Promise.resolve([]);
      }
      if (/FROM simulation_sessions/.test(text)) {
        return Promise.resolve(sessions);
      }
      throw new Error(`unmatched sql in test: ${text}`);
    });
  }

  it('operator admin → 200 CSV scoped to their own operator id, with Organization column', async () => {
    asAdmin(OPERATOR);
    routeRollupSql([
      {
        id: 's1',
        type: 'CHAT',
        scoringStatus: 'SCORED',
        endedAt: '2026-07-10T00:00:00.000Z',
        createdAt: '2026-07-10T00:00:00.000Z',
        traineeEmail: 't@acme.test',
        jobTitle: 'Rep',
        scenario: 'Angry customer',
        organization: 'Acme Retail',
        scores: [{ score: 8, criteria: { name: 'Empathy', weight: 1 } }],
      },
    ]);
    const res = await GET(req('?scope=clients'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    expect(res.headers.get('Content-Disposition')).toContain('portfolio');
    expect(operatorScope).toBe(OPERATOR);
    const body = await res.text();
    expect(body.split('\r\n')[0].startsWith('Organization,')).toBe(true);
    expect(body).toContain('Acme Retail,s1,');
  });

  it('operator admin: a DIFFERENT operatorOrgId is a cross-operator attempt → 403 (no query)', async () => {
    asAdmin(OPERATOR);
    routeRollupSql();
    const res = await GET(req('?scope=clients&operatorOrgId=operator-2'));
    expect(res.status).toBe(403);
    expect(operatorScope).toBe(null);
  });

  it('platform admin (no org) without operatorOrgId → 400 (never touches the DB)', async () => {
    asAdmin(null);
    routeRollupSql();
    const res = await GET(req('?scope=clients'));
    expect(res.status).toBe(400);
    expect(operatorScope).toBe(null);
  });

  it('platform admin may roll up a named operator → 200 scoped to it', async () => {
    asAdmin(null);
    routeRollupSql();
    const res = await GET(req('?scope=clients&operatorOrgId=operator-2'));
    expect(res.status).toBe(200);
    expect(operatorScope).toBe('operator-2');
  });

  it('?format=pdf roll-up returns a PDF scoped to the operator', async () => {
    asAdmin(OPERATOR);
    routeRollupSql();
    const res = await GET(req('?scope=clients&format=pdf'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/pdf');
    expect(operatorScope).toBe(OPERATOR);
  });
});
