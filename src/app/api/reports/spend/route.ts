/**
 * LLM spend ledger — `GET /api/reports/spend`
 *
 * Returns the caller's-org (or a client's) per-session Groq token spend plus a
 * tenant total, as JSON. This is the aggregation half of #155's "no spend
 * ledger": it reads the per-turn `usage` columns persisted on CUSTOMER reply
 * rows (#218) and the `model` that generated each turn, prices them via the pure
 * `@/lib/cost` table, and folds them into a ledger via pure `@/lib/spend`. The
 * number it produces — Groq spend per session / per tenant — is the cost input
 * to the Phase-4 wholesale-seat margin (`wholesale price − Groq spend`).
 *
 * Access mirrors the manager reporting export (`/api/reports/sessions`): ADMIN
 * only, strictly org-scoped. `requireAuth(request, 'ADMIN')` yields 401 for anon
 * (also caught earlier by middleware) and 403 for a non-admin member; the query
 * filters on the admin's own `orgId`, so it can never surface another tenant's
 * spend.
 *
 * `?clientOrgId=<id>` lets an OPERATOR pull a specific CLIENT org beneath them
 * (the channel model's actual unit — an operator's own org runs no trainee
 * sessions). Access is authorized by the pure `canAccessOrgReport` (platform
 * admin: any org; operator admin: only a client they own; the org's own admin:
 * itself — never another operator's client → 403). An unknown id is 404.
 *
 * `?since=YYYY-MM-DD` / `?until=YYYY-MM-DD` bound the ledger to a window on the
 * session's `created_at` (when the spend was incurred, including sessions that
 * were abandoned before completion — they still cost tokens). Both are inclusive
 * UTC calendar dates; a malformed date or `since > until` is a 400. The window
 * only ever narrows the already-tenant-scoped set, so isolation is untouched.
 *
 * The aggregation/pricing logic lives in the pure `@/lib/spend` + `@/lib/cost`
 * modules (unit-tested without a DB); this handler is a thin auth + query shell.
 */
import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAuth, AuthError } from '@/lib/auth-api';
import { buildSpendLedger, type SpendTurnGroup } from '@/lib/spend';
import { canAccessOrgReport } from '@/lib/org-hierarchy';
import { parseReportWindow } from '@/lib/report-window';
import { errorFields, log, requestIdFrom } from '@/lib/log';

export async function GET(request: Request) {
  try {
    const { session } = await requireAuth(request, 'ADMIN');

    const params = new URL(request.url).searchParams;

    // Validate the `?since`/`?until` window before any scope work so a malformed
    // date is a clean 400 regardless of who is asking; absent bounds = all-time.
    const window = parseReportWindow(params);
    if (!window.ok) {
      return NextResponse.json({ error: window.error }, { status: 400 });
    }

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
          { status: 404 },
        );
      }
      const target = {
        id: targetRows[0].id as string,
        parentOrgId: (targetRows[0].parentOrgId as string | null) ?? null,
      };
      if (!canAccessOrgReport(target, session.user)) {
        return NextResponse.json(
          { error: 'You may only report on your own client organizations' },
          { status: 403 },
        );
      }
      orgId = target.id;
    }

    // Strict tenant scoping, identical doctrine to /api/reports/sessions: an
    // admin sees only their own org's sessions; an org-less ADMIN sees only the
    // null-org sessions they OWN (never every self-registered user's spend).
    let where = orgId
      ? sql`ss.org_id = ${orgId}`
      : sql`ss.org_id IS NULL AND ss.user_id = ${session.user.id}`;

    // Narrow by the window on when the spend was incurred (session created_at).
    // Composing onto the scope fragment can only shrink the authorized set.
    if (window.since) {
      where = sql`${where} AND ss.created_at >= ${window.since}`;
    }
    if (window.untilExclusive) {
      where = sql`${where} AND ss.created_at < ${window.untilExclusive}`;
    }

    // One row per (session, model): SUM the persisted per-turn usage across the
    // CUSTOMER reply rows that carry it. `total_tokens IS NOT NULL` keeps only
    // measured turns (pre-instrumentation/error turns contribute nothing).
    const rows = await sql`
      SELECT
        ss.id         as "sessionId",
        u.email       as "trainee",
        s.name        as "scenario",
        ss.created_at as "createdAt",
        cm.model      as "model",
        COALESCE(SUM(cm.prompt_tokens), 0)::int     as "promptTokens",
        COALESCE(SUM(cm.completion_tokens), 0)::int as "completionTokens",
        COALESCE(SUM(cm.total_tokens), 0)::int      as "totalTokens",
        COUNT(cm.id)::int                           as "turns"
      FROM simulation_sessions ss
      JOIN chat_messages cm ON cm.session_id = ss.id
      LEFT JOIN users     u ON u.id = ss.db_user_id
      LEFT JOIN scenarios s ON s.id = ss.scenario_id
      WHERE cm.total_tokens IS NOT NULL
        AND (${where})
      GROUP BY ss.id, u.email, s.name, ss.created_at, cm.model
      ORDER BY ss.created_at DESC NULLS LAST, ss.id, cm.model
    `;

    const ledger = buildSpendLedger(rows as unknown as SpendTurnGroup[]);

    return NextResponse.json(ledger, {
      status: 200,
      // Spend data is per-request and tenant-specific — never cache it.
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const requestId = requestIdFrom(request.headers);
    log('error', 'reports.spend_failed', { requestId, ...errorFields(error) });
    return NextResponse.json(
      { error: 'Failed to build spend ledger' },
      { status: 500 },
    );
  }
}
