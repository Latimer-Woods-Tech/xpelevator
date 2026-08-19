/**
 * Seat metering — the automated "how many seats did this operator's book use?"
 * measurement that Phase 4 item 2 (wholesale seat billing, issue #16) invoices
 * on.
 *
 * The founder monetization (issue #16, 2026-07-08) is a B2B seat subscription:
 * one seat = one ACTIVE TRAINEE for one month, in three cumulative tiers
 * (chat → +voice → +phone). This module answers the metering question — *how
 * many seats, in which tier, per client org, for a billing window* — WITHOUT
 * ever touching price. Wholesale amounts are a founder input that lives in
 * Stripe (🔒 live-mode gate), so metering (this file) and pricing (Stripe) stay
 * cleanly separated: the number computed here is the invoice BASIS; the amount
 * is applied downstream once the founder sets it. Nothing here reads a secret,
 * a price, or the network.
 *
 * Definitions this module fixes (so billing is never ambiguous):
 *   - An ACTIVE TRAINEE (a billable seat) is a distinct trainee (`user_id`, the
 *     stable auth id sessions are keyed on — the same key the manager report and
 *     `canAccessSession` use) who COMPLETED at least one simulation session for
 *     that org inside the window. A trainee who only started (never completed) a
 *     session consumes no seat — the route filters `status = 'COMPLETED'`.
 *   - A trainee's BILLABLE TIER is the highest-rank modality they exercised in
 *     the window (phone > voice > chat), because the tiers are cumulative — a
 *     trainee who ran even one phone sim needed a phone seat. Mapped through the
 *     seat catalog (`minimumTierForModality`), so metering can never diverge from
 *     the published tiers.
 *   - Seats are counted PER ORG. The same person active in two client orgs
 *     beneath one operator is TWO seats (the operator holds a seat in each org),
 *     so a portfolio total is the SUM of per-org seats — the invoice basis — not
 *     a book-wide distinct headcount.
 *
 * Pure + dependency-free (only the pure `@/lib/plans` catalog): the route
 * supplies the DB usage rows, this aggregates + buckets, and the rules are
 * unit-tested without a DB.
 */
import {
  minimumTierForModality,
  SEAT_TIERS,
  type SeatTierId,
  type SimulationType,
} from './plans';

/**
 * One `(org, trainee, modality)` usage fact for the window — exactly the shape
 * the route's `GROUP BY o.id, o.name, ss.user_id, ss.type` yields.
 */
export interface SeatUsageFact {
  /** Owning org id; `null` for an org-less admin's personal workspace. */
  orgId: string | null;
  orgName: string | null;
  /** Stable per-trainee id (`simulation_sessions.user_id`, the auth id). */
  traineeKey: string;
  /** Raw `simulation_sessions.type`; validated to a SimulationType, else ignored. */
  modality: string;
  /** Completed sessions this trainee ran in this modality for this org (>= 1). */
  sessions: number;
}

/** Per-tier seat counts — one entry per catalog tier, `0` when none. */
export type SeatsByTier = Record<SeatTierId, number>;

/** Metered seat usage for a single org over the window. */
export interface OrgSeatUsage {
  orgId: string | null;
  orgName: string | null;
  /** Billable seats = distinct active (completed-session) trainees this window. */
  activeSeats: number;
  /** Completed sessions across all the org's trainees (activity signal, not billed). */
  sessions: number;
  /** Each active trainee bucketed into their billable tier; sums to `activeSeats`. */
  seatsByTier: SeatsByTier;
}

/** The full metering report: per-org rows + the summed invoice-basis totals. */
export interface SeatUsageReport {
  perOrg: OrgSeatUsage[];
  totals: {
    /** Sum of per-org billable seats — the operator invoice basis. */
    activeSeats: number;
    sessions: number;
    seatsByTier: SeatsByTier;
  };
}

/** Tier id → ordinal rank, from the catalog (chat=1, voice=2, phone=3). */
const RANK = new Map<SeatTierId, number>(SEAT_TIERS.map((t) => [t.id, t.rank]));

/** A fresh all-zero per-tier tally covering every catalog tier. */
function emptyTiers(): SeatsByTier {
  const out = {} as SeatsByTier;
  for (const t of SEAT_TIERS) out[t.id] = 0;
  return out;
}

/** True only for a persisted SimulationType (guards a garbage `type` string). */
function isSimulationType(v: string): v is SimulationType {
  return v === 'CHAT' || v === 'VOICE' || v === 'PHONE';
}

/** The higher-rank of two tiers — keeps a trainee at their top modality's tier. */
function higherTier(a: SeatTierId, b: SeatTierId): SeatTierId {
  return (RANK.get(a) ?? 0) >= (RANK.get(b) ?? 0) ? a : b;
}

/**
 * Aggregate raw `(org, trainee, modality)` usage facts into the per-org +
 * portfolio-total seat metering report — the invoice basis for Phase 4 item 2.
 *
 * Deterministic and order-independent: facts may arrive in any order and a
 * trainee may appear once per modality; each distinct trainee is counted as one
 * seat in the highest tier they exercised. A fact whose `modality` is not a
 * persisted SimulationType is ignored (it can neither add a seat nor a session),
 * so a future/garbage `type` value fails closed rather than mis-billing. Per-org
 * rows are returned most-seats-first (ties broken by name then id) for a stable,
 * human-readable order.
 */
export function computeSeatUsage(
  facts: readonly SeatUsageFact[]
): SeatUsageReport {
  // org key (null → '') → accumulator. Trainee → their current billable tier.
  const orgs = new Map<
    string,
    {
      orgId: string | null;
      orgName: string | null;
      sessions: number;
      traineeTier: Map<string, SeatTierId>;
    }
  >();

  for (const f of facts) {
    // Unknown modality contributes nothing — fail closed, never mis-bill.
    if (!isSimulationType(f.modality)) continue;
    const key = f.orgId ?? '';
    let org = orgs.get(key);
    if (!org) {
      org = {
        orgId: f.orgId,
        orgName: f.orgName,
        sessions: 0,
        traineeTier: new Map(),
      };
      orgs.set(key, org);
    }
    // Backfill a name if an earlier fact for this org lacked one.
    if (org.orgName == null && f.orgName != null) org.orgName = f.orgName;
    org.sessions += Math.max(0, f.sessions);
    const tier = minimumTierForModality(f.modality).id;
    const prev = org.traineeTier.get(f.traineeKey);
    org.traineeTier.set(f.traineeKey, prev ? higherTier(prev, tier) : tier);
  }

  const perOrg: OrgSeatUsage[] = [];
  const totalTiers = emptyTiers();
  let totalSeats = 0;
  let totalSessions = 0;

  for (const org of orgs.values()) {
    const seatsByTier = emptyTiers();
    for (const tier of org.traineeTier.values()) seatsByTier[tier] += 1;
    const activeSeats = org.traineeTier.size;
    perOrg.push({
      orgId: org.orgId,
      orgName: org.orgName,
      activeSeats,
      sessions: org.sessions,
      seatsByTier,
    });
    for (const t of SEAT_TIERS) totalTiers[t.id] += seatsByTier[t.id];
    totalSeats += activeSeats;
    totalSessions += org.sessions;
  }

  perOrg.sort(
    (a, b) =>
      b.activeSeats - a.activeSeats ||
      (a.orgName ?? '').localeCompare(b.orgName ?? '') ||
      (a.orgId ?? '').localeCompare(b.orgId ?? '')
  );

  return {
    perOrg,
    totals: {
      activeSeats: totalSeats,
      sessions: totalSessions,
      seatsByTier: totalTiers,
    },
  };
}
