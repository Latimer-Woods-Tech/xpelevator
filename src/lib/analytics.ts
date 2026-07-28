/**
 * Pure analytics aggregation for the manager dashboard (`GET /api/analytics`).
 *
 * This module holds the reduction that turns a caller's completed simulation
 * sessions (with their per-criteria scores) into the dashboard payload:
 * headline average, scoring-engine health, a 60-day score trend, and per
 * job-title / criteria / modality breakdowns.
 *
 * It is deliberately **pure** — no DB, no `Date.now()` (the caller injects
 * `now`), no I/O — so the aggregation math is unit-testable in isolation. The
 * route (`src/app/api/analytics/route.ts`) owns fetching + tenant scoping and
 * hands the mapped rows here. Extracting it (issue #16, P3b-1 down-payment)
 * closes the analytics-logic coverage gap: previously only the *page* was
 * tested, never the reduction that produces the numbers a manager trusts.
 *
 * Scoring health reuses the canonical {@link scoringLabel} mapping (the same
 * `src/lib/report.ts` helper the CSV/PDF export uses) so the on-screen scoring
 * breakdown and the exported artifact can never drift.
 *
 * NOTE (P3b-1 follow-up): the route still fetches every in-scope session row
 * and this function reduces them in memory. Pushing these aggregates into SQL
 * (`SUM/GROUP BY/date_trunc`) to bound the scan at large history sizes is the
 * remaining half of P3b-1 — deferred because verifying the SQL weighted-average
 * math requires a DB-backed integration harness (the open P2-7 gap), not
 * because of effort. Keeping the math here (bit-identical + tested) is the safe
 * intermediate step and the reference the SQL version must match.
 */

import { scoringLabel } from './report';

/** A single per-criteria score attached to a session. */
export type ScoreFull = {
  score: number;
  criteriaId: string;
  criteria: { name: string; weight: number };
};

/** A completed session with the fields the dashboard aggregates over. */
export type SessionFull = {
  type: string;
  jobTitleId: string;
  endedAt: Date | null;
  createdAt: Date;
  jobTitle: { name: string };
  scores: ScoreFull[];
  /** End-of-session scoring outcome; `null` for pre-instrumentation rows. */
  scoringStatus: string | null;
};

/** Count of sessions by scoring-engine outcome (see {@link scoringLabel}). */
export interface ScoringHealth {
  scored: number;
  failed: number;
  notScorable: number;
  unknown: number;
}

/** The dashboard payload returned by `GET /api/analytics`. */
export interface AnalyticsSummary {
  totalSessions: number;
  overallAvg: number | null;
  scoringHealth: ScoringHealth;
  scoreTrend: Array<{ date: string; avg: number; count: number }>;
  byJobTitle: Array<{ name: string; sessions: number; avg: number | null }>;
  byCriteria: Array<{ name: string; weight: number; avg: number | null; count: number }>;
  byType: Array<{ type: string; sessions: number; avg: number | null }>;
}

/** How many days of history the score-trend series covers. */
export const TREND_WINDOW_DAYS = 60;

/**
 * The canonical practice modalities, in dashboard display order. Mirrors the
 * Prisma `SimulationType` enum (PHONE | CHAT | VOICE) so the by-modality
 * breakdown always covers exactly the product's modalities and can never drift
 * from — or silently drop — one of them.
 */
export const MODALITIES = ['PHONE', 'CHAT', 'VOICE'] as const;

/**
 * Reduce a caller's completed sessions into the analytics dashboard payload.
 *
 * @param sessions completed, tenant-scoped sessions (already filtered by the route)
 * @param now the reference "now" for the trend window (injected for determinism)
 */
