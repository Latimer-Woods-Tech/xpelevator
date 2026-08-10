/**
 * Monthly LLM budget report — `GET /api/reports/budget`
 *
 * The observability side of #155's spend ceiling: where the caller's workspace
 * sits, month-to-date, against its seat-tier Groq-spend ceiling. It reads the
 * per-turn `usage` columns persisted on CUSTOMER reply rows (#218) for the
 * current calendar month, prices them via the pure `@/lib/cost` table, and
 * evaluates the total against the tier ceiling via pure `@/lib/budget` — the
 * same ceiling `POST /api/simulations` enforces at session start. An operator
 * uses it to see a `warn` before any trainee is turned away at `over`.
 *
 * Access mirrors the spend ledger (`/api/reports/spend`): ADMIN only, strictly
 * org-scoped. `requireAuth(request, 'ADMIN')` yields 401 for anon (also caught
 * by middleware) and 403 for a non-admin member; the query filters on the
 * admin's own `orgId`, so it can never surface another tenant's spend. An
 * org-less ADMIN (platform staff / test mode) sees only the null-org sessions
 * they own and is evaluated against the `chat` floor.
 *
 * The pricing/ceiling logic lives in the pure `@/lib/budget` + `@/lib/cost`
 * modules (unit-tested without a DB); this handler is a thin auth + query shell.
 */
import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAuth, AuthError } from '@/lib/auth-api';
import {
  summarizeSpend,
  evaluateBudget,
  type MonthlySpendGroup,
} from '@/lib/budget';
import { tierForPlan, type SeatTierId } from '@/lib/plans';
import { PRICING_AS_OF, PRICING_SOURCE, formatUsd } from '@/lib/cost';
import { errorFields, log, requestIdFrom } from '@/lib/log';

export async function GET(request: Request) {
  try {
    const { session } = await requireAuth(request, 'ADMIN');
    const orgId = session.user.orgId ?? null;

    // Resolve the workspace's seat tier from its persisted plan (unknown/absent
    // → the restrictive `chat` floor, per `tierForPlan`). A null-org admin has
    // no plan and is evaluated against the floor.
    let tier: SeatTierId = 'chat';
    if (orgId) {
      const planRows = await sql`
        SELECT plan FROM organizations WHERE id = ${orgId}
      `;
      tier = tierForPlan((planRows[0]?.plan as string | null) ?? null);
    }

    // Strict tenant scoping, identical doctrine to /api/reports/spend: an admin
    // sees only their own org's sessions; an org-less ADMIN sees only the
    // null-org sessions they OWN — never every self-registered user's spend.
    const where = orgId
      ? sql`ss.org_id = ${orgId}`
      : sql`ss.org_id IS NULL AND ss.user_id = ${session.user.id}`;

    // Month-to-date usage grouped by model, over the current calendar month.
    // `total_tokens IS NOT NULL` keeps only measured turns.
    const rows = await sql`
      SELECT
        cm.model                                     as "model",
        COALESCE(SUM(cm.prompt_tokens), 0)::int      as "promptTokens",
        COALESCE(SUM(cm.completion_tokens), 0)::int  as "completionTokens",
        COALESCE(SUM(cm.total_tokens), 0)::int       as "totalTokens"
      FROM simulation_sessions ss
      JOIN chat_messages cm ON cm.session_id = ss.id
      WHERE cm.total_tokens IS NOT NULL
        AND ss.created_at >= date_trunc('month', now())
        AND (${where})
      GROUP BY cm.model
    `;

    const summary = summarizeSpend(rows as unknown as MonthlySpendGroup[]);
    const budget = evaluateBudget(summary.costMicroUsd, tier);

    return NextResponse.json(
      {
        period: 'current-calendar-month',
        tier,
        budget,
        spend: {
          costMicroUsd: summary.costMicroUsd,
          cost: formatUsd(summary.costMicroUsd),
          totalTokens: summary.totalTokens,
          unpricedTokens: summary.unpricedTokens,
        },
        pricing: { source: PRICING_SOURCE, asOf: PRICING_AS_OF },
      },
      {
        status: 200,
        // Budget data is per-request and tenant-specific — never cache it.
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    const requestId = requestIdFrom(request.headers);
    log('error', 'reports.budget_failed', { requestId, ...errorFields(error) });
    return NextResponse.json(
      { error: 'Failed to build budget report' },
      { status: 500 },
    );
  }
}
