/**
 * Response-speed read surface — `GET /api/analytics/latency`
 *
 * Turns the per-turn latency telemetry R-066 persists on `chat_messages` into a
 * manager/operator-facing summary: mean + p95 time-to-first-token, the felt-speed
 * tier mix, the %-slow share, and the same split by model and by route-reason.
 * This is the visible artifact the founder's "half-speed sparring session" note
 * (issue #16) was missing — and the benchmark any Phase-5 model/voice swap must
 * beat. Phase 5 read-side complement to R-066 (R-067).
 *
 * Access: any authenticated user, strictly tenant-scoped — identical to
 * `/api/analytics`. `requireAuth()` yields 401 for anon (also caught by
 * middleware), and the query filters reply turns to the caller's org
 * (`org_id = <org> OR org_id IS NULL`, or `org_id IS NULL` for an org-less user),
 * so it can never surface another tenant's turns. Only aggregate timing is
 * returned — no message content, no scenario `script`/hints — so nothing here can
 * leak a hidden mechanic.
 *
 * The percentile + aggregation logic lives in the pure, unit-tested
 * `@/lib/latency-summary`; this handler is a thin auth + query shell.
 */
import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAuth, AuthError } from '@/lib/auth-api';
import { summarizeLatency, type LatencyTurn } from '@/lib/latency-summary';

export async function GET() {
  try {
    const { session } = await requireAuth();
    const userOrgId = session.user.orgId;

    // Same tenant scope as `/api/analytics`: a user in an org sees their org's
    // turns plus any global (org-less) sessions; an org-less user sees only
    // org-less sessions. Only reply turns carry telemetry, so `ttft_ms IS NOT
    // NULL` restricts to measured CUSTOMER rows (AGENT + pre-R-066 rows are NULL).
    const rows = await sql`
      SELECT
        cm.ttft_ms      AS "ttftMs",
        cm.total_ms     AS "totalMs",
        cm.latency_tier AS "tier",
        cm.model        AS "model",
        cm.route_reason AS "routeReason"
      FROM chat_messages cm
      JOIN simulation_sessions ss ON ss.id = cm.session_id
      WHERE cm.ttft_ms IS NOT NULL
        AND (${userOrgId
          ? sql`ss.org_id = ${userOrgId} OR ss.org_id IS NULL`
          : sql`ss.org_id IS NULL`})
    `;

    const turns = (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
      ttftMs: Number(r.ttftMs),
      totalMs: Number(r.totalMs),
      tier: (r.tier as string | null) ?? null,
      model: (r.model as string | null) ?? null,
      routeReason: (r.routeReason as string | null) ?? null,
    })) as LatencyTurn[];

    return NextResponse.json(summarizeLatency(turns));
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Latency summary error:', error);
    return NextResponse.json(
      { error: 'Failed to load latency summary' },
      { status: 500 }
    );
  }
}
