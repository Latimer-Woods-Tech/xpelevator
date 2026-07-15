/**
 * Manager reporting export — `GET /api/reports/sessions`
 *
 * Returns a downloadable report of the caller's org's completed simulation
 * sessions with their per-session weighted score — the artifact a manager (or a
 * reselling operator) hands to their client. Phase 4, issue #16:
 * "Manager reporting + CSV/PDF export". Default format is CSV; `?format=pdf`
 * returns the same tenant-scoped data as a PDF.
 *
 * Access: ADMIN only (managers). By default the report is strictly scoped to the
 * admin's own org — `requireAuth(request, 'ADMIN')` yields 401 for anon (also
 * caught earlier by middleware), 403 for a non-admin member, and the query
 * filters on the admin's `orgId`, so it can never surface another tenant's
 * sessions.
 *
 * `?clientOrgId=<id>` lets an OPERATOR pull the report for a specific CLIENT org
 * beneath them — the channel model's actual artifact, since an operator's own
 * org carries no trainee sessions. Access to that client is authorized by the
 * pure `canAccessOrgReport` (platform admin: any org; an operator admin: only a
 * client they own; the org's own admin: itself — never another operator's
 * client, which is 403). An unknown id is 404. Without the parameter, behaviour
 * is unchanged (own-org report).
 *
 * `?scope=clients` returns the operator's PORTFOLIO roll-up — every session
 * across ALL client orgs beneath the operator, in one export with a leading
 * `Organization` column. The operator is resolved + authorized by the pure
 * `resolveOperatorRollup` (an operator admin: their own clients; a platform
 * admin: must name `?operatorOrgId=<id>`, else 400; a cross-operator param →
 * 403). `scope=clients` takes precedence over `clientOrgId`.
 *
 * `?view=summary` (only meaningful with `scope=clients`) collapses that roll-up
 * to one totals row PER CLIENT org — session count, scored count, and the
 * weighted average pooled across the client's sessions — plus a trailing
 * portfolio grand-total row. It reads the same authorized/windowed session set
 * as the detail roll-up (identical tenant scope), so it can never widen access.
 * Without it, the roll-up returns the per-session detail (unchanged).
 *
 * `?since=YYYY-MM-DD` / `?until=YYYY-MM-DD` bound the report to a date window on
 * a session's completion date (`ended_at`) — the operator's "monthly cut". Both
 * are inclusive calendar dates (UTC); a malformed date or a `since` after `until`
 * is a 400 (`parseReportWindow`). The window composes with every scope above,
 * narrowing — never widening — the authorized session set, so tenant isolation
 * is unaffected.
 *
 * The row/weighting logic lives in the pure `@/lib/report` + `@/lib/csv`
 * modules (unit-tested without a DB); this handler is a thin auth + query shell.
 */
import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAuth, AuthError } from '@/lib/auth-api';
import {
  sessionsToCsv,
  sessionsToPdf,
  rollupSessionsToCsv,
  rollupSessionsToPdf,
  rollupSummaryToCsv,
  rollupSummaryToPdf,
  type ReportSession,
} from '@/lib/report';
import { canAccessOrgReport, resolveOperatorRollup } from '@/lib/org-hierarchy';
import { parseReportWindow } from '@/lib/report-window';

