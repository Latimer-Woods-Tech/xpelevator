/**
 * Seat metering — `GET /api/reports/seats`
 *
 * The automated "how many seats did this book consume?" measurement that Phase 4
 * item 2 (wholesale seat billing, issue #16) invoices on. Returns the metered
 * INVOICE BASIS — distinct active trainees (billable seats), bucketed into their
 * billable tier (chat → +voice → +phone), per client org and summed across the
 * operator's portfolio — as machine-readable JSON the downstream Stripe wiring
 * consumes. It deliberately carries NO price: wholesale amounts are a founder
 * input that lives in Stripe (🔒 live-mode gate). This endpoint is pure metering,
 * left of that gate.
 *
 * Access mirrors the manager report (`/api/reports/sessions`) exactly, so it can
 * never widen tenant scope:
 *   - ADMIN only. `requireAuth(request, 'ADMIN')` → 401 anon, 403 non-admin.
 *   - Default: the admin's own org (an org-less admin meters only their own
 *     personal-workspace sessions — never a shared `org_id IS NULL` bucket).
 *   - `?clientOrgId=<id>` meters a specific CLIENT org beneath the caller,
 *     authorized by `canAccessOrgReport` (unknown id → 404, cross-operator → 403).
 *   - `?scope=clients` returns the operator PORTFOLIO roll-up — every client org
 *     beneath the operator — resolved + authorized by `resolveOperatorRollup`
 *     (platform admin must name `?operatorOrgId=`, else 400; cross-operator → 403).
 *   - `?since` / `?until` bound a billing window on the session completion date
 *     (`ended_at`), the operator's "monthly cut"; a malformed date or `since` past
 *     `until` is a 400 (`parseReportWindow`). The window only ever narrows the
 *     already-authorized set.
 *
 * The counting/bucketing rules live in the pure `@/lib/seat-metering` module
 * (unit-tested without a DB); this handler is a thin auth + query shell.
 */
import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAuth, AuthError } from '@/lib/auth-api';
import { canAccessOrgReport, resolveOperatorRollup } from '@/lib/org-hierarchy';
import { parseReportWindow } from '@/lib/report-window';
import { boundScan, MAX_REPORT_SESSIONS } from '@/lib/limits';
import { computeSeatUsage, type SeatUsageFact } from '@/lib/seat-metering';
import { errorFields, log, requestIdFrom } from '@/lib/log';

export async function GET(request: Request) {
  try {
    const { session } = await requireAuth(request, 'ADMIN');

    const params = new URL(request.url).searchParams;

    // `?since` / `?until` billing window. Validated before scope resolution so a
    // malformed date is a clean 400 regardless of who is asking.
    const window = parseReportWindow(params);
    if (!window.ok) {
      return NextResponse.json({ error: window.error }, { status: 400 });
    }

    // `?scope=clients` = the operator portfolio roll-up (all client orgs at once).
    const rollup = params.get('scope') === 'clients';

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
            : 'You may only meter your own client organizations';
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
            { error: 'You may only meter your own client organizations' },
            { status: 403 }
          );
        }
        orgId = target.id;
      }
      // Strict tenant scoping, identical to the manager report: an org-less
      // admin meters only the null-org sessions they OWN — never a shared
      // `org_id IS NULL` bucket (which would count every self-registered user).
      where = orgId
        ? sql`ss.org_id = ${orgId}`
        : sql`ss.org_id IS NULL AND ss.user_id = ${session.user.id}`;
    }

    // Narrow the (already tenant-scoped) filter by the billing window — this can
    // only ever shrink the authorized set, so isolation is untouched.
    if (window.since) {
      where = sql`${where} AND ss.ended_at >= ${window.since}`;
    }
    if (window.untilExclusive) {
      where = sql`${where} AND ss.ended_at < ${window.untilExclusive}`;
    }

    // One row per (org, trainee, modality) of COMPLETED sessions — far smaller
    // than a per-session scan (bounded by trainees × 3 modalities), yet still
    // capped as a runaway guard. `ss.user_id` is the stable trainee key.
    const rows = await sql`
      SELECT
        o.id        as "orgId",
        o.name      as "orgName",
        ss.user_id  as "traineeKey",
        ss.type     as "modality",
        COUNT(*)::int as "sessions"
      FROM simulation_sessions ss
      LEFT JOIN organizations o ON o.id = ss.org_id
      WHERE ss.status = 'COMPLETED'
        AND (${where})
      GROUP BY o.id, o.name, ss.user_id, ss.type
      ORDER BY "sessions" DESC
      LIMIT ${MAX_REPORT_SESSIONS + 1}
    `;

    const { rows: bounded, truncated } = boundScan(
      rows as unknown as SeatUsageFact[],
      MAX_REPORT_SESSIONS
    );

    const report = computeSeatUsage(bounded);

    return NextResponse.json(
      {
        window: { since: window.since, until: window.until },
        unit: 'seat',
        interval: 'month',
        ...report,
        truncated,
      },
      {
        status: 200,
        headers: {
          // Metering is per-request and tenant-specific — never cache it.
          'Cache-Control': 'no-store',
          // Surface the runaway cap so it is never silent (Standing Law: no
          // silent caps). `true` means the usage set exceeded the scan cap.
          'X-Report-Truncated': String(truncated),
        },
      }
    );
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const requestId = requestIdFrom(request.headers);
    log('error', 'reports.seats_failed', { requestId, ...errorFields(error) });
    return NextResponse.json(
      { error: 'Failed to build seat metering' },
      { status: 500 }
    );
  }
}
