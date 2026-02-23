import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { requireAuth, AuthError, getAuthOrNull } from '@/lib/auth-api';


// Start a new simulation session
export async function POST(request: Request) {
  try {
    // Require authentication to create sessions
    const authResult = await requireAuth();

    const body = await request.json();
    const { jobTitleId, scenarioId, type } = body;

    // Use the authenticated user's DB ID if available
    const userId: string = authResult.session.user.id;
    const dbUserId: string | null = authResult.session.user.dbUserId ?? null;
    const orgId: string | null = authResult.session.user.orgId ?? null;

    // Create session using raw SQL (compatible with Cloudflare Workers)
    const created = await sql`
      INSERT INTO simulation_sessions (
        job_title_id, scenario_id, type, status,
        user_id, db_user_id, org_id, started_at
      ) VALUES (
        ${jobTitleId}, ${scenarioId}, ${type}, 'IN_PROGRESS',
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

    return NextResponse.json(newSession[0], { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Failed to create simulation:', msg);
    return NextResponse.json(
      { error: 'Failed to create simulation', detail: process.env.NODE_ENV !== 'production' ? msg : undefined },
      { status: 500 }
    );
  }
}

// List simulation sessions
export async function GET(request: Request) {
  try {
    // Require authentication to list sessions
    const authResult = await requireAuth();

    const { searchParams } = new URL(request.url);

    // User sees only their own sessions (or org sessions if admin)
    const userId = authResult.session.user.id;
    const userRole = authResult.session.user.role;
    const orgId = authResult.session.user.orgId;

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
                ) ORDER BY sc.created_at
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
                ) ORDER BY sc.created_at
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
        `;

    return NextResponse.json(sessions);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Failed to list simulations:', msg);
    return NextResponse.json(
      { error: 'Failed to list simulations', detail: process.env.NODE_ENV !== 'production' ? msg : undefined },
      { status: 500 }
    );
  }
}