export async function GET(request: Request) {
  try {
    const { session } = await requireAuth(request, 'ADMIN');

    const params = new URL(request.url).searchParams;
    // `?format=pdf` returns the same tenant-scoped report as a downloadable PDF
    // (the client-facing artifact); anything else keeps the default CSV.
    const wantsPdf = params.get('format') === 'pdf';

    // `?since` / `?until` date window (the operator's "monthly cut"). Validated
    // before any scope resolution so a malformed date is a clean 400 regardless
    // of who is asking; absent bounds leave the report all-time (unchanged).
    const window = parseReportWindow(params);
    if (!window.ok) {
      return NextResponse.json({ error: window.error }, { status: 400 });
    }

    // `?scope=clients` = the operator portfolio roll-up (all client orgs at once,
    // labelled by org). It takes precedence over the single-org `clientOrgId`.
    const rollup = params.get('scope') === 'clients';
    // `?view=summary` collapses the roll-up to one totals row per client (+ a
    // portfolio grand total). Only meaningful for the roll-up; ignored otherwise.
    const summary = rollup && params.get('view') === 'summary';

    // The session filter fragment: a portfolio roll-up spans every client org
    // beneath one operator; otherwise it is one strictly-scoped org id.
    let where;
    if (rollup) {
      const resolved = resolveOperatorRollup(
        session.user,
        params.get('operatorOrgId')
      );
      if (!resolved.ok) {
        const message =
          resolved.status === 400
            ? 'A platform admin must specify operatorOrgId for a portfolio roll-up'
            : 'You may only roll up your own client organizations';
        return NextResponse.json({ error: message }, { status: resolved.status });
      }
      where = sql`o.parent_org_id = ${resolved.operatorOrgId}`;
    } else {
      // Default: the admin's own org. `?clientOrgId=` re-targets a client the
      // operator owns, gated by `canAccessOrgReport` (cross-operator → 403).
      let orgId = session.user.orgId ?? null;
      const clientOrgId = params.get('clientOrgId');
      if (clientOrgId) {
        const targetRows = await sql`
          SELECT id, parent_org_id as "parentOrgId"
          FROM organizations
          WHERE id = ${clientOrgId}
        `;
        if (targetRows.length === 0) {
          return NextResponse.json(
            { error: 'Organization not found' },
            { status: 404 }
          );
        }
        const target = {
          id: targetRows[0].id as string,
          parentOrgId: (targetRows[0].parentOrgId as string | null) ?? null,
        };
        if (!canAccessOrgReport(target, session.user)) {
          return NextResponse.json(
            { error: 'You may only report on your own client organizations' },
            { status: 403 }
          );
        }
        orgId = target.id;
      }
      // Strict tenant scoping: an admin sees only their own org's sessions.
      // (`org_id IS NULL` for an admin without an org = their personal workspace.)
      where = orgId ? sql`ss.org_id = ${orgId}` : sql`ss.org_id IS NULL`;
    }

    // Narrow the (already tenant-scoped) `where` by the date window. Composing
    // onto the scope fragment keeps a single `${where}` in the main query and
    // can only ever shrink the authorized set — isolation is untouched. `since`
    // is inclusive; `untilExclusive` is the day after `until` (whole-day cover).
    if (window.since) {
      where = sql`${where} AND ss.ended_at >= ${window.since}`;
    }
    if (window.untilExclusive) {
      where = sql`${where} AND ss.ended_at < ${window.untilExclusive}`;
    }

    const rows = await sql`
      SELECT
        ss.id,
        ss.type,
        ss.scoring_status as "scoringStatus",
        ss.ended_at   as "endedAt",
        ss.created_at as "createdAt",
        u.email       as "traineeEmail",
        jt.name       as "jobTitle",
        s.name        as "scenario",
        o.name        as "organization",
        COALESCE(
          json_agg(
            json_build_object(
              'score', sc.score,
              'criteria', json_build_object('name', c.name, 'weight', c.weight)
            ) ORDER BY sc.scored_at
          ) FILTER (WHERE sc.id IS NOT NULL),
          '[]'
        ) as scores
      FROM simulation_sessions ss
      LEFT JOIN users         u  ON u.id  = ss.db_user_id
      LEFT JOIN job_titles    jt ON jt.id = ss.job_title_id
      LEFT JOIN scenarios     s  ON s.id  = ss.scenario_id
      LEFT JOIN organizations o  ON o.id  = ss.org_id
      LEFT JOIN scores        sc ON sc.session_id = ss.id
      LEFT JOIN criteria      c  ON c.id  = sc.criteria_id
      WHERE ss.status = 'COMPLETED'
        AND (${where})
      GROUP BY ss.id, u.email, jt.name, s.name, o.name
      ORDER BY ss.ended_at DESC NULLS LAST
    `;

    const day = new Date().toISOString().slice(0, 10);
    const slug = summary ? 'portfolio-summary' : rollup ? 'portfolio' : 'sessions';
    const sessions = rows as unknown as ReportSession[];

    if (wantsPdf) {
      const pdf = summary
        ? rollupSummaryToPdf(sessions)
        : rollup
          ? rollupSessionsToPdf(sessions)
          : sessionsToPdf(sessions);
      // Hand the response a plain ArrayBuffer view of the PDF bytes — `BodyInit`
      // in the Next types doesn't list `Uint8Array`, and this stays Worker-safe
      // (no `Buffer`).
      const body = pdf.buffer.slice(
        pdf.byteOffset,
        pdf.byteOffset + pdf.byteLength
      ) as ArrayBuffer;
      return new NextResponse(body, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="xpelevator-${slug}-${day}.pdf"`,
          // Reporting data is per-request and tenant-specific — never cache it.
          'Cache-Control': 'no-store',
        },
      });
    }

    const csv = summary
      ? rollupSummaryToCsv(sessions)
      : rollup
        ? rollupSessionsToCsv(sessions)
        : sessionsToCsv(sessions);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="xpelevator-${slug}-${day}.csv"`,
        // Reporting data is per-request and tenant-specific — never cache it.
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Failed to build sessions report:', msg);
    return NextResponse.json(
      { error: 'Failed to build report' },
      { status: 500 }
    );
  }
}
