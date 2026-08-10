/**
 * Deterministic tests for POST /api/scenarios/[id]/duplicate.
 *
 * The duplicate action clones a scenario the caller can SEE into a fresh,
 * hand-authored scenario owned by the caller's own org (the operator inventory
 * lever, #16 Phase 4 / P3a-8). This suite is the proof-of-rejection (Standing
 * Law 1) for its guards plus the copy invariants:
 *   - anon / non-admin                    -> AuthError status, no INSERT
 *   - source scenario not found           -> 404, no INSERT
 *   - source owned by another tenant      -> 403, no INSERT (cross-tenant read)
 *   - global (null-org) source            -> 201, INSERT lands in caller's org
 *   - own-org source                       -> 201
 *   - the INSERT never carries pack provenance (a copy is hand-authored)
 *   - the new name is suffixed "(copy)"
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

import { POST } from '@/app/api/scenarios/[id]/duplicate/route';

function dupReq(id = 's-src') {
  return new Request(`http://localhost/api/scenarios/${id}/duplicate`, { method: 'POST' });
}

function asAdmin(orgId: string | null) {
  requireAuthMock.mockResolvedValue({ session: { user: { id: 'a', role: 'ADMIN', orgId } } });
}

/**
 * Wire the sql mock. `sourceOrg === undefined` → the source SELECT returns no
 * rows (not found). Otherwise the source row is owned by `sourceOrg`. The INSERT
 * and the trailing job-title read resolve to plausible rows so a permitted
 * request reaches 201.
 */
function wire(sourceOrg?: string | null) {
  sqlMock.mockImplementation((strings?: TemplateStringsArray) => {
    const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
    if (text.includes('FROM scenarios') && text.includes('WHERE id')) {
      return Promise.resolve(
        sourceOrg === undefined
          ? []
          : [
              {
                orgId: sourceOrg,
                jobTitleId: 'j1',
                name: 'Angry Customer',
                description: 'desc',
                type: 'CHAT',
                script: { customerPersona: 'p', customerObjective: 'o', hints: ['h'] },
              },
            ]
      );
    }
    if (text.includes('INSERT INTO scenarios')) {
      return Promise.resolve([{ id: 's-new', jobTitleId: 'j1', name: 'Angry Customer (copy)', orgId: 'a' }]);
    }
    if (text.includes('FROM job_titles')) {
      return Promise.resolve([{ id: 'j1', name: 'Role' }]);
    }
    return Promise.resolve([]);
  });
}

function insertCall() {
  return sqlMock.mock.calls.find((c) => {
    const s = c[0];
    const text = Array.isArray(s) ? s.join(' ') : String(s);
    return text.includes('INSERT INTO scenarios');
  });
}
const ranInsert = () => insertCall() !== undefined;

beforeEach(() => {
  requireAuthMock.mockReset();
  sqlMock.mockReset();
});

describe('POST /api/scenarios/[id]/duplicate', () => {
  it('propagates the auth rejection (e.g. 401 anon / 403 non-admin), no INSERT', async () => {
    requireAuthMock.mockRejectedValue(new FakeAuthError('Unauthorized', 401));
    wire('a');
    const res = await POST(dupReq(), { params: Promise.resolve({ id: 's-src' }) });
    expect(res.status).toBe(401);
    expect(ranInsert()).toBe(false);
  });

  it('404 when the source scenario does not exist, no INSERT', async () => {
    asAdmin('a');
    wire(undefined);
    const res = await POST(dupReq(), { params: Promise.resolve({ id: 'nope' }) });
    expect(res.status).toBe(404);
    expect(ranInsert()).toBe(false);
  });

  it('403 when the source belongs to another tenant (no cross-tenant clone)', async () => {
    asAdmin('a');
    wire('b'); // source owned by org B, caller in org A
    const res = await POST(dupReq(), { params: Promise.resolve({ id: 's-src' }) });
    expect(res.status).toBe(403);
    expect(ranInsert()).toBe(false);
  });

  it('201 cloning a GLOBAL (null-org) scenario into the caller org', async () => {
    asAdmin('a');
    wire(null);
    const res = await POST(dupReq(), { params: Promise.resolve({ id: 's-src' }) });
    expect(res.status).toBe(201);
    expect(ranInsert()).toBe(true);
  });

  it('201 cloning the caller-owned scenario', async () => {
    asAdmin('a');
    wire('a');
    const res = await POST(dupReq(), { params: Promise.resolve({ id: 's-src' }) });
    expect(res.status).toBe(201);
    expect(ranInsert()).toBe(true);
  });

  it('the copy is hand-authored: the INSERT column list carries NO pack provenance', async () => {
    asAdmin('a');
    wire('a');
    await POST(dupReq(), { params: Promise.resolve({ id: 's-src' }) });
    const call = insertCall();
    expect(call).toBeDefined();
    const text = (Array.isArray(call![0]) ? call![0].join(' ') : String(call![0]));
    expect(text).not.toContain('source_pack_id');
    expect(text).not.toContain('source_scenario_key');
    expect(text).not.toContain('pack_version');
  });

  it('names the copy with a "(copy)" suffix and scopes it to the caller org', async () => {
    asAdmin('a');
    wire('a');
    await POST(dupReq(), { params: Promise.resolve({ id: 's-src' }) });
    const call = insertCall();
    // Bound params follow the template strings in the tagged-template call.
    const params = call!.slice(1);
    expect(params).toContain('Angry Customer (copy)');
    expect(params).toContain('a'); // org_id = caller's org
  });
});
