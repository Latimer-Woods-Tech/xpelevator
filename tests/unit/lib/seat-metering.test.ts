import { describe, it, expect } from 'vitest';
import {
  computeSeatUsage,
  type SeatUsageFact,
} from '@/lib/seat-metering';
import { SEAT_TIERS } from '@/lib/plans';

/**
 * Proof-of-rejection (Standing Law 1) for the Phase 4 item 2 seat-metering
 * invoice basis. Each case makes a specific billing rule FAIL if the aggregation
 * regresses — a distinct-trainee seat that double-counts, a tier that ignores
 * the highest modality, a per-org seat that leaks across orgs, or a garbage
 * modality that adds a phantom seat, would each flip one of these red.
 */

const f = (over: Partial<SeatUsageFact>): SeatUsageFact => ({
  orgId: 'org-1',
  orgName: 'Acme',
  traineeKey: 't1',
  modality: 'CHAT',
  sessions: 1,
  ...over,
});

describe('computeSeatUsage', () => {
  it('counts one seat per distinct trainee, deduped across modalities', () => {
    // Same trainee, three modality rows → still ONE seat (not three).
    const report = computeSeatUsage([
      f({ traineeKey: 't1', modality: 'CHAT', sessions: 2 }),
      f({ traineeKey: 't1', modality: 'VOICE', sessions: 1 }),
      f({ traineeKey: 't1', modality: 'PHONE', sessions: 1 }),
    ]);
    expect(report.perOrg).toHaveLength(1);
    expect(report.perOrg[0].activeSeats).toBe(1);
    // Sessions are a raw activity sum (2+1+1), not the billed number.
    expect(report.perOrg[0].sessions).toBe(4);
    expect(report.totals.activeSeats).toBe(1);
  });

  it('bills a trainee at the HIGHEST modality tier they exercised', () => {
    // A trainee who did any phone sim occupies a phone seat, regardless of how
    // many chat/voice sims they also ran.
    const report = computeSeatUsage([
      f({ traineeKey: 't1', modality: 'CHAT' }),
      f({ traineeKey: 't1', modality: 'PHONE' }),
    ]);
    expect(report.perOrg[0].seatsByTier).toEqual({ chat: 0, voice: 0, phone: 1 });
  });

  it('order of facts does not change the billable tier', () => {
    const forward = computeSeatUsage([
      f({ traineeKey: 't1', modality: 'CHAT' }),
      f({ traineeKey: 't1', modality: 'VOICE' }),
    ]);
    const reverse = computeSeatUsage([
      f({ traineeKey: 't1', modality: 'VOICE' }),
      f({ traineeKey: 't1', modality: 'CHAT' }),
    ]);
    expect(forward.perOrg[0].seatsByTier).toEqual({ chat: 0, voice: 1, phone: 0 });
    expect(reverse.perOrg[0].seatsByTier).toEqual(forward.perOrg[0].seatsByTier);
  });

  it('counts seats PER ORG — the same trainee in two orgs is two seats', () => {
    const report = computeSeatUsage([
      f({ orgId: 'org-1', orgName: 'Acme', traineeKey: 'shared', modality: 'CHAT' }),
      f({ orgId: 'org-2', orgName: 'Beta', traineeKey: 'shared', modality: 'VOICE' }),
    ]);
    expect(report.perOrg).toHaveLength(2);
    // Portfolio total is the SUM of per-org seats (the invoice basis), NOT a
    // book-wide distinct headcount (which would be 1).
    expect(report.totals.activeSeats).toBe(2);
    expect(report.totals.seatsByTier).toEqual({ chat: 1, voice: 1, phone: 0 });
  });

  it('ignores an unknown modality — a garbage type adds no seat (fails closed)', () => {
    const report = computeSeatUsage([
      f({ traineeKey: 't1', modality: 'CHAT' }),
      f({ traineeKey: 'ghost', modality: 'TELEPATHY', sessions: 5 }),
    ]);
    expect(report.totals.activeSeats).toBe(1);
    expect(report.totals.sessions).toBe(1); // the 5 phantom sessions excluded
    expect(report.perOrg[0].seatsByTier).toEqual({ chat: 1, voice: 0, phone: 0 });
  });

  it('per-org seatsByTier always sums to that org activeSeats', () => {
    const report = computeSeatUsage([
      f({ traineeKey: 'a', modality: 'CHAT' }),
      f({ traineeKey: 'b', modality: 'VOICE' }),
      f({ traineeKey: 'c', modality: 'PHONE' }),
      f({ traineeKey: 'd', modality: 'PHONE' }),
    ]);
    const org = report.perOrg[0];
    const tierSum = SEAT_TIERS.reduce((n, t) => n + org.seatsByTier[t.id], 0);
    expect(tierSum).toBe(org.activeSeats);
    expect(org.activeSeats).toBe(4);
    expect(org.seatsByTier).toEqual({ chat: 1, voice: 1, phone: 2 });
  });

  it('orders per-org rows most-seats-first for a stable read', () => {
    const report = computeSeatUsage([
      f({ orgId: 'small', orgName: 'Small', traineeKey: 's1', modality: 'CHAT' }),
      f({ orgId: 'big', orgName: 'Big', traineeKey: 'b1', modality: 'CHAT' }),
      f({ orgId: 'big', orgName: 'Big', traineeKey: 'b2', modality: 'CHAT' }),
    ]);
    expect(report.perOrg.map((o) => o.orgId)).toEqual(['big', 'small']);
  });

  it('handles a null-org (personal workspace) bucket', () => {
    const report = computeSeatUsage([
      f({ orgId: null, orgName: null, traineeKey: 't1', modality: 'CHAT' }),
    ]);
    expect(report.perOrg[0].orgId).toBeNull();
    expect(report.totals.activeSeats).toBe(1);
  });

  it('returns zeroed totals for no usage', () => {
    const report = computeSeatUsage([]);
    expect(report.perOrg).toEqual([]);
    expect(report.totals).toEqual({
      activeSeats: 0,
      sessions: 0,
      seatsByTier: { chat: 0, voice: 0, phone: 0 },
    });
  });
});
