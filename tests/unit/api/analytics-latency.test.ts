/**
 * Deterministic API-route test — `GET /api/analytics/latency`.
 *
 * Same pattern as `analytics.test.ts` (issue #16, P2-7): mock exactly two
 * seams — `@/lib/db` (`sql`) and `@/lib/auth-api` (`requireAuth` + a
 * structurally-identical `AuthError`) — and let the real, pure
 * `summarizeLatency` (`@/lib/latency-summary`, unit-tested separately) run
 * unmocked, so this suite exercises the ROUTE glue: the auth gate, the tenant
 * WHERE branch, the `?since`/`?until` window composition, the row→turn
 * mapping, and the error boundary.
 *
 * The tenant-scope tests pin the session-access doctrine
 * (src/lib/session-access.ts): null-org data is OWNER-ONLY. A bare
 * `org_id IS NULL` fallback is the shared-pool bug — it aggregates every
 * self-registered user's latency turns into any org-less caller's view.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

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
    sql: vi.fn(),
  };
});

vi.mock('@/lib/db', () => ({ sql: h.sql, default: h.sql }));
vi.mock('@/lib/auth-api', () => ({ requireAuth: h.requireAuth, AuthError: h.AuthError }));

import { GET } from '@/app/api/analytics/latency/route';
import { MAX_ANALYTICS_SCAN_ROWS } from '@/lib/limits';

function req(query = ''): Request {
  return new Request(`http://localhost/api/analytics/latency${query}`);
}

/** Two measured reply turns in the raw SELECT shape the route maps over. */
function fixtureRows() {
  return [
    {
      ttftMs: 400,
      totalMs: 900,
      tier: 'realtime',
      model: 'model-a',
      routeReason: 'default',
      modality: 'CHAT',
    },
    {
      // Nulls exercise every `?? null` branch of the row→turn mapping.
      ttftMs: 2600,
      totalMs: 4100,
      tier: null,
      model: null,
      routeReason: null,
      modality: null,
    },
  ];
}

function authedAs(orgId: string | null) {
  h.requireAuth.mockResolvedValue({
    session: { user: { id: 'u1', email: 'user@xpelevator-test.dev', role: 'MEMBER', orgId } },
  });
}

/** Captures from the routed sql mock. */
let orgScopedTo: unknown;
let ownerScopedTo: unknown;
let pooledFragmentBuilt: boolean;
let sinceBound: unknown;
let untilBound: unknown;

/**
 * Route sql calls by SQL text: the tenant fragment (org pool / owner-only /
 * legacy pooled bare `IS NULL`), the window bound fragments, and the main
 * turns query (returns `rows`).
 */
function routeSql(rows: unknown[] = []) {
  orgScopedTo = null;
  ownerScopedTo = null;
  pooledFragmentBuilt = false;
  sinceBound = null;
  untilBound = null;
  h.sql.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
    if (/ss\.org_id IS NULL AND ss\.user_id =/.test(text)) {
      ownerScopedTo = values[0];
      return Promise.resolve([]);
    }
    if (/ss\.org_id = .*OR ss\.org_id IS NULL/.test(text)) {
      orgScopedTo = values[0];
      return Promise.resolve([]);
    }
    if (/ss\.org_id IS NULL/.test(text)) {
      pooledFragmentBuilt = true;
      return Promise.resolve([]);
    }
    if (/cm\.timestamp >=/.test(text)) {
      sinceBound = values[values.length - 1];
      return Promise.resolve([]);
    }
    if (/cm\.timestamp </.test(text)) {
      untilBound = values[values.length - 1];
      return Promise.resolve([]);
    }
    if (/FROM chat_messages/.test(text)) {
      return Promise.resolve(rows);
    }
    // The base `cm.ttft_ms IS NOT NULL AND (...)` composition fragment.
    return Promise.resolve([]);
  });
}

