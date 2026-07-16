import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unit test for POST /api/scenario-packs/import with DB + auth mocked — proves
// the admin-only gate, tenant scoping, idempotency accounting, and the dry-run
// preview without a live Neon binding (the live write path is exercised by the
// deploy gate + integration tier). The pure materialisation logic it drives
// (buildPackImportPlan / packModalityProfile) is covered in
// tests/unit/lib/scenario-packs.test.ts.

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

import { POST } from '@/app/api/scenario-packs/import/route';
import { AuthError } from '@/lib/auth-api';
import { SCENARIO_PACKS } from '@/lib/scenario-packs';

const PACK = SCENARIO_PACKS[0];

function req(body?: unknown): Request {
  return new Request('http://localhost/api/scenario-packs/import', {
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

describe('POST /api/scenario-packs/import — auth gate', () => {
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

  it('admin with no org → 400 (import is tenant-scoped)', async () => {
    asAdmin(null);
    const res = await POST(req({ packId: PACK.id }));
    expect(res.status).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/scenario-packs/import — validation', () => {
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

describe('POST /api/scenario-packs/import — dry run', () => {
  it('previews the plan + profile with no writes', async () => {
    asAdmin();
    const res = await POST(req({ packId: PACK.id, dryRun: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dryRun).toBe(true);
    expect(body.packId).toBe(PACK.id);
    expect(body.scenarioCount).toBe(PACK.scenarios.length);
    expect(body.profile.totalScenarios).toBe(PACK.scenarios.length);
    expect(body.scenarios).toHaveLength(PACK.scenarios.length);
    // preview never leaks the hidden mechanics
    expect(JSON.stringify(body)).not.toMatch(/customerPersona|customerObjective|"hints"/);
    expect(sqlMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/scenario-packs/import — write path', () => {
  it('fresh import → 201, all scenarios created, job title created', async () => {
    asAdmin('org-1');
    routeSql([
      [/INSERT INTO job_titles/, () => [{ id: 'jt-1' }]], // no conflict → created
      [/INSERT INTO\s+scenarios/, () => [{ id: 'sc-x' }]], // each created
    ]);
    const res = await POST(req({ packId: PACK.id }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.jobTitle.created).toBe(true);
    expect(body.scenarios.created).toBe(PACK.scenarios.length);
    expect(body.scenarios.skipped).toBe(0);
    expect(body.scenarios.total).toBe(PACK.scenarios.length);
    expect(body.packVersion).toBe(1);
  });

  it('re-import (all conflicts) → 200 no-op, job title + scenarios skipped', async () => {
    asAdmin('org-1');
    routeSql([
      [/INSERT INTO job_titles/, () => []], // conflict → DO NOTHING
      [/SELECT id FROM job_titles/, () => [{ id: 'jt-existing' }]],
      [/INSERT INTO\s+scenarios/, () => []], // each conflict → skipped
    ]);
    const res = await POST(req({ packId: PACK.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.jobTitle.created).toBe(false);
    expect(body.jobTitle.id).toBe('jt-existing');
    expect(body.scenarios.created).toBe(0);
    expect(body.scenarios.skipped).toBe(PACK.scenarios.length);
  });

  it('partial re-import (role exists, one new scenario) → 201', async () => {
    asAdmin('org-1');
    let scenarioCall = 0;
    routeSql([
      [/INSERT INTO job_titles/, () => []], // role already there
      [/SELECT id FROM job_titles/, () => [{ id: 'jt-existing' }]],
      [
        /INSERT INTO\s+scenarios/,
        () => (scenarioCall++ === 0 ? [{ id: 'sc-new' }] : []), // first new, rest skipped
      ],
    ]);
    const res = await POST(req({ packId: PACK.id }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.scenarios.created).toBe(1);
    expect(body.scenarios.skipped).toBe(PACK.scenarios.length - 1);
  });

  it('DB error → 500', async () => {
    asAdmin('org-1');
    sqlMock.mockRejectedValue(new Error('neon down'));
    const res = await POST(req({ packId: PACK.id }));
    expect(res.status).toBe(500);
  });
});
