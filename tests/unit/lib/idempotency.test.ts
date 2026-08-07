/**
 * Deterministic tests for the webhook event-ID idempotency guard.
 *
 * The phone modality's control loop returns 200 up-front and processes in the
 * background, so an at-least-once retry of a Telnyx event re-runs the whole
 * handler unless the event id is claimed exactly once. These tests lock the
 * contract in — including the PROOF-OF-REJECTION the Standing Laws require: a
 * duplicate event id must SKIP the handler.
 *
 * No live Neon: an injected tagged-template `sql` stub stands in for the claim
 * round-trip (returning a row = first-seen, empty = already claimed, throwing =
 * a DB blip).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

// db.ts throws at module load without DATABASE_URL; these tests inject their own
// fake sql, so the real client is never used — stub the module so the import of
// idempotency.ts (which imports the default sql) doesn't trip that guard.
vi.mock('@/lib/db', () => ({ sql: vi.fn() }));

import { claimEvent, withIdempotency, type SqlClient } from '@/lib/idempotency';

/**
 * A neon-style tagged-template stub. `rows` is what the INSERT ... RETURNING
 * resolves to: `[{ event_id }]` = the claim took (first-seen), `[]` = the id
 * already existed (duplicate). Records each call so a test can assert the id it
 * wrote.
 */
function fakeSql(rows: Array<Record<string, unknown>>): { sql: SqlClient; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const sql: SqlClient = (_strings, ...vals) => {
    calls.push(vals);
    return Promise.resolve(rows);
  };
  return { sql, calls };
}

function throwingSql(err: Error): SqlClient {
  return () => Promise.reject(err);
}

afterEach(() => vi.restoreAllMocks());

describe('claimEvent', () => {
  it('returns true when the insert takes (first delivery)', async () => {
    const { sql, calls } = fakeSql([{ event_id: 'evt_1' }]);
    await expect(claimEvent('evt_1', sql)).resolves.toBe(true);
    // The event id was bound into the query.
    expect(calls[0]).toContain('evt_1');
  });

  it('returns false when the id already exists (ON CONFLICT DO NOTHING → no row)', async () => {
    const { sql } = fakeSql([]);
    await expect(claimEvent('evt_1', sql)).resolves.toBe(false);
  });
});

describe('withIdempotency', () => {
  it('runs the handler on the first delivery of an event', async () => {
    const { sql } = fakeSql([{ event_id: 'evt_1' }]);
    const handler = vi.fn().mockResolvedValue(undefined);
    await withIdempotency('evt_1', handler, { sql });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('PROOF-OF-REJECTION: SKIPS the handler on a duplicate event id', async () => {
    // The claim insert returns no row → the id was already claimed by a prior
    // delivery → the handler must NOT run again (no racing gather/speak, no
    // doubled turn, no second score).
    const { sql } = fakeSql([]);
    const handler = vi.fn().mockResolvedValue(undefined);
    await withIdempotency('evt_dup', handler, { sql });
    expect(handler).not.toHaveBeenCalled();
  });

  it('claims exactly once across a first + retry pair (single shared counter)', async () => {
    // First call sees a row, second call (same id) sees none — the real
    // ON CONFLICT behaviour. Only the first should execute the handler.
    const seen = new Set<string>();
    const sql: SqlClient = (_s, ...vals) => {
      const id = vals[0] as string;
      if (seen.has(id)) return Promise.resolve([]); // duplicate
      seen.add(id);
      return Promise.resolve([{ event_id: id }]); // first
    };
    const handler = vi.fn().mockResolvedValue(undefined);
    await withIdempotency('evt_x', handler, { sql });
    await withIdempotency('evt_x', handler, { sql });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('fails OPEN: runs the handler when the claim write throws (a DB blip)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = vi.fn().mockResolvedValue(undefined);
    await withIdempotency('evt_1', handler, { sql: throwingSql(new Error('neon down')) });
    // A dropped live-call event is worse than a rare double-process → process.
    expect(handler).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalled();
  });

  it('runs the handler when there is no event id to dedupe on (undefined)', async () => {
    const { sql, calls } = fakeSql([{ event_id: 'unused' }]);
    const handler = vi.fn().mockResolvedValue(undefined);
    await withIdempotency(undefined, handler, { sql });
    expect(handler).toHaveBeenCalledTimes(1);
    // No id → no claim round-trip at all.
    expect(calls).toHaveLength(0);
  });

  it('runs the handler when the event id is an empty string', async () => {
    const { sql, calls } = fakeSql([]);
    const handler = vi.fn().mockResolvedValue(undefined);
    await withIdempotency('', handler, { sql });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
  });

  it('propagates an error thrown by the handler itself (guard governs only whether it runs)', async () => {
    const { sql } = fakeSql([{ event_id: 'evt_1' }]);
    const handler = vi.fn().mockRejectedValue(new Error('handler boom'));
    await expect(withIdempotency('evt_1', handler, { sql })).rejects.toThrow('handler boom');
  });
});
