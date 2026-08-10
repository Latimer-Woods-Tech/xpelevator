import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAuth, AuthError } from '@/lib/auth-api';
import { sanitizeSessionScenario } from '@/lib/scenario-safety';
import { canReadResource } from '@/lib/tenant-guard';
import { MAX_SESSIONS_PER_DAY, parsePagination } from '@/lib/limits';
import {
  planUnlocksModality,
  minimumTierForModality,
  tierForPlan,
  type SimulationType,
} from '@/lib/plans';
import {
  summarizeSpend,
  evaluateBudget,
  type MonthlySpendGroup,
} from '@/lib/budget';
import { errorFields, log, requestIdFrom } from '@/lib/log';

const SIMULATION_TYPES = ['CHAT', 'VOICE', 'PHONE'] as const;

// Start a new simulation session
export async function POST(request: Request) {
  const requestId = requestIdFrom(request.headers);
  try {
    // Require authentication to create sessions
    const authResult = await requireAuth();

    const body = await request.json();
    const { jobTitleId, scenarioId, type } = body;

    if (typeof jobTitleId !== 'string' || !jobTitleId || typeof scenarioId !== 'string' || !scenarioId) {
      return NextResponse.json({ error: 'jobTitleId and scenarioId are required' }, { status: 400 });
    }
    if (!SIMULATION_TYPES.includes(type)) {
      return NextResponse.json(
        { error: `type must be one of ${SIMULATION_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    // Use the authenticated user's DB ID if available
    const userId: string = authResult.session.user.id;
    const dbUserId: string | null = authResult.session.user.dbUserId ?? null;
    const orgId: string | null = authResult.session.user.orgId ?? null;

    // Tenant scope on create: the scenario and job title must be global or
    // belong to the caller's org — otherwise a session against another
    // tenant's scenario would leak its script through the session payload.
    const refRows = await sql`
      SELECT
        (SELECT org_id FROM scenarios WHERE id = ${scenarioId}) as "scenarioOrgId",
        (SELECT id FROM scenarios WHERE id = ${scenarioId}) as "scenarioExists",
        (SELECT org_id FROM job_titles WHERE id = ${jobTitleId}) as "jobOrgId",
        (SELECT id FROM job_titles WHERE id = ${jobTitleId}) as "jobExists",
        (SELECT plan FROM organizations WHERE id = ${orgId}) as "orgPlan"
    `;
    const refs = refRows[0] as {
      scenarioOrgId: string | null;
      scenarioExists: string | null;
      jobOrgId: string | null;
      jobExists: string | null;
      orgPlan: string | null;
    };
    if (!refs.scenarioExists || !refs.jobExists) {
      return NextResponse.json({ error: 'Scenario or job title not found' }, { status: 404 });
    }
    if (
      !canReadResource(refs.scenarioOrgId, orgId) ||
      !canReadResource(refs.jobOrgId, orgId)
    ) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Per-seat modality gating (issue #16, Phase 4). A tenant trainee may only
    // run the practice modalities their org's plan unlocks — the founder's
    // cumulative seat model (chat → +voice → +phone). CHAT is the floor of
    // every tier, so the core loop and the scoring canary are never blocked;
    // VOICE needs PRO+, PHONE needs ENTERPRISE. Platform staff (no org / test
    // mode) are ungated — gating applies to billed tenant trainees only.
    if (orgId && !planUnlocksModality(refs.orgPlan, type as SimulationType)) {
      const requiredTier = minimumTierForModality(type as SimulationType);
      return NextResponse.json(
        {
          error: `Your plan does not include ${type} practice`,
          code: 'MODALITY_LOCKED',
          modality: type,
          requiredTier: requiredTier.id,
        },
        { status: 403 }
      );
    }

    // Abuse guard: cap sessions per user per rolling 24h (each session drives
    // billable LLM traffic). DB-backed so it holds across Worker isolates.
    const countRows = await sql`
      SELECT COUNT(*)::int as "count"
      FROM simulation_sessions
      WHERE user_id = ${userId} AND created_at > NOW() - interval '24 hours'
    `;
    if ((countRows[0]?.count ?? 0) >= MAX_SESSIONS_PER_DAY) {
      return NextResponse.json(
        { error: 'Daily session limit reached — try again tomorrow' },
        { status: 429 }
      );
    }

    // Org-level monthly Groq-spend ceiling (#155 — "LLM cost is unbounded").
    // `MAX_SESSIONS_PER_DAY` above caps one user; this caps the whole tenant's
    // aggregate LLM cost this calendar month, the missing org-level bound. This
    // is a per-SESSION check (session start, not per turn), so it adds no cost
    // to the per-turn hot path Run 100 optimized. Runs only when an `orgId` is
    // present — platform staff / test mode (null org) are ungated, exactly like
    // the modality gate — and FAILS OPEN: any error reading the spend ledger
    // logs and allows the session, so a query hiccup never blocks a real
    // trainee. The ceiling is a generous runaway guard (`@/lib/budget`), far
    // above any real training workload; the block body carries no cost figures
    // (those live behind the ADMIN-only /api/reports/budget).
    if (orgId) {
      try {
        const spendRows = await sql`
          SELECT
            cm.model                                     as "model",
            COALESCE(SUM(cm.prompt_tokens), 0)::int      as "promptTokens",
            COALESCE(SUM(cm.completion_tokens), 0)::int  as "completionTokens",
            COALESCE(SUM(cm.total_tokens), 0)::int       as "totalTokens"
          FROM simulation_sessions ss
          JOIN chat_messages cm ON cm.session_id = ss.id
          WHERE ss.org_id = ${orgId}
            AND cm.total_tokens IS NOT NULL
            AND ss.created_at >= date_trunc('month', now())
          GROUP BY cm.model
        `;
        const summary = summarizeSpend(
          spendRows as unknown as MonthlySpendGroup[],
        );
        const budget = evaluateBudget(
          summary.costMicroUsd,
          tierForPlan(refs.orgPlan),
        );
        if (budget.status === 'over') {
          return NextResponse.json(
            {
              error:
                'Monthly usage ceiling reached for this workspace — it resets at the start of next month',
              code: 'BUDGET_EXCEEDED',
            },
            { status: 429 }
          );
        }
      } catch (budgetError) {
        // Fail OPEN: a spend-ledger read failure must never block a legitimate
        // session. Log and continue to session creation.
        log('error', 'simulations.budget_check_failed_open', {
          requestId,
          ...errorFields(budgetError),
        });
      }
    }

    // Create session using raw SQL (compatible with Cloudflare Workers)
    const created = await sql`
      INSERT INTO simulation_sessions (
        id, job_title_id, scenario_id, type, status,
        user_id, db_user_id, org_id, started_at
      ) VALUES (
        gen_random_uuid(), ${jobTitleId}, ${scenarioId}, ${type}, 'IN_PROGRESS',
        ${userId}, ${dbUserId}, ${orgId}, NOW()
      )
      RETURNING 
        id,
        org_id as "orgId",
        user_id as "userId",
        db_user_id as "dbUserId",
        job_title_id as "jobTitleId",
        scenario_id as "scenarioId",
        type,
        status,
        started_at as "startedAt",
        ended_at as "endedAt",
        created_at as "createdAt"
    `;

    // Fetch with relations
    const newSession = await sql`
      SELECT 
        ss.id,
        ss.org_id as "orgId",
        ss.user_id as "userId",
        ss.db_user_id as "dbUserId",
        ss.job_title_id as "jobTitleId",
        ss.scenario_id as "scenarioId",
        ss.type,
        ss.status,
        ss.started_at as "startedAt",
        ss.ended_at as "endedAt",
        ss.created_at as "createdAt",
        json_build_object(
          'id', s.id,
          'name', s.name,
          'description', s.description,
          'type', s.type,
          'script', s.script
        ) as scenario,
        json_build_object(
          'id', jt.id,
          'name', jt.name,
          'description', jt.description
        ) as "jobTitle"
      FROM simulation_sessions ss
      LEFT JOIN scenarios s ON s.id = ss.scenario_id
      LEFT JOIN job_titles jt ON jt.id = ss.job_title_id
      WHERE ss.id = ${created[0].id}
    `;

    const isAdmin = authResult.session.user.role === 'ADMIN';
    return NextResponse.json(
      sanitizeSessionScenario(newSession[0], isAdmin),
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const msg = error instanceof Error ? error.message : String(error);
    log('error', 'simulations.create_failed', { requestId, ...errorFields(error) });
    return NextResponse.json(
      { error: 'Failed to create simulation', detail: process.env.NODE_ENV !== 'production' ? msg : undefined },
      { status: 500 }
    );
  }
}

// List simulation sessions
export async function GET(request: Request) {
  const requestId = requestIdFrom(request.headers);
  try {
    // Require authentication to list sessions
    const authResult = await requireAuth();

    // User sees only their own sessions (or org sessions if admin)
    const userId = authResult.session.user.id;
    const userRole = authResult.session.user.role;
    const orgId = authResult.session.user.orgId;

    // Bounded pagination (P3b-2): this list was previously unbounded. `?limit=`
    // (max 100) and `?offset=` cap the scan.
    const { limit, offset } = parsePagination(new URL(request.url).searchParams);

    // Admins can see all sessions in their org; members see only their own
    const sessions = userRole === 'ADMIN' && orgId
      ? await sql`
          SELECT 
            ss.id,
            ss.org_id as "orgId",
            ss.user_id as "userId",
            ss.db_user_id as "dbUserId",
            ss.job_title_id as "jobTitleId",
            ss.scenario_id as "scenarioId",
            ss.type,
            ss.status,
            ss.started_at as "startedAt",
            ss.ended_at as "endedAt",
            ss.created_at as "createdAt",
            json_build_object(
              'id', s.id,
              'name', s.name,
              'description', s.description,
              'type', s.type,
              'script', s.script
            ) as scenario,
            json_build_object(
              'id', jt.id,
              'name', jt.name,
              'description', jt.description
            ) as "jobTitle",
            COALESCE(
              json_agg(
                json_build_object(
                  'id', sc.id,
                  'score', sc.score,
                  'feedback', sc.feedback,
                  'criteria', json_build_object(
                    'id', c.id,
                    'name', c.name,
                    'description', c.description,
                    'weight', c.weight,
                    'category', c.category
                  )
                ) ORDER BY sc.scored_at
              ) FILTER (WHERE sc.id IS NOT NULL),
              '[]'
            ) as scores
          FROM simulation_sessions ss
          LEFT JOIN scenarios s ON s.id = ss.scenario_id
          LEFT JOIN job_titles jt ON jt.id = ss.job_title_id
          LEFT JOIN scores sc ON sc.session_id = ss.id
          LEFT JOIN criteria c ON c.id = sc.criteria_id
          WHERE ss.org_id = ${orgId}
          GROUP BY ss.id, s.id, jt.id
          ORDER BY ss.created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `
      : await sql`
          SELECT 
            ss.id,
            ss.org_id as "orgId",
            ss.user_id as "userId",
            ss.db_user_id as "dbUserId",
            ss.job_title_id as "jobTitleId",
            ss.scenario_id as "scenarioId",
            ss.type,
            ss.status,
            ss.started_at as "startedAt",
            ss.ended_at as "endedAt",
            ss.created_at as "createdAt",
            json_build_object(
              'id', s.id,
              'name', s.name,
              'description', s.description,
              'type', s.type,
              'script', s.script
            ) as scenario,
            json_build_object(
              'id', jt.id,
              'name', jt.name,
              'description', jt.description
            ) as "jobTitle",
            COALESCE(
              json_agg(
                json_build_object(
                  'id', sc.id,
                  'score', sc.score,
                  'feedback', sc.feedback,
                  'criteria', json_build_object(
                    'id', c.id,
                    'name', c.name,
                    'description', c.description,
                    'weight', c.weight,
                    'category', c.category
                  )
                ) ORDER BY sc.scored_at
              ) FILTER (WHERE sc.id IS NOT NULL),
              '[]'
            ) as scores
          FROM simulation_sessions ss
          LEFT JOIN scenarios s ON s.id = ss.scenario_id
          LEFT JOIN job_titles jt ON jt.id = ss.job_title_id
          LEFT JOIN scores sc ON sc.session_id = ss.id
          LEFT JOIN criteria c ON c.id = sc.criteria_id
          WHERE ss.user_id = ${userId}
          GROUP BY ss.id, s.id, jt.id
          ORDER BY ss.created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;

    const isAdmin = userRole === 'ADMIN';
    const safe = (sessions as Array<{ scenario?: unknown }>).map((s) =>
      sanitizeSessionScenario(s, isAdmin)
    );
    return NextResponse.json(safe);
  } catch (error) {
    log('error', 'simulations.get_failed', { requestId, ...errorFields(error) });
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const msg = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json(
      { 
        error: 'Failed to list simulations', 
        detail: process.env.NODE_ENV !== 'production' ? msg : undefined,
        stack: process.env.NODE_ENV !== 'production' ? stack : undefined
      },
      { status: 500 }
    );
  }
}
