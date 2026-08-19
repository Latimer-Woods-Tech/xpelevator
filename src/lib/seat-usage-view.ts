/**
 * Seat-usage VIEW helpers — the pure display transforms behind the operator
 * workspace's seat meter panel (issue #16, Phase 4 item 2).
 *
 * The metering itself (the invoice basis) is computed server-side by
 * `@/lib/seat-metering` and served by `GET /api/reports/seats`. This module is
 * the thin, DB-free, network-free presentation layer the operator page uses to
 * turn that JSON into stable, catalog-ordered display rows — so the panel never
 * re-encodes the tier order or the zero-fill, and the rules are unit-tested
 * without React or a DB. Like the meter, it carries NO price (wholesale amounts
 * live in Stripe, 🔒 live-mode gate); it only presents the seat *counts* an
 * operator will be invoiced on.
 */
import { SEAT_TIERS, type SeatTierId } from './plans';

/** The seat-metering JSON shape returned by `GET /api/reports/seats`. */
export interface SeatUsageApiRow {
  orgId: string | null;
  orgName: string | null;
  activeSeats: number;
  sessions: number;
  seatsByTier: Partial<Record<string, number>>;
}

/** The full `GET /api/reports/seats` payload (per-org rows + summed totals). */
export interface SeatUsageApiResponse {
  window: { since: string | null; until: string | null };
  unit: string;
  interval: string;
  perOrg: SeatUsageApiRow[];
  totals: {
    activeSeats: number;
    sessions: number;
    seatsByTier: Partial<Record<string, number>>;
  };
  truncated: boolean;
}

/** One catalog tier's seat count, ready to render. */
export interface SeatTierLine {
  id: SeatTierId;
  name: string;
  seats: number;
}

/**
 * A non-negative integer seat count from an untrusted record value — a missing,
 * `null`, negative, fractional, or non-numeric entry all collapse to a safe
 * count (`0` for junk, truncated-and-floored for a real number). Metering never
 * mis-reports a seat *up*; a garbage value can only read as fewer seats.
 */
function safeCount(value: unknown): number {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Turn a raw `seatsByTier` record into the full catalog's per-tier lines, in
 * canonical rank order (Chat → Voice → Phone), zero-filling any tier the record
 * omits and ignoring any key that is not a catalog tier. The panel renders this
 * verbatim, so the tier order and the labels come from the catalog alone — never
 * from whatever order the API happened to serialize.
 */
export function tierLines(
  seatsByTier: Partial<Record<string, number>> | null | undefined
): SeatTierLine[] {
  return SEAT_TIERS.map((t) => ({
    id: t.id,
    name: t.name,
    seats: safeCount(seatsByTier?.[t.id]),
  }));
}

/**
 * Whether a seat-usage report has any billable seats at all. Drives the panel's
 * empty state ("no metered usage yet") vs. the meter table. Reads the summed
 * totals, so it is true iff at least one client org had one active trainee in
 * the window.
 */
export function hasSeatUsage(
  report: Pick<SeatUsageApiResponse, 'totals'> | null | undefined
): boolean {
  return safeCount(report?.totals?.activeSeats) > 0;
}

/** An org's display name, never blank (a null/empty name → a stable fallback). */
export function orgDisplayName(row: Pick<SeatUsageApiRow, 'orgName'>): string {
  const name = row.orgName?.trim();
  return name && name.length > 0 ? name : 'Unnamed workspace';
}
