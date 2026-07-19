import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAuth, AuthError } from '@/lib/auth-api';
import { sanitizeScenarioScript } from '@/lib/scenario-safety';
import { canReadResource } from '@/lib/tenant-guard';


// GET /api/scenarios?jobTitleId=...
export async function GET(request: Request) {
  try {
    // Authenticated read, scoped to the caller's org. Non-admins receive a
    // script stripped of the scenario's hidden mechanics (persona / objective /
    // hints) — the admin UI promises trainees never see those.
    const { session } = await requireAuth();
    const userOrgId = session.user.orgId;
    const isAdmin = session.user.role === 'ADMIN';

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

    const safe = (scenarios as Array<Record<string, unknown>>).map((s) => ({
      ...s,
      script: sanitizeScenarioScript(s.script, isAdmin),
    }));

    return NextResponse.json(safe);
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

    // Tenant scope on the foreign key: the job title this scenario attaches to
    // must be visible to the caller (their own org or the global catalog).
    // Without this an org-A admin could attach a scenario to another tenant's
    // PRIVATE job title (a cross-tenant write that injects content into org B's
    // /api/jobs view). Mirrors the guard on POST /api/jobs/[id]/criteria and
    // POST /api/simulations. `canReadResource` (own-org OR global) — attaching
    // an org-scoped scenario under a shared/global job title is legitimate
    // authoring; the read side (/api/jobs) scopes what each tenant sees back.
    const jobRows = await sql`
      SELECT org_id as "orgId" FROM job_titles WHERE id = ${body.jobTitleId}
    `;
    if (jobRows.length === 0) {
      return NextResponse.json({ error: 'Job title not found' }, { status: 404 });
    }
    if (!canReadResource(jobRows[0].orgId as string | null, userOrgId)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const [scenario] = await sql`
      INSERT INTO scenarios (
        id,
        job_title_id,
        name,
        description,
        type,
        script,
        org_id
      )
      VALUES (
        gen_random_uuid(),
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