export function computeAnalytics(sessions: SessionFull[], now: Date): AnalyticsSummary {
  // ── Summary ───────────────────────────────────────────────────────────────
  const totalSessions = sessions.length;

  // ── Scoring health ────────────────────────────────────────────────────────
  // Reuses the canonical `scoringLabel` mapping so screen + export never drift.
  const scoringHealth: ScoringHealth = { scored: 0, failed: 0, notScorable: 0, unknown: 0 };
  for (const session of sessions) {
    switch (scoringLabel(session)) {
      case 'Scored':
        scoringHealth.scored += 1;
        break;
      case 'Failed':
        scoringHealth.failed += 1;
        break;
      case 'Not scorable':
        scoringHealth.notScorable += 1;
        break;
      default:
        scoringHealth.unknown += 1;
    }
  }

  const allScores: ScoreFull[] = sessions.flatMap((s) => s.scores);
  const totalWeightedScore = allScores.reduce((sum, s) => sum + s.score * s.criteria.weight, 0);
  const totalWeight = allScores.reduce((sum, s) => sum + s.criteria.weight, 0);
  const overallAvg = totalWeight > 0 ? totalWeightedScore / totalWeight : null;

  // ── Score trend (daily average for last 60 days) ──────────────────────────
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - TREND_WINDOW_DAYS);

  const trendMap = new Map<string, { sum: number; count: number }>();
  for (const session of sessions) {
    const date = session.endedAt ?? session.createdAt;
    if (date < cutoff) continue;

    const day = date.toISOString().slice(0, 10); // YYYY-MM-DD
    const sessionWeightedScore = session.scores.reduce((sum, s) => sum + s.score * s.criteria.weight, 0);
    const sessionWeight = session.scores.reduce((sum, s) => sum + s.criteria.weight, 0);
    const sessionAvg = sessionWeight > 0 ? sessionWeightedScore / sessionWeight : null;
    if (sessionAvg === null) continue;

    const existing = trendMap.get(day) ?? { sum: 0, count: 0 };
    trendMap.set(day, { sum: existing.sum + sessionAvg, count: existing.count + 1 });
  }
  const scoreTrend = Array.from(trendMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { sum, count }]) => ({ date, avg: sum / count, count }));

  // ── Per job-title breakdown ───────────────────────────────────────────────
  const jobMap = new Map<
    string,
    { name: string; sessions: number; weightedScoreSum: number; weightSum: number }
  >();
  for (const session of sessions) {
    const key = session.jobTitleId;
    const existing = jobMap.get(key) ?? {
      name: session.jobTitle.name,
      sessions: 0,
      weightedScoreSum: 0,
      weightSum: 0,
    };
    existing.sessions += 1;
    for (const s of session.scores) {
      existing.weightedScoreSum += s.score * s.criteria.weight;
      existing.weightSum += s.criteria.weight;
    }
    jobMap.set(key, existing);
  }
  const byJobTitle = Array.from(jobMap.values())
    .map(({ name, sessions: count, weightedScoreSum, weightSum }) => ({
      name,
      sessions: count,
      avg: weightSum > 0 ? weightedScoreSum / weightSum : null,
    }))
    .sort((a, b) => b.sessions - a.sessions);

  // ── Per criteria breakdown ────────────────────────────────────────────────
  const criteriaMap = new Map<
    string,
    { name: string; weight: number; sum: number; count: number }
  >();
  for (const score of allScores) {
    const key = score.criteriaId;
    const existing = criteriaMap.get(key) ?? {
      name: score.criteria.name,
      weight: score.criteria.weight,
      sum: 0,
      count: 0,
    };
    existing.sum += score.score;
    existing.count += 1;
    criteriaMap.set(key, existing);
  }
  const byCriteria = Array.from(criteriaMap.values())
    .map(({ name, weight, sum, count }) => ({
      name,
      weight,
      avg: count > 0 ? sum / count : null,
      count,
    }))
    .sort((a, b) => (a.avg ?? 0) - (b.avg ?? 0));

  // ── Type (modality) breakdown ─────────────────────────────────────────────
  // The product ships THREE modalities (Prisma `SimulationType`: PHONE | CHAT |
  // VOICE — browser voice is a first-class, admin-selectable type). Deriving the
  // rows from this canonical list, rather than filtering two hard-coded types,
  // guarantees the by-modality view can never silently drop a modality: VOICE
  // was previously omitted, so every VOICE session's count + scores vanished
  // from the manager breakdown and `sum(byType.sessions)` no longer reconciled
  // with `totalSessions`. A row is always emitted per modality, even at zero
  // volume, so the dashboard shape stays stable.
  const typeAvg = (arr: SessionFull[]) => {
    const sc: ScoreFull[] = arr.flatMap((s) => s.scores);
    const wSum = sc.reduce((sum, s) => sum + s.criteria.weight, 0);
    return wSum > 0 ? sc.reduce((sum, s) => sum + s.score * s.criteria.weight, 0) / wSum : null;
  };
  const byType = MODALITIES.map((type) => {
    const arr = sessions.filter((s) => s.type === type);
    return { type, sessions: arr.length, avg: typeAvg(arr) };
  });

  return {
    totalSessions,
    overallAvg,
    scoringHealth,
    scoreTrend,
    byJobTitle,
    byCriteria,
    byType,
  };
}
