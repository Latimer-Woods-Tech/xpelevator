import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAuth, AuthError } from '@/lib/auth-api';
import { computeAnalytics, type SessionFull, type ScoreFull } from '@/lib/analytics';
import { errorFields, log, requestIdFrom } from '@/lib/log';

/** Shape of a row returned by the analytics SELECT below (before date mapping). */
interface RawAnalyticsRow {
  type: string;
  jobTitleId: string;
  scoringStatus: string | null;
  endedAt: string | null;
  createdAt: string;
  jobTitle: { name: string };
  scores: ScoreFull[];
}

export async function GET(request: Request) {
  try {
    // Require authentication — analytics is sensitive data
    const { session: authSession } = await requireAuth();
    const userOrgId = authSession.user.orgId;

    // Multi-tenancy: sessions are filtered to the caller's org (+ global) in
    // the WHERE clause of the query below. An org-less caller is scoped to
    // their OWN null-org sessions — per the session-access doctrine
    // (`canAccessSession`, src/lib/session-access.ts) "no org" is never a
    // shared tenant, so a bare `org_id IS NULL` fallback (which aggregated
    // every self-registered user into one pool) is the same cross-tenant bug
    // that doctrine closed. `ss.user_id` is the auth id written at insert.

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
        AND (${userOrgId ? sql`ss.org_id = ${userOrgId} OR ss.org_id IS NULL` : sql`ss.org_id IS NULL AND ss.user_id = ${authSession.user.id}`})
      GROUP BY ss.id, jt.id
      ORDER BY ss.ended_at ASC NULLS FIRST
    `;
    const sessions = (rawSessions as RawAnalyticsRow[]).map((row) => ({
      type: row.type,
      jobTitleId: row.jobTitleId,
      endedAt: row.endedAt ? new Date(row.endedAt) : null,
      createdAt: new Date(row.createdAt),
      jobTitle: row.jobTitle,
      scores: row.scores,
      scoringStatus: row.scoringStatus ?? null,
    })) as SessionFull[];

    // All aggregation lives in the pure, unit-tested `computeAnalytics`
    // (issue #16, P3b-1): headline average, scoring health, 60-day trend, and
    // the per job-title / criteria / modality breakdowns.
    const summary = computeAnalytics(sessions, new Date());

    // Private, short-lived cache (issue #16, P3b-1): a manager reloading the
    // dashboard within a minute is served from cache instead of re-running the
    // full-history aggregation. `private` keeps one tenant's data out of any
    // shared cache.
    return NextResponse.json(summary, {
      headers: { 'Cache-Control': 'private, max-age=60' },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const requestId = requestIdFrom(request.headers);
    log('error', 'analytics.summary_failed', { requestId, ...errorFields(error) });
    return NextResponse.json({ error: 'Failed to load analytics' }, { status: 500 });
  }
}
