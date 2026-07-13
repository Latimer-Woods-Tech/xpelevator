import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unit test for GET /api/scenario-packs/status with DB + auth mocked — proves the
// admin-only gate, tenant scoping (no-org 400), and that the per-pack status is
// derived from the org's stored provenance rows (not_imported / up_to_date /
// upgrade_available) without a live Neon binding. The pure status logic it drives
// (computePackStatus) is covered in tests/unit/lib/scenario-packs.test.ts.

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

import { GET } from '@/app/api/scenario-packs/status/route';
import { AuthError } from '@/lib/auth-api';
import { SCENARIO_PACKS, PACK_CATALOG_VERSION } from '@/lib/scenario-packs';

const PACK = SCENARIO_PACKS[0];
const KEYS = PACK.scenarios.map((s) => s.key);

function req(): Request {
  return new Request('http://localhost/api/scenario-packs/status');
}

function asAdmin(orgId: string | null = 'org-1') {
  requireAuthMock.mockResolvedValue({
    session: { user: { id: 'u1', role: 'ADMIN', orgId } },
  });
}

/** Stub the single provenance read with the given stored rows. */
function storedRows(rows: Array<{ sourcePackId: string; sourceScenarioKey: string; packVersion: number | null }>) {
  sqlMock.mockResolvedValue(rows);
}

beforeEach(() => {
  requireAuthMock.mockReset();
  sqlMock.mockReset();
});

describe('GET /api/scenario-packs/status — auth gate', () => {
  it('anon caller → 401 (never touches the DB)', async () => {
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

  it('admin with no org → 400 (status is tenant-scoped)', async () => {
    asAdmin(null);
    const res = await GET(req());
    expect(res.status).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('gates ADMIN specifically — requireAuth is asked for the ADMIN role', async () => {
    asAdmin();
    storedRows([]);
    await GET(req());
    expect(requireAuthMock).toHaveBeenCalledWith(expect.anything(), 'ADMIN');
  });
});

describe('GET /api/scenario-packs/status — per-pack status', () => {
  it('empty workspace → every catalog pack is not_imported', async () => {
    asAdmin();
    storedRows([]);
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.catalogVersion).toBe(PACK_CATALOG_VERSION);
    expect(body.packs).toHaveLength(SCENARIO_PACKS.length);
    expect(body.packs.every((p: { state: string }) => p.state === 'not_imported')).toBe(true);
  });

  it('rows at the current version → that pack is up_to_date', async () => {
    asAdmin();
    storedRows(KEYS.map((k) => ({ sourcePackId: PACK.id, sourceScenarioKey: k, packVersion: PACK_CATALOG_VERSION })));
    const res = await GET(req());
    const body = await res.json();
    const status = body.packs.find((p: { packId: string }) => p.packId === PACK.id);
    expect(status.state).toBe('up_to_date');
    expect(status.importedScenarioCount).toBe(KEYS.length);
  });

  it('stale rows → that pack is upgrade_available with drift counts', async () => {
    asAdmin();
    storedRows(KEYS.map((k) => ({ sourcePackId: PACK.id, sourceScenarioKey: k, packVersion: PACK_CATALOG_VERSION - 1 })));
    const res = await GET(req());
    const body = await res.json();
    const status = body.packs.find((p: { packId: string }) => p.packId === PACK.id);
    expect(status.state).toBe('upgrade_available');
    expect(status.drift.update).toBe(KEYS.length);
  });

  it('the status payload never leaks a scenario script (hidden mechanics)', async () => {
    asAdmin();
    storedRows(KEYS.map((k) => ({ sourcePackId: PACK.id, sourceScenarioKey: k, packVersion: null })));
    const res = await GET(req());
    const text = JSON.stringify(await res.json());
    expect(text).not.toMatch(/customerPersona|customerObjective|"hints"|"script"/);
  });

  it('DB error → 500', async () => {
    asAdmin();
    sqlMock.mockRejectedValue(new Error('neon down'));
    const res = await GET(req());
    expect(res.status).toBe(500);
  });
});
