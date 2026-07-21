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

  it('?view=summary → 200 per-client totals CSV (Organization,Trainees,Sessions,…), same operator scope', async () => {
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
    const res = await GET(req('?scope=clients&view=summary'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    // Summary filename slug, not the detail 'portfolio' export.
    expect(res.headers.get('Content-Disposition')).toContain('portfolio-summary');
    // Same operator-owned tenant scope as the detail roll-up (no widening).
    expect(operatorScope).toBe(OPERATOR);
    const body = await res.text();
    expect(body.split('\r\n')[0]).toBe('Organization,Trainees,Sessions,Scored,Weighted Average');
    // One totals row for the client (1 distinct trainee), then the grand total.
    expect(body).toContain('Acme Retail,1,1,1,8');
    expect(body).toContain('TOTAL (all clients),1,1,1,8');
  });

  it('?view=summary&format=pdf → 200 summary PDF, operator-scoped', async () => {
    asAdmin(OPERATOR);
    routeRollupSql();
    const res = await GET(req('?scope=clients&view=summary&format=pdf'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/pdf');
    expect(res.headers.get('Content-Disposition')).toContain('portfolio-summary');
    expect(operatorScope).toBe(OPERATOR);
  });

  it('?view=summary WITHOUT scope=clients is ignored (stays own-org detail CSV)', async () => {
    asAdmin(OPERATOR);
    // Non-rollup path: an `organizations` lookup does not run, the main query
    // returns the own-org detail. `view=summary` must not trigger the roll-up.
    routeSql(() => []);
    const res = await GET(req('?view=summary'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toContain('sessions');
    expect(res.headers.get('Content-Disposition')).not.toContain('portfolio');
    const body = await res.text();
    // Detail (single-org) header, not the summary header.
    expect(body.split('\r\n')[0]).toContain('Session ID');
  });
});

describe('GET /api/reports/sessions — ?since/?until date window (R-065)', () => {
  /** The date bounds the query composed onto the scope fragment. */
  let sinceBound: unknown;
  let untilBound: unknown;

  /**
   * Route sql for the own-org path WITH a date window: the inner `ss.org_id =`
   * scope fragment, then the wrapped `ss.ended_at >=` / `ss.ended_at <` bound
   * fragments (their trailing value — the date — captured), then the main query.
   */
  function routeWindowSql() {
    scopedTo = null;
    sinceBound = null;
    untilBound = null;
    sqlMock.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
      if (/ss\.ended_at >=/.test(text)) {
        sinceBound = values[values.length - 1]; // the date; values[0] = nested where
        return Promise.resolve([]);
      }
      if (/ss\.ended_at </.test(text)) {
        untilBound = values[values.length - 1];
        return Promise.resolve([]);
      }
      if (/ss\.org_id =/.test(text)) {
        scopedTo = values[0];
        return Promise.resolve([]);
      }
      if (/FROM simulation_sessions/.test(text)) {
        return Promise.resolve([]);
      }
      throw new Error(`unmatched sql in test: ${text}`);
    });
  }

  it('a malformed date → 400 before any DB read', async () => {
    asAdmin(OPERATOR);
    routeWindowSql();
    const res = await GET(req('?since=not-a-date'));
    expect(res.status).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('since after until → 400 before any DB read', async () => {
    asAdmin(OPERATOR);
    routeWindowSql();
    const res = await GET(req('?since=2026-08-01&until=2026-07-01'));
    expect(res.status).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('a full window → 200, still own-org scoped, with both date bounds composed', async () => {
    asAdmin(OPERATOR);
    routeWindowSql();
    const res = await GET(req('?since=2026-07-01&until=2026-07-31'));
    expect(res.status).toBe(200);
    // Tenant scope is preserved — the window only narrows it.
    expect(scopedTo).toBe(OPERATOR);
    expect(sinceBound).toBe('2026-07-01');
    // `until` is applied as the EXCLUSIVE next-day bound (whole-day cover).
    expect(untilBound).toBe('2026-08-01');
  });

  it('since only → lower bound composed, no upper bound', async () => {
    asAdmin(OPERATOR);
    routeWindowSql();
    const res = await GET(req('?since=2026-07-01'));
    expect(res.status).toBe(200);
    expect(sinceBound).toBe('2026-07-01');
    expect(untilBound).toBe(null);
  });

  it('no window → all-time (neither bound fragment runs)', async () => {
    asAdmin(OPERATOR);
    routeWindowSql();
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(scopedTo).toBe(OPERATOR);
    expect(sinceBound).toBe(null);
    expect(untilBound).toBe(null);
  });
});
