/**
 * Pure transforms for the manager reporting export.
 *
 * Turns the per-session score data (the same shape `/api/analytics` reads) into
 * a flat, one-row-per-session summary suitable for a CSV an operator shows their
 * client. Kept dependency-free (no DB, no NextAuth) so the route stays a thin
 * auth + query shell and the row/weighting logic is unit-tested in isolation.
 *
 * Scoring convention matches `/api/analytics`: a session's headline number is
 * the **weighted** average of its per-criterion scores, `sum(score*weight) /
 * sum(weight)` — so a heavily-weighted criterion moves the number more, exactly
 * as the in-app analytics and the `/10` shown to trainees do.
 */

import { toCsv, type CsvCell } from './csv';
import { renderTablePdf, type PdfColumn } from './pdf';

/** One scored criterion on a session (as returned by the report query). */
export interface ReportScore {
  score: number;
  criteria: { name: string; weight: number };
}

/** One completed session with its scores (as returned by the report query). */
export interface ReportSession {
  id: string;
  type: string;
  endedAt: string | Date | null;
  createdAt: string | Date;
  traineeEmail: string | null;
  jobTitle: string | null;
  scenario: string | null;
  scores: ReportScore[];
  /**
   * Owning client-org name — populated only by the operator portfolio roll-up
   * (`?scope=clients`), where sessions span many client orgs and must be
   * attributed. Absent/`null` on the single-org report, which never renders it.
   */
  organization?: string | null;
  /**
   * Raw end-of-session scoring outcome (`SCORED` | `FAILED` | `NOT_SCORABLE`),
   * or `null`/`undefined` for sessions completed before the column existed.
   */
  scoringStatus?: string | null;
}

/** A flattened, export-ready summary of a single session. */
export interface ReportRow {
  sessionId: string;
  date: string;
  trainee: string;
  jobTitle: string;
  scenario: string;
  modality: string;
  criteriaScored: number;
  averageScore: number | null;
  weightedAverage: number | null;
  /** Human-readable scoring outcome for the manager (see {@link scoringLabel}). */
  scoring: string;
}

/**
 * Column order for the CSV — stable so downstream consumers can rely on it.
 * `Scoring` is appended last so the historical column positions never shift.
 */
export const REPORT_COLUMNS: readonly string[] = [
  'Session ID',
  'Date',
  'Trainee',
  'Job Title',
  'Scenario',
  'Modality',
  'Criteria Scored',
  'Average Score',
  'Weighted Average',
  'Scoring',
];

/**
 * Map a session to a human-readable scoring outcome the manager can trust.
 *
 * Prefers the explicit end-of-session `scoringStatus`; for older rows that
 * predate the column (`null`/`undefined`) it infers from whether scores landed,
 * so a legacy report still reads sensibly. The key distinction this exposes:
 * `Failed` (the scoring engine broke) is NOT the same as `Not scorable` (too
 * short / no criteria) — both otherwise show an empty score.
 */
export function scoringLabel(
  session: Pick<ReportSession, 'scoringStatus' | 'scores'>,
): string {
  switch (session.scoringStatus) {
    case 'SCORED':
      return 'Scored';
    case 'FAILED':
      return 'Failed';
    case 'NOT_SCORABLE':
      return 'Not scorable';
    default:
      // Pre-instrumentation row: infer from the score data we do have.
      return (session.scores ?? []).length > 0 ? 'Scored' : 'Unknown';
  }
}

/** Round to one decimal place, or `null` when there is nothing to average. */
function round1(value: number | null): number | null {
  return value == null ? null : Math.round(value * 10) / 10;
}

