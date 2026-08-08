import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unit test for GET /api/reports/spend with DB + auth mocked. Proves the
// admin-only gate, the default own-org scoping, the null-org owner-only doctrine
// (`canAccessSession`), and the `?clientOrgId=` operator→client scoping — the
// same tenant-isolation contract as /api/reports/sessions, applied to the spend
// ledger so it can never surface another tenant's Groq spend. The pure
// aggregation/pricing is covered in tests/unit/lib/{spend,cost}.test.ts.

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

import { GET } from '@/app/api/reports/spend/route';
import { AuthError } from '@/lib/auth-api';

const OPERATOR = 'operator-1';
const CLIENT = 'client-1';

function req(query = ''): Request {
  return new Request(`http://localhost/api/reports/spend${query}`);
}

function asAdmin(orgId: string | null = OPERATOR) {
  requireAuthMock.mockResolvedValue({
    session: { user: { id: 'u1', role: 'ADMIN', orgId } },
  });
}

/** The org id the main query was scoped to (captured from `ss.org_id =`). */
let scopedTo: unknown;

/**
 * Route sql calls by SQL text: the `?clientOrgId` org lookup, the embedded
 * `ss.org_id =` scope fragment (value captured), and the main spend query
 * (returns `rows` so the ledger builds).
 */
function routeSql(
  orgLookup: (values: unknown[]) => unknown[],
  rows: unknown[] = [],
) {
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
      return Promise.resolve(rows);
    }
    throw new Error(`unmatched sql in test: ${text}`);
  });
}

beforeEach(() => {
  requireAuthMock.mockReset();
  sqlMock.mockReset();
  scopedTo = undefined;
});

describe('GET /api/reports/spend — auth', () => {
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

describe('GET /api/reports/spend — default own-org scope', () => {
  it('with no clientOrgId, scopes to the admin’s own org and returns JSON', async () => {
    asAdmin(OPERATOR);
    routeSql(() => []);
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(scopedTo).toBe(OPERATOR);
  });

  it('builds the ledger from the query rows (per-session + totals)', async () => {
    asAdmin(OPERATOR);
    routeSql(() => [], [
      {
        sessionId: 's1',
        trainee: 'a@ex.com',
        scenario: 'Refund',
        createdAt: '2026-08-08T10:00:00.000Z',
        model: 'llama-3.1-8b-instant',
        promptTokens: 1000,
        completionTokens: 200,
        totalTokens: 1200,
        turns: 3,
      },
    ]);
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sessions: Array<{ sessionId: string; costMicroUsd: number; cost: string }>;
      totals: { costMicroUsd: number; totalTokens: number };
    };
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].sessionId).toBe('s1');
    expect(body.sessions[0].costMicroUsd).toBe(66);
    expect(body.sessions[0].cost).toBe('$0.000066');
    expect(body.totals.costMicroUsd).toBe(66);
    expect(body.totals.totalTokens).toBe(1200);
  });
});

describe('GET /api/reports/spend — null-org owner-only scope', () => {
  let ownerScopedTo: unknown;
  let pooledFragmentBuilt: boolean;

  function routeNullOrgSql() {
    ownerScopedTo = null;
    pooledFragmentBuilt = false;
    sqlMock.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
      if (/ss\.org_id IS NULL AND ss\.user_id =/.test(text)) {
        ownerScopedTo = values[0];
        return Promise.resolve([]);
      }
      if (/ss\.org_id IS NULL/.test(text)) {
        pooledFragmentBuilt = true;
        return Promise.resolve([]);
      }
      if (/FROM simulation_sessions/.test(text)) {
        return Promise.resolve([]);
      }
      throw new Error(`unmatched sql in test: ${text}`);
    });
  }

  it('an org-less admin sees ONLY their own sessions, never the null-org pool', async () => {
    asAdmin(null);
    routeNullOrgSql();
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(ownerScopedTo).toBe('u1');
    expect(pooledFragmentBuilt).toBe(false);
  });
});

describe('GET /api/reports/spend — ?clientOrgId operator→client scope', () => {
  it('unknown clientOrgId → 404 (before any spend read)', async () => {
    asAdmin(OPERATOR);
    routeSql(() => []);
    const res = await GET(req(`?clientOrgId=${CLIENT}`));
    expect(res.status).toBe(404);
  });

  it('a client owned by the operator → 200, scoped to the CLIENT org', async () => {
    asAdmin(OPERATOR);
    routeSql(() => [{ id: CLIENT, parentOrgId: OPERATOR }]);
    const res = await GET(req(`?clientOrgId=${CLIENT}`));
    expect(res.status).toBe(200);
    expect(scopedTo).toBe(CLIENT);
  });

  it('another operator’s client → 403 (no spend read)', async () => {
    asAdmin(OPERATOR);
    routeSql(() => [{ id: CLIENT, parentOrgId: 'other-operator' }]);
    const res = await GET(req(`?clientOrgId=${CLIENT}`));
    expect(res.status).toBe(403);
    expect(scopedTo).toBeNull();
  });
});

describe('GET /api/reports/spend — window validation', () => {
  it('a malformed ?since → 400 (before any DB read)', async () => {
    asAdmin(OPERATOR);
    routeSql(() => []);
    const res = await GET(req('?since=not-a-date'));
    expect(res.status).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('a valid ?since & ?until compose onto the tenant scope (still 200)', async () => {
    asAdmin(OPERATOR);
    // Route the extra created_at window fragments the composition builds, on top
    // of the org-scope fragment and the main query.
    const seen: string[] = [];
    sqlMock.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
      if (/ss\.org_id =/.test(text)) {
        scopedTo = values[0];
        return Promise.resolve([]);
      }
      if (/AND ss\.created_at >=/.test(text)) {
        seen.push(`since:${values[values.length - 1]}`);
        return Promise.resolve([]);
      }
      if (/AND ss\.created_at </.test(text)) {
        seen.push(`until:${values[values.length - 1]}`);
        return Promise.resolve([]);
      }
      if (/FROM simulation_sessions/.test(text)) {
        return Promise.resolve([]);
      }
      throw new Error(`unmatched sql in test: ${text}`);
    });
    const res = await GET(req('?since=2026-08-01&until=2026-08-31'));
    expect(res.status).toBe(200);
    expect(scopedTo).toBe(OPERATOR);
    // Inclusive `since`, exclusive `until` = the day AFTER (whole-day cover).
    expect(seen).toEqual(['since:2026-08-01', 'until:2026-09-01']);
  });
});
