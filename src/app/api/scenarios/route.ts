import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAuth, getAuthOrNull, AuthError } from '@/lib/auth-api';


// GET /api/scenarios?jobTitleId=...
export async function GET(request: Request) {
  try {
    // Public read - optionally scoped to user's org if authenticated
    const authResult = await getAuthOrNull();
    const userOrgId = authResult?.session.user.orgId;

    const { searchParams } = new URL(request.url);
    const jobTitleId = searchParams.get('jobTitleId');

    // Multi-tenancy: show user's org scenarios + global ones
    // If not authenticated, only show global scenarios
    const scenarios = userOrgId
      ? jobTitleId
        ? await sql`
            SELECT 
              s.*,
              s.org_id as "orgId",
              s.job_title_id as "jobTitleId",
              s.type as "simulationType",
              s.created_at as "createdAt",
              jsonb_build_object(
                'id', jt.id,
                'name', jt.name
              ) as "jobTitle"
            FROM scenarios s
            LEFT JOIN job_titles jt ON jt.id = s.job_title_id
            WHERE (s.org_id = ${userOrgId} OR s.org_id IS NULL)
              AND s.job_title_id = ${jobTitleId}
            ORDER BY s.job_title_id ASC, s.name ASC
          `
        : await sql`
            SELECT 
              s.*,
              s.org_id as "orgId",
              s.job_title_id as "jobTitleId",
              s.type as "simulationType",
              s.created_at as "createdAt",
              jsonb_build_object(
                'id', jt.id,
                'name', jt.name
              ) as "jobTitle"
            FROM scenarios s
            LEFT JOIN job_titles jt ON jt.id = s.job_title_id
            WHERE s.org_id = ${userOrgId} OR s.org_id IS NULL
            ORDER BY s.job_title_id ASC, s.name ASC
          `
      : jobTitleId
        ? await sql`
            SELECT 
              s.*,
              s.org_id as "orgId",
              s.job_title_id as "jobTitleId",
              s.type as "simulationType",
              s.created_at as "createdAt",
              jsonb_build_object(
                'id', jt.id,
                'name', jt.name
              ) as "jobTitle"
            FROM scenarios s
            LEFT JOIN job_titles jt ON jt.id = s.job_title_id
            WHERE s.org_id IS NULL
              AND s.job_title_id = ${jobTitleId}
            ORDER BY s.job_title_id ASC, s.name ASC
          `
        : await sql`
            SELECT 
              s.*,
              s.org_id as "orgId",
              s.job_title_id as "jobTitleId",
              s.type as "simulationType",
              s.created_at as "createdAt",
              jsonb_build_object(
                'id', jt.id,
                'name', jt.name
              ) as "jobTitle"
            FROM scenarios s
            LEFT JOIN job_titles jt ON jt.id = s.job_title_id
            WHERE s.org_id IS NULL
            ORDER BY s.job_title_id ASC, s.name ASC
          `;

    return NextResponse.json(scenarios);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[scenarios] GET failed:', error);
    return NextResponse.json({ error: 'Failed to fetch scenarios' }, { status: 500 });
  }
}

// POST /api/scenarios
// Body: { jobTitleId, name, description?, type: 'PHONE'|'CHAT', script? }
export async function POST(request: Request) {
  try {
    // Require admin role for creating scenarios
    const { session } = await requireAuth(request, 'ADMIN');
    const userOrgId = session.user.orgId;

    const body = await request.json();

    if (!body.jobTitleId || !body.name || !body.type) {
      return NextResponse.json(
        { error: 'jobTitleId, name, and type are required' },
        { status: 400 }
      );
    }

    const [scenario] = await sql`
      INSERT INTO scenarios (
        job_title_id,
        name,
        description,
        type,
        script,
        org_id
      )
      VALUES (
        ${body.jobTitleId},
        ${body.name},
        ${body.description ?? null},
        ${body.type},
        ${JSON.stringify(body.script ?? {})},
        ${userOrgId}
      )
      RETURNING 
        id,
        job_title_id as "jobTitleId",
        name,
        description,
        type as "simulationType",
        script,
        org_id as "orgId",
        created_at as "createdAt"
    `;

    // Fetch job title separately
    const [jobTitle] = await sql`
      SELECT id, name
      FROM job_titles
      WHERE id = ${body.jobTitleId}
    `;

    return NextResponse.json({ ...scenario, jobTitle }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[scenarios] POST failed:', error);
    return NextResponse.json({ error: 'Failed to create scenario' }, { status: 500 });
  }
}
