/**
 * Direct unit tests for the DB-touching governance-target lookup
 * (src/lib/org-guard.ts → `getOrgGovernanceTarget`).
 *
 * Why a DIRECT test when the `/api/orgs/*` route tests already drive this
 * function through the real wiring (tests/unit/api/orgs.test.ts mocks `sql` and
 * imports the REAL `org-guard`): this mirrors the dual pattern the repo already
 * uses for the pure predicates in `org-hierarchy.ts` — exercised both directly
 * (tests/unit/lib/org-hierarchy.test.ts) AND through the route wiring. The
 * function's OWN contract is security-loaded and deserves its own regression
 * pin, independent of any route:
 *
 *  - A missing org returns `null` — callers map that to a 404. If this ever
 *    silently returned an empty-but-truthy target, `canAccessOrg` would run
 *    against a phantom org (`parentOrgId` undefined) instead of short-circuiting.
 *  - `parentOrgId` drives the operator→client reach in `canAccessOrg`, so the
 *    NULL-parent (top-level/standalone org) vs present-parent (owned CLIENT)
 *    distinction is the whole tenant-isolation hinge. The `?? null` coalesce
 *    normalizes a SQL `NULL` (surfaced as `null`/`undefined` by the driver) to a
 *    strict `null` so the predicate never sees `undefined`.
 *  - The org id is interpolated as a tagged-template VALUE (`WHERE id = ${id}`),
 *    i.e. a parameterized query, never string-concatenated SQL — pinned here so a
 *    future refactor can't regress it into an injection surface.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }));

// Mock the Neon HTTP client the same way the route tests do — `sql` is a
// tagged-template function, so the mock is called with (TemplateStringsArray,
// ...interpolated values) and must resolve to the rows array.
vi.mock('@/lib/db', () => ({ sql: sqlMock, default: sqlMock }));

// REAL function under test — reads the mocked `sql`.
import { getOrgGovernanceTarget } from '@/lib/org-guard';

beforeEach(() => {
  sqlMock.mockReset();
});

describe('getOrgGovernanceTarget', () => {
  it('returns null when the org does not exist (callers map to 404)', async () => {
    sqlMock.mockResolvedValue([]);
    expect(await getOrgGovernanceTarget('missing')).toBeNull();
  });

  it('maps a CLIENT org to { id, parentOrgId } with its operator parent', async () => {
    sqlMock.mockResolvedValue([{ id: 'client1', parentOrgId: 'operator1' }]);
    expect(await getOrgGovernanceTarget('client1')).toEqual({
      id: 'client1',
      parentOrgId: 'operator1',
    });
  });

  it('coerces a NULL parent (top-level/standalone org) to a strict null', async () => {
    sqlMock.mockResolvedValue([{ id: 'top', parentOrgId: null }]);
    const target = await getOrgGovernanceTarget('top');
    expect(target).toEqual({ id: 'top', parentOrgId: null });
    expect(target?.parentOrgId).toBeNull();
  });

  it('coerces an absent parentOrgId field (driver-dropped NULL) to null via ?? ', async () => {
    // The Neon HTTP driver can surface a SQL NULL as an absent key rather than an
    // explicit `null`; the `?? null` coalesce must normalize either form so
    // `canAccessOrg` never receives `undefined`.
    sqlMock.mockResolvedValue([{ id: 'top' }]);
    const target = await getOrgGovernanceTarget('top');
    expect(target).toEqual({ id: 'top', parentOrgId: null });
    expect(target?.parentOrgId).toBeNull();
  });

  it('passes the id as a parameterized tagged-template VALUE, not concatenated SQL', async () => {
    sqlMock.mockResolvedValue([{ id: 'abc', parentOrgId: null }]);
    await getOrgGovernanceTarget('abc');

    expect(sqlMock).toHaveBeenCalledTimes(1);
    const [strings, ...values] = sqlMock.mock.calls[0];
    // Tagged-template invocation: first arg is the static string array, the id
    // arrives as an interpolated value (parameterized), never spliced into SQL.
    expect(Array.isArray(strings)).toBe(true);
    expect((strings as unknown as { raw: unknown }).raw).toBeDefined();
    expect(values).toEqual(['abc']);
    // The static SQL fragments must not contain the id — proving no concatenation.
    expect((strings as unknown as string[]).join('')).not.toContain('abc');
  });

  it('reads only the first row when the lookup is unexpectedly non-unique', async () => {
    // `id` is the PK so this is defensive, but the function indexes rows[0] — pin
    // that it does not merge or error on multiple rows.
    sqlMock.mockResolvedValue([
      { id: 'first', parentOrgId: 'p1' },
      { id: 'second', parentOrgId: 'p2' },
    ]);
    expect(await getOrgGovernanceTarget('first')).toEqual({
      id: 'first',
      parentOrgId: 'p1',
    });
  });
});
