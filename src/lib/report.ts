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
}

/** Column order for the CSV — stable so downstream consumers can rely on it. */
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
];

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
  ]);
  return toCsv(REPORT_COLUMNS, rows);
}
