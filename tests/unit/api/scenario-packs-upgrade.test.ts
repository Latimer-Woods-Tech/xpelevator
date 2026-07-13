import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unit test for POST /api/scenario-packs/upgrade with DB + auth mocked — proves
// the admin-only gate, tenant scoping, the not-imported no-op, the dry-run drift
// preview, and the update/insert accounting without a live Neon binding (the live
// write path is covered by the deploy gate). The pure drift logic it drives
// (buildPackUpgradePlan) is covered in tests/unit/lib/scenario-packs.test.ts.

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

import { POST } from '@/app/api/scenario-packs/upgrade/route';
import { AuthError } from '@/lib/auth-api';
import { SCENARIO_PACKS, PACK_CATALOG_VERSION } from '@/lib/scenario-packs';

const PACK = SCENARIO_PACKS[0];
const KEYS = PACK.scenarios.map((s) => s.key);

function req(body?: unknown): Request {
  return new Request('http://localhost/api/scenario-packs/upgrade', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function asAdmin(orgId: string | null = 'org-1') {
  requireAuthMock.mockResolvedValue({
    session: { user: { id: 'u1', role: 'ADMIN', orgId } },
  });
}

/** Route sql calls by the SQL text so a test can script each statement. */
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

describe('POST /api/scenario-packs/upgrade — auth gate', () => {
  it('anon caller → 401 (never touches the DB)', async () => {
    requireAuthMock.mockRejectedValue(new AuthError('Authentication required', 401));
    const res = await POST(req({ packId: PACK.id }));
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('non-admin → 403', async () => {
    requireAuthMock.mockRejectedValue(new AuthError('Admin access required', 403));
    const res = await POST(req({ packId: PACK.id }));
    expect(res.status).toBe(403);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('admin with no org → 400 (upgrade is tenant-scoped)', async () => {
    asAdmin(null);
    const res = await POST(req({ packId: PACK.id }));
    expect(res.status).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/scenario-packs/upgrade — validation', () => {
  it('missing packId → 400', async () => {
    asAdmin();
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('unknown packId → 404', async () => {
    asAdmin();
    const res = await POST(req({ packId: 'no-such-pack' }));
    expect(res.status).toBe(404);
    expect(sqlMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/scenario-packs/upgrade — not imported', () => {
  it('org has no rows for the pack → 200 imported:false, no writes', async () => {
    asAdmin('org-1');
    routeSql([[/SELECT source_scenario_key/, () => []]]); // no stored rows
    const res = await POST(req({ packId: PACK.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imported).toBe(false);
    expect(body.targetVersion).toBe(PACK_CATALOG_VERSION);
    // only the read ran — no UPDATE / INSERT
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/scenario-packs/upgrade — dry run', () => {
  it('previews the drift with no writes', async () => {
    asAdmin('org-1');
    // stored at an older version → every scenario is stale
    routeSql([
      [
        /SELECT source_scenario_key/,
        () => KEYS.map((k) => ({ sourceScenarioKey: k, packVersion: PACK_CATALOG_VERSION - 1 })),
      ],
    ]);
    const res = await POST(req({ packId: PACK.id, dryRun: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dryRun).toBe(true);
    expect(body.counts.update).toBe(KEYS.length);
    expect(body.counts.insert).toBe(0);
    expect(body.counts.unchanged).toBe(0);
    expect(body.items).toHaveLength(KEYS.length);
    // preview never leaks the hidden mechanics
    expect(JSON.stringify(body)).not.toMatch(/customerPersona|customerObjective|"hints"/);
    // only the read ran
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/scenario-packs/upgrade — write path', () => {
  it('all rows current → 200 clean no-op (updated 0 / inserted 0)', async () => {
    asAdmin('org-1');
    routeSql([
      [
        /SELECT source_scenario_key/,
        () => KEYS.map((k) => ({ sourceScenarioKey: k, packVersion: PACK_CATALOG_VERSION })),
      ],
    ]);
    const res = await POST(req({ packId: PACK.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imported).toBe(true);
    expect(body.scenarios.updated).toBe(0);
    expect(body.scenarios.inserted).toBe(0);
    expect(body.scenarios.unchanged).toBe(KEYS.length);
    // no UPDATE / INSERT statements issued
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it('stale rows → each is UPDATE-d and counted', async () => {
    asAdmin('org-1');
    routeSql([
      [
        /SELECT source_scenario_key/,
        () => KEYS.map((k) => ({ sourceScenarioKey: k, packVersion: PACK_CATALOG_VERSION - 1 })),
      ],
      [/UPDATE scenarios SET/, () => [{ id: 'sc-updated' }]], // each stale row updated
    ]);
    const res = await POST(req({ packId: PACK.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scenarios.updated).toBe(KEYS.length);
    expect(body.scenarios.inserted).toBe(0);
  });

  it('a missing catalog scenario → inserted under the resolved pack job title', async () => {
    asAdmin('org-1');
    // org has every scenario except the first, all current → the first is an insert
    routeSql([
      [
        /SELECT source_scenario_key/,
        () => KEYS.slice(1).map((k) => ({ sourceScenarioKey: k, packVersion: PACK_CATALOG_VERSION })),
      ],
      [/SELECT id FROM job_titles/, () => [{ id: 'jt-1' }]], // resolve the pack's role
      [/INSERT INTO scenarios/, () => [{ id: 'sc-new' }]], // the missing scenario lands
    ]);
    const res = await POST(req({ packId: PACK.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scenarios.inserted).toBe(1);
    expect(body.scenarios.updated).toBe(0);
    expect(body.scenarios.unchanged).toBe(KEYS.length - 1);
  });

  it('orphaned stored keys are reported, never deleted', async () => {
    asAdmin('org-1');
    routeSql([
      [
        /SELECT source_scenario_key/,
        () => [
          ...KEYS.map((k) => ({ sourceScenarioKey: k, packVersion: PACK_CATALOG_VERSION })),
          { sourceScenarioKey: 'retired-key', packVersion: PACK_CATALOG_VERSION },
        ],
      ],
    ]);
    const res = await POST(req({ packId: PACK.id }));
    const body = await res.json();
    expect(body.scenarios.orphaned).toBe(1);
    expect(body.scenarios.orphanedKeys).toEqual(['retired-key']);
    // no DELETE statement is ever issued
    const issued = sqlMock.mock.calls
      .map((c) => (Array.isArray(c[0]) ? c[0].join(' ') : ''))
      .join(' ');
    expect(issued).not.toMatch(/DELETE/i);
  });

  it('DB error → 500', async () => {
    asAdmin('org-1');
    sqlMock.mockRejectedValue(new Error('neon down'));
    const res = await POST(req({ packId: PACK.id }));
    expect(res.status).toBe(500);
  });
});