/** Normalise a session's date to an ISO `YYYY-MM-DD` day (ended, else created). */
function reportDate(session: ReportSession): string {
  const raw = session.endedAt ?? session.createdAt;
  const d = raw instanceof Date ? raw : new Date(raw);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/** Build the export summary for one session. */
export function sessionToReportRow(session: ReportSession): ReportRow {
  const scores = session.scores ?? [];
  const count = scores.length;

  const simpleSum = scores.reduce((sum, s) => sum + s.score, 0);
  const weightedSum = scores.reduce((sum, s) => sum + s.score * s.criteria.weight, 0);
  const weightTotal = scores.reduce((sum, s) => sum + s.criteria.weight, 0);

  return {
    sessionId: session.id,
    date: reportDate(session),
    trainee: session.traineeEmail ?? '(unknown)',
    jobTitle: session.jobTitle ?? '',
    scenario: session.scenario ?? '',
    modality: session.type,
    criteriaScored: count,
    averageScore: count > 0 ? round1(simpleSum / count) : null,
    weightedAverage: weightTotal > 0 ? round1(weightedSum / weightTotal) : null,
    scoring: scoringLabel(session),
  };
}

/** Map many sessions to export rows, preserving input order. */
export function sessionsToReportRows(sessions: readonly ReportSession[]): ReportRow[] {
  return sessions.map(sessionToReportRow);
}

/** Serialise sessions straight to a manager-reporting CSV string. */
export function sessionsToCsv(sessions: readonly ReportSession[]): string {
  const rows: CsvCell[][] = sessionsToReportRows(sessions).map((r) => [
    r.sessionId,
    r.date,
    r.trainee,
    r.jobTitle,
    r.scenario,
    r.modality,
    r.criteriaScored,
    r.averageScore,
    r.weightedAverage,
    r.scoring,
  ]);
  return toCsv(REPORT_COLUMNS, rows);
}

/**
 * Column layout for the PDF export. Widths are PDF points (1/72 inch) and sum to
 * 522 — inside the 532pt printable width of a US-Letter page at a 40pt margin,
 * leaving a hair of slack. The full UUID is shortened to an 8-char reference so
 * the page stays readable; the CSV remains the machine-precise, full-id artifact.
 */
// Widths are PDF points and still sum to 522 (inside the 532pt printable area):
// Trainee 118→92 and Scenario 96→82 give up 40pt for the new 'Scoring' column.
const PDF_COLUMNS: readonly PdfColumn[] = [
  { header: 'Session', width: 54 },
  { header: 'Date', width: 56 },
  { header: 'Trainee', width: 92 },
  { header: 'Job Title', width: 84 },
  { header: 'Scenario', width: 82 },
  { header: 'Mode', width: 34 },
  { header: '#', width: 18 },
  { header: 'Avg', width: 30 },
  { header: 'Wtd', width: 32 },
  { header: 'Scoring', width: 40 },
];

/** Format a nullable one-decimal score for the PDF (`-` when unscored). */
function pdfScore(value: number | null): string {
  return value == null ? '-' : value.toFixed(1);
}

/**
 * Serialise sessions to a manager-reporting PDF (raw bytes). The headline number
 * shown per session is the same weighted average as the CSV and in-app analytics.
 * A dated subtitle carries the generation timestamp so {@link renderTablePdf}
 * itself stays deterministic.
 */
export function sessionsToPdf(sessions: readonly ReportSession[]): Uint8Array {
  const reportRows = sessionsToReportRows(sessions);
  const rows = reportRows.map((r) => [
    r.sessionId.slice(0, 8),
    r.date,
    r.trainee,
    r.jobTitle,
    r.scenario,
    r.modality,
    r.criteriaScored,
    pdfScore(r.averageScore),
    pdfScore(r.weightedAverage),
    r.scoring,
  ]);

  const generated = new Date().toISOString().slice(0, 10);
  const count = reportRows.length;
  return renderTablePdf({
    title: 'XPElevator — Session Report',
    subtitle: `Generated ${generated} · ${count} completed session${count === 1 ? '' : 's'} · score shown is the weighted average /10`,
    columns: PDF_COLUMNS,
    rows,
  });
}

// ─── Operator portfolio roll-up ──────────────────────────────────────────────
//
// The single-client artifacts above answer "how is THIS client doing?". The
// roll-up answers "how is my whole book of clients doing?" — one export spanning
// every client org beneath an operator. It reuses the same per-session weighting
// and scoring logic; the only shape difference is a leading `Organization`
// column that attributes each session to its client org (the whole point of a
// portfolio view). The single-org columns above are left byte-stable — this is a
// distinct, additive column set, never a mutation of `REPORT_COLUMNS`.

/** Roll-up column order — the single-org columns, prefixed with `Organization`. */
export const ROLLUP_COLUMNS: readonly string[] = ['Organization', ...REPORT_COLUMNS];

/** A session's owning client-org name for the roll-up (`(unassigned)` if null). */
function reportOrg(session: ReportSession): string {
  return session.organization ?? '(unassigned)';
}

/** Serialise sessions to the operator portfolio roll-up CSV string. */
export function rollupSessionsToCsv(sessions: readonly ReportSession[]): string {
  const rows: CsvCell[][] = sessions.map((session) => {
    const r = sessionToReportRow(session);
    return [
      reportOrg(session),
      r.sessionId,
      r.date,
      r.trainee,
      r.jobTitle,
      r.scenario,
      r.modality,
      r.criteriaScored,
      r.averageScore,
      r.weightedAverage,
      r.scoring,
    ];
  });
  return toCsv(ROLLUP_COLUMNS, rows);
}

/**
 * Column layout for the roll-up PDF. Widths are PDF points and sum to 532 — the
 * full printable width of a US-Letter page at a 40pt margin — after trimming the
 * single-org widths to make room for the leading `Organization` column.
 */
const ROLLUP_PDF_COLUMNS: readonly PdfColumn[] = [
  { header: 'Organization', width: 70 },
  { header: 'Session', width: 48 },
  { header: 'Date', width: 52 },
  { header: 'Trainee', width: 78 },
  { header: 'Job Title', width: 70 },
  { header: 'Scenario', width: 70 },
  { header: 'Mode', width: 30 },
  { header: '#', width: 16 },
  { header: 'Avg', width: 28 },
  { header: 'Wtd', width: 30 },
  { header: 'Scoring', width: 40 },
];

/** Serialise sessions to the operator portfolio roll-up PDF (raw bytes). */
export function rollupSessionsToPdf(sessions: readonly ReportSession[]): Uint8Array {
  const rows = sessions.map((session) => {
    const r = sessionToReportRow(session);
    return [
      reportOrg(session),
      r.sessionId.slice(0, 8),
      r.date,
      r.trainee,
      r.jobTitle,
      r.scenario,
      r.modality,
      r.criteriaScored,
      pdfScore(r.averageScore),
      pdfScore(r.weightedAverage),
      r.scoring,
    ];
  });

  const generated = new Date().toISOString().slice(0, 10);
  const count = rows.length;
  return renderTablePdf({
    title: 'XPElevator — Portfolio Report',
    subtitle: `Generated ${generated} · ${count} completed session${count === 1 ? '' : 's'} across your client organisations · score shown is the weighted average /10`,
    columns: ROLLUP_PDF_COLUMNS,
    rows,
  });
}

// ─── Operator portfolio scorecard (per-client totals) ────────────────────────
//
// The roll-up above is the per-session detail — every trainee session across
// the whole book, one row each. The scorecard is the complement an operator
// scans first: ONE row per client org with the totals that matter to a channel
// seller — how many trainees are active, how many sessions they've run, how many
// scored, and the book-level average. Same authorized session set as the
// roll-up (the route just serialises it differently — no extra query, no wider
// access); the aggregation is pure and unit-tested here.

/** Per-client roll-up totals — one row per client org in the operator's book. */
export interface OrgSummary {
  /** Owning client-org name (`(unassigned)` for sessions with no org). */
  organization: string;
  /** Distinct trainee emails seen across the org's completed sessions. */
  trainees: number;
  /** Completed sessions for the org. */
  sessions: number;
  /** Of those, how many produced a weighted score (the rest are unscored). */
  scoredSessions: number;
  /**
   * Mean of the org's per-session weighted averages, over the scored sessions
   * only, rounded to one decimal — or `null` when the org has no scored session.
   * Matches the `/10` weighting used everywhere else in the report.
   */
  averageWeighted: number | null;
}

/**
 * Aggregate sessions into one totals row per client org — the operator's
 * portfolio scorecard. Groups by the same `(unassigned)`-labelled org name the
 * roll-up detail uses, and orders rows by org name so the output is stable
 * regardless of the input session order.
 */
export function summarizeSessionsByOrg(
  sessions: readonly ReportSession[],
): OrgSummary[] {
  interface Acc {
    trainees: Set<string>;
    sessions: number;
    scoredSessions: number;
    weightedTotal: number;
  }
  const byOrg = new Map<string, Acc>();

  for (const session of sessions) {
    const org = reportOrg(session);
    let acc = byOrg.get(org);
    if (!acc) {
      acc = { trainees: new Set(), sessions: 0, scoredSessions: 0, weightedTotal: 0 };
      byOrg.set(org, acc);
    }
    acc.sessions += 1;
    if (session.traineeEmail) acc.trainees.add(session.traineeEmail);
    const { weightedAverage } = sessionToReportRow(session);
    if (weightedAverage != null) {
      acc.scoredSessions += 1;
      acc.weightedTotal += weightedAverage;
    }
  }

  return [...byOrg.entries()]
    .map(([organization, acc]) => ({
      organization,
      trainees: acc.trainees.size,
      sessions: acc.sessions,
      scoredSessions: acc.scoredSessions,
      averageWeighted:
        acc.scoredSessions > 0 ? round1(acc.weightedTotal / acc.scoredSessions) : null,
    }))
    .sort((a, b) => a.organization.localeCompare(b.organization));
}

/** Scorecard column order — a distinct, additive column set (never mutated). */
export const SUMMARY_COLUMNS: readonly string[] = [
  'Organization',
  'Trainees',
  'Sessions',
  'Scored Sessions',
  'Average Weighted Score',
];

/** Serialise the per-client scorecard to a CSV string. */
export function rollupSummaryToCsv(sessions: readonly ReportSession[]): string {
  const rows: CsvCell[][] = summarizeSessionsByOrg(sessions).map((o) => [
    o.organization,
    o.trainees,
    o.sessions,
    o.scoredSessions,
    o.averageWeighted,
  ]);
  return toCsv(SUMMARY_COLUMNS, rows);
}

/**
 * Column layout for the scorecard PDF. Widths are PDF points and sum to 452 —
 * well inside the 532pt printable width — because a five-column totals table
 * needs no more; the wide `Organization` column carries the client name.
 */
const SUMMARY_PDF_COLUMNS: readonly PdfColumn[] = [
  { header: 'Organization', width: 180 },
  { header: 'Trainees', width: 60 },
  { header: 'Sessions', width: 60 },
  { header: 'Scored', width: 60 },
  { header: 'Avg /10', width: 60 },
];

/** Serialise the per-client scorecard to a PDF (raw bytes). */
export function rollupSummaryToPdf(sessions: readonly ReportSession[]): Uint8Array {
  const summaries = summarizeSessionsByOrg(sessions);
  const rows = summaries.map((o) => [
    o.organization,
    o.trainees,
    o.sessions,
    o.scoredSessions,
    pdfScore(o.averageWeighted),
  ]);

  const generated = new Date().toISOString().slice(0, 10);
  const count = summaries.length;
  return renderTablePdf({
    title: 'XPElevator — Portfolio Scorecard',
    subtitle: `Generated ${generated} · ${count} client organisation${count === 1 ? '' : 's'} · score shown is the weighted average /10 over scored sessions`,
    columns: SUMMARY_PDF_COLUMNS,
    rows,
  });
}
