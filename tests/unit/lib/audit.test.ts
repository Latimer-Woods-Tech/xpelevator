import { describe, it, expect, vi } from 'vitest';

// db.ts throws at module load without DATABASE_URL; these tests inject their own
// `sql` client via the deps arg, so the real default is never used.
vi.mock('@/lib/db', () => ({ sql: vi.fn() }));

import { recordAudit, type SqlClient } from '@/lib/audit';

// Unit test for the audit-log primitive (issue #157 §10). Focus:
//   1. a completed mutation writes ONE `INSERT INTO audit_log` with the actor,
//      action, target, tenant, and JSON-serialised metadata in the right slots;
//   2. `metadata` is stored as a JSON string (null when omitted);
//   3. optional actor/target fields collapse to SQL NULL;
//   4. FAIL OPEN — a throwing `sql` never propagates out of `recordAudit`
//      (an audit-write blip must not break a valid governance mutation).
// The per-route wiring (which action fires on which mutation, and that a no-op
// records nothing) is proven in the individual route tests.

/** Capture the tagged-template call recordAudit issues. */
function captureSql() {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const sql = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({
      text: (Array.isArray(strings) ? strings.join('?') : String(strings)).replace(/\s+/g, ' ').trim(),
      values,
    });
    return Promise.resolve([]);
  }) as unknown as SqlClient;
  return { sql, calls };
}

describe('recordAudit', () => {
  it('writes one audit_log row with actor / action / target / tenant / metadata', async () => {
    const { sql, calls } = captureSql();

    await recordAudit(
      {
        action: 'org.update',
        actorUserId: 'user-1',
        actorEmail: 'admin@example.com',
        orgId: 'org-1',
        targetType: 'organization',
        targetId: 'org-1',
        metadata: { changed: ['plan'], plan: 'ENTERPRISE' },
      },
      { sql },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain('INSERT INTO audit_log');
    // Value order matches the VALUES() slots (uuid + NOW() are literal SQL):
    // action, actorUserId, actorEmail, orgId, targetType, targetId, metadataJson
    expect(calls[0].values).toEqual([
      'org.update',
      'user-1',
      'admin@example.com',
      'org-1',
      'organization',
      'org-1',
      JSON.stringify({ changed: ['plan'], plan: 'ENTERPRISE' }),
    ]);
  });

  it('serialises metadata to JSON, and stores null when metadata is omitted', async () => {
    const { sql, calls } = captureSql();

    await recordAudit(
      { action: 'org.delete', actorUserId: 'u', actorEmail: 'e', orgId: 'o', targetType: 'organization', targetId: 'o' },
      { sql },
    );

    // last value is the metadata slot → null when not provided
    expect(calls[0].values[6]).toBeNull();
  });

  it('collapses omitted actor / target fields to null', async () => {
    const { sql, calls } = captureSql();

    await recordAudit({ action: 'pack.import' }, { sql });

    // action, then five nullable fields, then metadata-null
    expect(calls[0].values).toEqual(['pack.import', null, null, null, null, null, null]);
  });

  it('FAILS OPEN — a throwing sql client never propagates out of recordAudit', async () => {
    const sql = vi.fn(() => Promise.reject(new Error('db down'))) as unknown as SqlClient;
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Must resolve (not reject) despite the DB error.
    await expect(
      recordAudit({ action: 'member.add', orgId: 'org-1', targetId: 'u-1' }, { sql }),
    ).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