describe('GET /api/analytics/latency', () => {
  beforeEach(() => {
    h.requireAuth.mockReset();
    h.sql.mockReset();
  });

  it('returns 401 when the caller is unauthenticated (never touches the DB)', async () => {
    h.requireAuth.mockRejectedValue(new h.AuthError('Authentication required', 401));

    const res = await GET(req());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Authentication required' });
    expect(h.sql).not.toHaveBeenCalled();
  });

  it('org caller → 200 summary, tenant scope = org pool + global (org path unchanged)', async () => {
    authedAs('org-1');
    routeSql(fixtureRows());

    const res = await GET(req());

    expect(res.status).toBe(200);
    expect(orgScopedTo).toBe('org-1');
    // Org callers are never narrowed to owner-only.
    expect(ownerScopedTo).toBe(null);

    const body = await res.json();
    // The real `summarizeLatency` produced the dashboard shape from the rows.
    expect(body.measuredTurns).toBe(2);
    expect(body.avgTtftMs).toBe(1500);
    expect(body.tierBreakdown).toEqual({ realtime: 1, acceptable: 0, slow: 0 });
    expect(body.byModel.map((g: { key: string }) => g.key).sort()).toEqual([
      '(unknown)',
      'model-a',
    ]);
    expect(body.byModality).toHaveLength(2);
    // P3b-2: a normal (under-cap) scan is never truncated.
    expect(body.truncated).toBe(false);
  });

  it('bounds an over-cap scan to MAX_ANALYTICS_SCAN_ROWS and flags truncated (P3b-2)', async () => {
    authedAs('org-1');
    // The query SELECTs `LIMIT max + 1`; simulate a tenant with more turns than
    // the cap by returning max + 1 measured rows.
    const overCap = Array.from({ length: MAX_ANALYTICS_SCAN_ROWS + 1 }, () => ({
      ttftMs: 100,
      totalMs: 200,
      tier: 'realtime',
      model: 'model-a',
      routeReason: 'default',
      modality: 'CHAT',
    }));
    routeSql(overCap);

    const res = await GET(req());
    expect(res.status).toBe(200);

    const body = await res.json();
    // PROOF-OF-REJECTION (Standing Law 1): the summary is computed over exactly
    // `max` turns, not the full `max + 1` the DB returned, and the caller is told
    // the view is truncated. Removing the boundScan wiring fails both assertions.
    expect(body.truncated).toBe(true);
    expect(body.measuredTurns).toBe(MAX_ANALYTICS_SCAN_ROWS);
  });

  it('scopes an org-less caller to their OWN null-org turns — never the shared null-org pool (session-access doctrine)', async () => {
    authedAs(null);
    routeSql(fixtureRows());

    const res = await GET(req());

    expect(res.status).toBe(200);
    // The security-critical assertions: the null-org branch filters on the
    // caller's own auth id, and the pooled bare-`IS NULL` fragment is never built.
    expect(ownerScopedTo).toBe('u1');
    expect(pooledFragmentBuilt).toBe(false);
  });

  it('a malformed ?since date → 400 before any DB read', async () => {
    authedAs('org-1');
    routeSql();

    const res = await GET(req('?since=not-a-date'));

    expect(res.status).toBe(400);
    expect(h.sql).not.toHaveBeenCalled();
  });

  it('?since/?until compose onto the tenant filter (until as the exclusive next day)', async () => {
    authedAs('org-1');
    routeSql();

    const res = await GET(req('?since=2026-07-01&until=2026-07-31'));

    expect(res.status).toBe(200);
    expect(orgScopedTo).toBe('org-1');
    expect(sinceBound).toBe('2026-07-01');
    expect(untilBound).toBe('2026-08-01');
  });

  it('returns 500 on an unexpected (non-auth) failure', async () => {
    authedAs('org-1');
    h.sql.mockImplementation(() => {
      throw new Error('db unreachable');
    });

    const res = await GET(req());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to load latency summary' });
  });
});
