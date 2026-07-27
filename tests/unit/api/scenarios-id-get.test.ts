/**
 * Deterministic tests for GET /api/scenarios/[id] plus the auth/500 boundaries
 * on PUT/DELETE. Complements `scenarios-id.test.ts` (PUT/DELETE global-catalog
 * protection) so the whole [id] route clears the CI branch floor (P2-7).
 *
 * GET is the single-scenario hidden-mechanic + tenant boundary:
 *   - not found                       -> 404
 *   - owned by another org            -> 403 (no body leaked)
 *   - non-admin own-org read          -> 200, script stripped to ttsVoiceName
 *   - admin own-org read              -> 200, full script
 *   - global (null-org) read          -> 200 (visible to any authed caller)
 *   - anon                            -> 401
 *   - unexpected DB failure           -> 500
 *
 * requireAuth/sql are mocked; the real pure sanitizeScenarioScript runs.
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

import { GET, PUT, DELETE } from '@/app/api/scenarios/[id]/route';

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const getReq = () => new Request('http://localhost/api/scenarios/s1');
const delReq = () => new Request('http://localhost/api/scenarios/s1', { method: 'DELETE' });
function putReq(body: unknown = { name: 'x', type: 'CHAT' }) {
  return new Request('http://localhost/api/scenarios/s1', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const HIDDEN_SCRIPT = {
  customerPersona: 'Furious enterprise buyer',
  customerObjective: 'demand a full refund',
  hints: ['open hostile'],
  ttsVoiceName: 'Rachel',
};

function asRole(role: 'ADMIN' | 'MEMBER', orgId: string | null) {
  requireAuthMock.mockResolvedValue({ session: { user: { id: 'u', role, orgId } } });
}

/** GET SELECT resolves to a scenario owned by `orgId` (or []) carrying the hidden script. */
function ownedByOrg(orgId: string | null | undefined) {
  sqlMock.mockImplementation((strings?: TemplateStringsArray) => {
    const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
    if (text.includes('FROM scenarios s')) {
      return Promise.resolve(
        orgId === undefined
          ? []
          : [{ id: 's1', name: 'S', type: 'CHAT', script: { ...HIDDEN_SCRIPT }, jobTitleId: 'j1', orgId, jobTitle: { id: 'j1', name: 'J' } }]
      );
    }
    return Promise.resolve([]);
  });
}

function ranWrite(kind: 'UPDATE scenarios' | 'DELETE FROM scenarios') {
  return sqlMock.mock.calls.some((c) =>
    (Array.isArray(c[0]) ? c[0].join(' ') : '').includes(kind)
  );
}

beforeEach(() => {
  requireAuthMock.mockReset();
  sqlMock.mockReset();
});

describe('GET /api/scenarios/[id]', () => {
  it('404 when the scenario does not exist', async () => {
    asRole('MEMBER', 'orgA');
    ownedByOrg(undefined);
    const res = await GET(getReq(), params('nope'));
    expect(res.status).toBe(404);
  });

  it('403 when the scenario belongs to another org (no leak)', async () => {
    asRole('MEMBER', 'orgA');
    ownedByOrg('orgB');
    const res = await GET(getReq(), params('s1'));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Access denied' });
  });

  it('non-admin own-org read → 200 with script stripped to ttsVoiceName', async () => {
    asRole('MEMBER', 'orgA');
    ownedByOrg('orgA');
    const res = await GET(getReq(), params('s1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.script).toEqual({ ttsVoiceName: 'Rachel' });
    expect(body.script.hints).toBeUndefined();
  });

  it('admin own-org read → 200 with the full script', async () => {
    asRole('ADMIN', 'orgA');
    ownedByOrg('orgA');
    const res = await GET(getReq(), params('s1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.script).toEqual(HIDDEN_SCRIPT);
  });

  it('global (null-org) scenario is readable by any authed caller', async () => {
    asRole('MEMBER', 'orgA');
    ownedByOrg(null);
    const res = await GET(getReq(), params('s1'));
    expect(res.status).toBe(200);
  });

  it('anonymous caller → 401 (AuthError re-mapped)', async () => {
    requireAuthMock.mockRejectedValue(new FakeAuthError('Unauthorized', 401));
    const res = await GET(getReq(), params('s1'));
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('unexpected DB failure → 500', async () => {
    asRole('MEMBER', 'orgA');
    sqlMock.mockRejectedValue(new Error('connection reset'));
    const res = await GET(getReq(), params('s1'));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to fetch scenario' });
  });
});

describe('PUT /api/scenarios/[id] — auth + error boundaries', () => {
  it('anon/non-admin → 401 (AuthError re-mapped), no UPDATE', async () => {
    requireAuthMock.mockRejectedValue(new FakeAuthError('Unauthorized', 401));
    const res = await PUT(putReq(), params('s1'));
    expect(res.status).toBe(401);
    expect(ranWrite('UPDATE scenarios')).toBe(false);
  });

  it('unexpected DB failure after auth → 500', async () => {
    asRole('ADMIN', 'orgA');
    sqlMock.mockRejectedValue(new Error('boom'));
    const res = await PUT(putReq(), params('s1'));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to update scenario' });
  });
});

describe('DELETE /api/scenarios/[id] — auth + error boundaries', () => {
  it('anon/non-admin → 401 (AuthError re-mapped), no DELETE', async () => {
    requireAuthMock.mockRejectedValue(new FakeAuthError('Unauthorized', 401));
    const res = await DELETE(delReq(), params('s1'));
    expect(res.status).toBe(401);
    expect(ranWrite('DELETE FROM scenarios')).toBe(false);
  });

  it('unexpected DB failure after auth → 500', async () => {
    asRole('ADMIN', 'orgA');
    sqlMock.mockRejectedValue(new Error('boom'));
    const res = await DELETE(delReq(), params('s1'));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to delete scenario' });
  });
});
