
import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAuth, AuthError } from '@/lib/auth-api';
import { scoringLabel } from '@/lib/report';

// Minimal types needed for the callback annotations below
type ScoreFull = {
  score: number;
  criteriaId: string;
  criteria: { name: string; weight: number };
};

type SessionFull = {
  type: string;
  jobTitleId: string;
  endedAt: Date | null;
  createdAt: Date;
  jobTitle: { name: string };
  scores: ScoreFull[];
  /** End-of-session scoring outcome; `null` for pre-instrumentation rows. */
  scoringStatus: string | null;
};


export async function GET() {
  try {
    // Require authentication — analytics is sensitive data
    const { session: authSession } = await requireAuth();
    const userOrgId = authSession.user.orgId;

    // Multi-tenancy: sessions are filtered to the caller's org (+ global) in
    // the WHERE clause of the query below.

    // Fetch all completed sessions with scores and criteria
    const rawSessions = await sql`
      SELECT 
        ss.id,
        ss.type,
        ss.job_title_id as "jobTitleId",
        ss.scenario_id as "scenarioId",
        ss.scoring_status as "scoringStatus",
        ss.ended_at as "endedAt",
        ss.created_at as "createdAt",
        json_build_object(
          'id', jt.id,
          'name', jt.name
        ) as "jobTitle",
        COALESCE(
          json_agg(
            json_build_object(
              'score', sc.score,
              'criteriaId', sc.criteria_id,
              'criteria', json_build_object(
                'name', c.name,
                'weight', c.weight
              )
            ) ORDER BY sc.scored_at
          ) FILTER (WHERE sc.id IS NOT NULL),
          '[]'
        ) as scores
      FROM simulation_sessions ss
      LEFT JOIN job_titles jt ON jt.id = ss.job_title_id
      LEFT JOIN scores sc ON sc.session_id = ss.id
      LEFT JOIN criteria c ON c.id = sc.criteria_id
      WHERE ss.status = 'COMPLETED'
        AND (${userOrgId ? sql`ss.org_id = ${userOrgId} OR ss.org_id IS NULL` : sql`ss.org_id IS NULL`})
      GROUP BY ss.id, jt.id
      ORDER BY ss.ended_at ASC NULLS FIRST
    `;
    const sessions = rawSessions.map((row: any) => ({
      id: row.id,
      type: row.type,
      jobTitleId: row.jobTitleId,
      scenarioId: row.scenarioId,
      endedAt: row.endedAt ? new Date(row.endedAt) : null,
      createdAt: new Date(row.createdAt),
      jobTitle: row.jobTitle,
      scores: row.scores,
      scoringStatus: row.scoringStatus ?? null,
    })) as unknown as SessionFull[];

    // ── Summary ───────────────────────────────────────────────────────────────
    const totalSessions = sessions.length;

    // ── Scoring health ────────────────────────────────────────────────────────
    // Surface the same per-session scoring outcome the CSV/PDF export carries
    // (issue #16, E-root #8b) on-screen, so a manager can distinguish a scoring
    // *engine* failure from an un-scorable (too-short) session — the two look
    // identical as an empty score and quietly erode trust in the /10 otherwise.
    // Reuses the canonical `scoringLabel` mapping so screen + export never drift.
    const scoringHealth = { scored: 0, failed: 0, notScorable: 0, unknown: 0 };
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

    const allScores: ScoreFull[] = sessions.flatMap((s: SessionFull) => s.scores);
    const totalWeightedScore = allScores.reduce((sum: number, s: ScoreFull) => sum + s.score * s.criteria.weight, 0);
    const totalWeight = allScores.reduce((sum: number, s: ScoreFull) => sum + s.criteria.weight, 0);
    const overallAvg = totalWeight > 0 ? totalWeightedScore / totalWeight : null;

    // ── Score trend (daily average for last 60 days) ──────────────────────────
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - 60);

    const trendMap = new Map<string, { sum: number; count: number }>();
    for (const session of sessions) {
      const date = session.endedAt ?? session.createdAt;
      if (date < cutoff) continue;

      const day = date.toISOString().slice(0, 10); // YYYY-MM-DD
      const sessionWeightedScore = session.scores.reduce((sum: number, s: ScoreFull) => sum + s.score * s.criteria.weight, 0);
      const sessionWeight = session.scores.reduce((sum: number, s: ScoreFull) => sum + s.criteria.weight, 0);
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

    // ── Type breakdown ────────────────────────────────────────────────────────
    const phoneSessions = sessions.filter((s: SessionFull) => s.type === 'PHONE');
    const chatSessions = sessions.filter((s: SessionFull) => s.type === 'CHAT');
    const typeAvg = (arr: SessionFull[]) => {
      const sc: ScoreFull[] = arr.flatMap((s: SessionFull) => s.scores);
      const wSum = sc.reduce((sum: number, s: ScoreFull) => sum + s.criteria.weight, 0);
      return wSum > 0 ? sc.reduce((sum: number, s: ScoreFull) => sum + s.score * s.criteria.weight, 0) / wSum : null;
    };
    const byType = [
      { type: 'PHONE', sessions: phoneSessions.length, avg: typeAvg(phoneSessions) },
      { type: 'CHAT', sessions: chatSessions.length, avg: typeAvg(chatSessions) },
    ];

    return NextResponse.json({
      totalSessions,
      overallAvg,
      scoringHealth,
      scoreTrend,
      byJobTitle,
      byCriteria,
      byType,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Analytics error:', error);
    return NextResponse.json({ error: 'Failed to load analytics' }, { status: 500 });
  }
}
