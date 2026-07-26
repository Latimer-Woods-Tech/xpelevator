/**
 * Deterministic API-route test — `GET /api/analytics`.
 *
 * This is the first route brought under the CI coverage gate (issue #16, P2-7
 * down-payment). The pre-existing suite in `tests/integration/api/**` drives
 * the same route handlers but against **live Neon + Groq** (via
 * `tests/setup.ts` loading real `.env`) and leans on the `DISABLE_AUTH`
 * footgun (P1-7), so it cannot be a required CI gate and left `src/app/api/**`
 * with zero enforced coverage.
 *
 * The pattern established here makes a route deterministic with NO live
 * credentials by mocking exactly two seams:
 *   - `@/lib/db`        — the neon `sql` tagged template (returns fixture rows)
 *   - `@/lib/auth-api`  — `requireAuth` (control the caller's role/org) plus a
 *                          structurally-identical `AuthError` so the route's
 *                          `instanceof AuthError` branch resolves against the
 *                          same class the test throws.
 *
 * The real, pure `computeAnalytics` (`@/lib/analytics`, already unit-tested)
 * runs unmocked so this test exercises the ROUTE glue — the auth gate, the
 * tenant-scope WHERE branch, the row→domain mapping, the cache header, and the
 * error boundary — not the aggregation math (pinned separately in
 * `tests/unit/lib/analytics.test.ts`).
 *
 * Follow-on routes join the gate the same way: add a deterministic test here
 * and append the route file to `coverage.include` in `vitest.ci.config.ts`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Hoisted so the vi.mock factories (also hoisted) can reference the same
// spies/class the test body configures.
const h = vi.hoisted(() => {
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
    requireAuth: vi.fn(),
    // `sql` is used both as the awaited outer tagged template AND to build the
    // nested WHERE fragment; a single spy returning fixture rows serves both
    // (the nested fragment's return value is only interpolated, never awaited).
    sql: vi.fn(),
  };
});

vi.mock('@/lib/db', () => ({ sql: h.sql, default: h.sql }));
vi.mock('@/lib/auth-api', () => ({ requireAuth: h.requireAuth, AuthError: h.AuthError }));

import { GET } from '@/app/api/analytics/route';

/** Two fixture rows in the raw SELECT shape the route maps over. */
function fixtureRows() {
  return [
    {
      id: 's1',
      type: 'CHAT',
      jobTitleId: 'job-1',
      scoringStatus: 'SCORED',
      endedAt: '2026-07-20T00:00:00.000Z',
      createdAt: '2026-07-19T00:00:00.000Z',
      jobTitle: { name: 'Sales' },
      scores: [{ score: 8, criteriaId: 'c1', criteria: { name: 'Empathy', weight: 10 } }],
    },
    {
      // scoringStatus null + endedAt null exercise the map's `?? null` and the
      // `row.endedAt ? … : null` branches; PHONE exercises the byType split.
      id: 's2',
      type: 'PHONE',
      jobTitleId: 'job-1',
      scoringStatus: null,
      endedAt: null,
      createdAt: '2026-07-18T00:00:00.000Z',
      jobTitle: { name: 'Sales' },
      scores: [{ score: 6, criteriaId: 'c1', criteria: { name: 'Empathy', weight: 10 } }],
    },
  ];
}

function authedAs(orgId: string | null) {
  h.requireAuth.mockResolvedValue({
    session: { user: { id: 'u1', email: 'admin@xpelevator-test.dev', role: 'ADMIN', orgId } },
  });
}

describe('GET /api/analytics', () => {
  beforeEach(() => {
    h.requireAuth.mockReset();
    h.sql.mockReset();
  });

  it('returns 401 when the caller is unauthenticated', async () => {
    h.requireAuth.mockRejectedValue(new h.AuthError('Authentication required', 401));

    const res = await GET();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Authentication required' });
    // Never reaches the query when auth fails.
    expect(h.sql).not.toHaveBeenCalled();
  });

  it('returns 200 with the analytics payload + a private short-lived cache header (org-scoped caller)', async () => {
    authedAs('org-1');
    h.sql.mockResolvedValue(fixtureRows());

    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=60');

    const body = await res.json();
    // Route glue produced the full dashboard shape from the fixture rows.
    expect(body.totalSessions).toBe(2);
    expect(typeof body.overallAvg).toBe('number');
    expect(body.byType.map((t: { type: string }) => t.type).sort()).toEqual(['CHAT', 'PHONE']);
    expect(body.byJobTitle).toHaveLength(1);
    expect(body.byJobTitle[0].name).toBe('Sales');
  });

  it('keeps the org + global pool scope for an org caller (org path unchanged)', async () => {
    authedAs('org-1');
    let orgScopedTo: unknown = null;
    let ownerFilterBuilt = false;
    h.sql.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
      if (/ss\.org_id IS NULL AND ss\.user_id =/.test(text)) {
        ownerFilterBuilt = true;
        return Promise.resolve([]);
      }
      if (/ss\.org_id = .*OR ss\.org_id IS NULL/.test(text)) {
        orgScopedTo = values[0];
        return Promise.resolve([]);
      }
      if (/FROM simulation_sessions/.test(text)) {
        return Promise.resolve(fixtureRows());
      }
      return Promise.resolve([]);
    });

    const res = await GET();

    expect(res.status).toBe(200);
    // Org callers keep the existing `org OR global` pool — no user narrowing.
    expect(orgScopedTo).toBe('org-1');
    expect(ownerFilterBuilt).toBe(false);
  });

  it('scopes an org-less caller to their OWN null-org sessions — never the shared null-org pool (session-access doctrine)', async () => {
    authedAs(null);
    // Capture the tenant WHERE fragment the route builds. Per
    // `canAccessSession` (src/lib/session-access.ts), null-org sessions are
    // OWNER-ONLY: the fragment must pair `org_id IS NULL` with a
    // `ss.user_id = <caller>` filter. A bare `org_id IS NULL` (the shared-pool
    // bug) aggregates EVERY self-registered user's scores into this caller's
    // dashboard.
    let ownerScopedTo: unknown = null;
    h.sql.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
      if (/ss\.org_id IS NULL AND ss\.user_id =/.test(text)) {
        ownerScopedTo = values[0];
        return Promise.resolve([]);
      }
      if (/FROM simulation_sessions/.test(text)) {
        return Promise.resolve(fixtureRows());
      }
      // Any other fragment (e.g. the legacy pooled bare `org_id IS NULL`).
      return Promise.resolve([]);
    });

    const res = await GET();

    expect(res.status).toBe(200);
    // The security-critical assertion: the null-org branch filtered by the
    // caller's own auth id.
    expect(ownerScopedTo).toBe('u1');
  });

  it('returns 500 on an unexpected (non-auth) failure', async () => {
    authedAs('org-1');
    // Throw synchronously from the query seam so no dangling rejected promise
    // escapes the tagged-template interpolation.
    h.sql.mockImplementation(() => {
      throw new Error('db unreachable');
    });

    const res = await GET();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to load analytics' });
  });
});
