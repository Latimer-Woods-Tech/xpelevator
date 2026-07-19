/**
 * Deterministic tests for the tenant-scope guard on POST /api/scenarios.
 *
 * Locks in the fix for the cross-tenant write IDOR where the handler inserted a
 * scenario with a caller-supplied `jobTitleId` WITHOUT verifying that job title
 * was visible to the caller. An org-A admin could therefore attach a scenario
 * to another tenant's PRIVATE job title (injecting content into org B's
 * /api/jobs view). The guard mirrors POST /api/jobs/[id]/criteria and
 * POST /api/simulations: `canReadResource` (own-org OR global).
 *   - job title not found                 -> 404, no INSERT
 *   - job title owned by another tenant   -> 403, no INSERT
 *   - global (null-org) job title         -> 201 (legitimate authoring)
 *   - own-org job title                    -> 201
 *
 * requireAuth/sql are mocked; the real pure canReadResource is exercised.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireAuthMock, sqlMock, FakeAuthError } = vi.hoisted(() => {
  class FakeAuthError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
      this.name = 'AuthError';
    }
  }
  return { requireAuthMock: vi.fn(), sqlMock: vi.fn(), FakeAuthError };
});

vi.mock('@/lib/auth-api', () => ({ requireAuth: requireAuthMock, AuthError: FakeAuthError }));
vi.mock('@/lib/db', () => ({ sql: sqlMock, default: sqlMock }));

import { POST } from '@/app/api/scenarios/route';

function postReq(body: unknown = { jobTitleId: 'j1', name: 'x', type: 'CHAT' }) {
  return new Request('http://localhost/api/scenarios', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function asAdmin(orgId: string | null) {
  requireAuthMock.mockResolvedValue({
    session: { user: { id: 'a', role: 'ADMIN', orgId } },
  });
}

/**
 * Wire the sql mock. `jobOrg === undefined` → the guard SELECT returns no rows
 * (job not found). Otherwise the guard returns a job owned by `jobOrg`. The
 * INSERT and the trailing job-title read resolve to plausible rows so a
 * permitted request reaches 201.
 */
function wire(jobOrg?: string | null) {
  sqlMock.mockImplementation((strings?: TemplateStringsArray) => {
    const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
    // Guard lookup: SELECT org_id as "orgId" FROM job_titles WHERE id = ...
    if (text.includes('org_id as "orgId"') && text.includes('FROM job_titles')) {
      return Promise.resolve(jobOrg === undefined ? [] : [{ orgId: jobOrg }]);
    }
    if (text.includes('INSERT INTO scenarios')) {
      return Promise.resolve([{ id: 's1', jobTitleId: 'j1', name: 'x', orgId: 'a' }]);
    }
    // Trailing "SELECT id, name FROM job_titles WHERE id" for the response.
    if (text.includes('FROM job_titles')) {
      return Promise.resolve([{ id: 'j1', name: 'Role' }]);
    }
    return Promise.resolve([]);
  });
}

function ranInsert() {
  return sqlMock.mock.calls.some((c) => {
    const s = c[0];
    const text = Array.isArray(s) ? s.join(' ') : String(s);
    return text.includes('INSERT INTO scenarios');
  });
}

beforeEach(() => {
  requireAuthMock.mockReset();
  sqlMock.mockReset();
});

describe('POST /api/scenarios — tenant scope on jobTitleId', () => {
  it('400 when jobTitleId is missing (before any DB touch)', async () => {
    asAdmin('a');
    wire('a');
    const res = await POST(postReq({ name: 'x', type: 'CHAT' }));
    expect(res.status).toBe(400);
    expect(ranInsert()).toBe(false);
  });

  it('404 when the referenced job title does not exist', async () => {
    asAdmin('a');
    wire(undefined); // guard SELECT returns []
    const res = await POST(postReq());
    expect(res.status).toBe(404);
    expect(ranInsert()).toBe(false);
  });

  it('403 when the job title belongs to another tenant (no cross-tenant write)', async () => {
    asAdmin('a');
    wire('b'); // job owned by org B, caller in org A
    const res = await POST(postReq());
    expect(res.status).toBe(403);
    expect(ranInsert()).toBe(false);
  });

  it('201 when attaching to a GLOBAL (null-org) job title (legitimate authoring)', async () => {
    asAdmin('a');
    wire(null);
    const res = await POST(postReq());
    expect(res.status).toBe(201);
    expect(ranInsert()).toBe(true);
  });

  it('201 when attaching to the caller-owned job title', async () => {
    asAdmin('a');
    wire('a');
    const res = await POST(postReq());
    expect(res.status).toBe(201);
    expect(ranInsert()).toBe(true);
  });
});
