/**
 * Pure `?since` / `?until` date-window filter for the manager reporting export
 * (R-065, `GET /api/reports/sessions`).
 *
 * Operators asked for a "monthly cut" of the portfolio/per-client report — a
 * bounded slice of sessions rather than all-time. Both bounds are inclusive
 * calendar dates in `YYYY-MM-DD` (UTC) and filter on a session's completion
 * date (`ended_at`, the same column the report orders by):
 *   - `since` → sessions completed on or after that day (`>= since 00:00:00Z`);
 *   - `until` → sessions completed on or before the END of that day. It is
 *     returned as an EXCLUSIVE upper bound (`untilExclusive` = the following day
 *     at 00:00:00Z) so the whole `until` day is included regardless of the
 *     session's time-of-day, expressed with a `< untilExclusive` SQL comparison.
 *
 * Kept dependency-free (no DB, no request) so the route stays a thin auth +
 * query shell and the parse/validate rules are unit-tested in isolation. A
 * malformed date, or a window whose `since` falls after its `until`, is a 400 —
 * the caller maps `ok: false` to that status.
 */

/** A validated, SQL-ready date window (any bound may be absent). */
export interface ReportWindow {
  ok: true;
  /** Inclusive lower bound `YYYY-MM-DD`, or `null` when `?since` is absent. */
  since: string | null;
  /** The inclusive day the caller asked for `YYYY-MM-DD`, or `null`. */
  until: string | null;
  /**
   * The EXCLUSIVE upper bound for SQL (`ended_at < untilExclusive`) — the day
   * after {@link until} at 00:00:00Z, so the whole `until` day is covered. `null`
   * when `?until` is absent.
   */
  untilExclusive: string | null;
}

/** A rejected window — the caller returns HTTP 400 with `error`. */
export interface ReportWindowError {
  ok: false;
  error: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True only for a real calendar date in `YYYY-MM-DD` (rejects `2026-13-40`). */
function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const dt = new Date(`${value}T00:00:00.000Z`);
  // Round-trip guards against overflow dates the regex alone would admit
  // (JS `Date` rolls `2026-02-30` forward to March, which would not match).
  return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === value;
}

/** The day after `date` (`YYYY-MM-DD`) at 00:00Z — the exclusive `until` bound. */
function nextDay(date: string): string {
  const dt = new Date(`${date}T00:00:00.000Z`);
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

/**
 * Parse + validate the `?since` / `?until` window off the report query string.
 * Empty/absent params yield `null` bounds (all-time, unchanged behaviour). Both
 * bounds validate as real `YYYY-MM-DD` dates and `since` must not fall after
 * `until`; either failure is a 400 via `{ ok: false, error }`.
 */
export function parseReportWindow(
  params: URLSearchParams
): ReportWindow | ReportWindowError {
  const rawSince = params.get('since');
  const rawUntil = params.get('until');

  const since = rawSince && rawSince.length > 0 ? rawSince : null;
  const until = rawUntil && rawUntil.length > 0 ? rawUntil : null;

  if (since !== null && !isValidIsoDate(since)) {
    return {
      ok: false,
      error: 'since must be a calendar date in YYYY-MM-DD form',
    };
  }
  if (until !== null && !isValidIsoDate(until)) {
    return {
      ok: false,
      error: 'until must be a calendar date in YYYY-MM-DD form',
    };
  }
  // Lexicographic comparison is correct for zero-padded YYYY-MM-DD strings.
  if (since !== null && until !== null && since > until) {
    return { ok: false, error: 'since must be on or before until' };
  }

  return {
    ok: true,
    since,
    until,
    untilExclusive: until !== null ? nextDay(until) : null,
  };
}
