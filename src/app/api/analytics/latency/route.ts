/**
 * Response-speed read surface — `GET /api/analytics/latency`
 *
 * Turns the per-turn latency telemetry R-066 persists on `chat_messages` into a
 * manager/operator-facing summary: mean + p95 time-to-first-token, the felt-speed
 * tier mix, the %-slow share, and the same split by model, by route-reason, and
 * by modality (CHAT | VOICE | PHONE). This is the visible artifact the founder's
 * "half-speed sparring session" note (issue #16) was missing — and the benchmark
 * any Phase-5 model/voice swap must beat. Phase 5 read-side complement to R-066
 * (R-067); the modality split + `?since`/`?until` date window are R-068, so "is
 * voice/phone the slow leg, and was it slow this month?" is answerable from data.
 *
 * Access: any authenticated user, strictly tenant-scoped — identical to
 * `/api/analytics`. `requireAuth()` yields 401 for anon (also caught by
 * middleware), and the query filters reply turns to the caller's org
 * (`org_id = <org> OR org_id IS NULL`; an org-less caller gets only their OWN
 * null-org sessions — owner-only per `canAccessSession`), so it can never
 * surface another tenant's (or another org-less user's) turns. Only aggregate timing is
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
import { boundScan, MAX_ANALYTICS_SCAN_ROWS } from '@/lib/limits';
import { parseReportWindow } from '@/lib/report-window';
import { errorFields, log, requestIdFrom } from '@/lib/log';

export async function GET(request: Request) {
  try {
    const { session } = await requireAuth();
    const userOrgId = session.user.orgId;

    // `?since` / `?until` date window (the operator's "monthly cut" — same
    // parser + semantics as the reporting export R-065, inclusive UTC calendar
    // days). A malformed date or `since` after `until` is a 400. The window
    // filters on the turn's own timestamp (`cm.timestamp`) — the honest reading
    // for "how fast did the simulator feel during this period" (R-068).
    const params = new URL(request.url).searchParams;
    const window = parseReportWindow(params);
    if (!window.ok) {
      return NextResponse.json({ error: window.error }, { status: 400 });
    }

    // Compose the window onto the tenant filter. Both narrow an already
    // authorized set — isolation is untouched. `since` is inclusive; `until` is
    // covered whole-day via the exclusive `untilExclusive` upper bound.
    // An org-less caller is scoped to their OWN null-org sessions — per the
    // session-access doctrine (`canAccessSession`, src/lib/session-access.ts)
    // "no org" is never a shared tenant, so a bare `org_id IS NULL` fallback
    // (which pooled every self-registered user's turns) is the same
    // cross-tenant bug that doctrine closed. `ss.user_id` is the auth id
    // written at session insert.
    const tenantFilter = userOrgId
      ? sql`ss.org_id = ${userOrgId} OR ss.org_id IS NULL`
      : sql`ss.org_id IS NULL AND ss.user_id = ${session.user.id}`;
    let filter = sql`cm.ttft_ms IS NOT NULL AND (${tenantFilter})`;
    if (window.since) {
      filter = sql`${filter} AND cm.timestamp >= ${window.since}`;
    }
    if (window.untilExclusive) {
      filter = sql`${filter} AND cm.timestamp < ${window.untilExclusive}`;
    }

    // Same tenant scope as `/api/analytics`: a user in an org sees their org's
    // turns plus any global (org-less) sessions; an org-less user sees only
    // org-less sessions. Only reply turns carry telemetry, so `ttft_ms IS NOT
    // NULL` restricts to measured CUSTOMER rows (AGENT + pre-R-066 rows are NULL).
    // `ss.type` is the conversation modality (CHAT | VOICE | PHONE) for R-068.
    // Bound the rows pulled into this isolate (P3b-2). This scan is O(messages)
    // over the whole tenant with no other limit — the app's largest unbounded
    // query. `ORDER BY timestamp DESC` + `LIMIT max + 1` means: on any realistic
    // tenant every row is returned (total <= max), so the summary is identical to
    // an unbounded scan (percentiles are order-independent); on a pathological
    // tenant only the most-recent `max` turns are materialised and `boundScan`
    // flags `truncated`, so the summary degrades to a recent-window estimate
    // instead of OOM-ing the isolate.
    const rawRows = await sql`
      SELECT
        cm.ttft_ms      AS "ttftMs",
        cm.total_ms     AS "totalMs",
        cm.latency_tier AS "tier",
        cm.model        AS "model",
        cm.route_reason AS "routeReason",
        ss.type         AS "modality"
      FROM chat_messages cm
      JOIN simulation_sessions ss ON ss.id = cm.session_id
      WHERE ${filter}
      ORDER BY cm.timestamp DESC
      LIMIT ${MAX_ANALYTICS_SCAN_ROWS + 1}
    `;
    const { rows, truncated } = boundScan(
      rawRows as unknown as Array<Record<string, unknown>>,
      MAX_ANALYTICS_SCAN_ROWS
    );

    const turns = rows.map((r) => ({
      ttftMs: Number(r.ttftMs),
      totalMs: Number(r.totalMs),
      tier: (r.tier as string | null) ?? null,
      model: (r.model as string | null) ?? null,
      routeReason: (r.routeReason as string | null) ?? null,
      modality: (r.modality as string | null) ?? null,
    })) as LatencyTurn[];

    // `truncated` tells a consumer the summary was computed over the most-recent
    // MAX_ANALYTICS_SCAN_ROWS turns rather than the full history (false on any
    // realistic tenant). Additive field — existing consumers ignore it.
    return NextResponse.json({ ...summarizeLatency(turns), truncated });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const requestId = requestIdFrom(request.headers);
    log('error', 'analytics.latency_failed', { requestId, ...errorFields(error) });
    return NextResponse.json(
      { error: 'Failed to load latency summary' },
      { status: 500 }
    );
  }
}
