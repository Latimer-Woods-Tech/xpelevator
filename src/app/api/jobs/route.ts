import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAuth, getAuthOrNull, AuthError } from '@/lib/auth-api';


export async function GET() {
  try {
    // Public read - optionally scoped to user's org if authenticated
    const authResult = await getAuthOrNull();
    const userOrgId = authResult?.session.user.orgId;

    // Multi-tenancy: show user's org job titles + global ones (orgId is null)
    // If not authenticated, only show global job titles
    const jobTitles = userOrgId
      ? await sql`
          SELECT 
            jt.id,
            jt.name,
            jt.description,
            jt.org_id as "orgId",
            jt.created_at as "createdAt",
            jt.updated_at as "updatedAt",
            COALESCE(
              json_agg(
                DISTINCT jsonb_build_object(
                  'id', s.id,
                  'title', s.title,
                  'persona', s.persona,
                  'jobTitleId', s.job_title_id,
                  'simulationType', s.simulation_type
                )
              ) FILTER (WHERE s.id IS NOT NULL),
              '[]'
            ) as scenarios,
            COALESCE(
              json_agg(
                DISTINCT jsonb_build_object(
                  'id', jc.id,
                  'jobTitleId', jc.job_title_id,
                  'criteriaId', jc.criteria_id,
                  'weight', jc.weight,
                  'criteria', jsonb_build_object(
                    'id', c.id,
                    'name', c.name,
                    'description', c.description,
                    'category', c.category
                  )
                )
              ) FILTER (WHERE jc.id IS NOT NULL),
              '[]'
            ) as "jobCriteria"
          FROM job_titles jt
          LEFT JOIN scenarios s ON s.job_title_id = jt.id
          LEFT JOIN job_criteria jc ON jc.job_title_id = jt.id
          LEFT JOIN criteria c ON c.id = jc.criteria_id
          WHERE jt.org_id = ${userOrgId} OR jt.org_id IS NULL
          GROUP BY jt.id
          ORDER BY jt.name ASC
        `
      : await sql`
          SELECT 
            jt.id,
            jt.name,
            jt.description,
            jt.org_id as "orgId",
            jt.created_at as "createdAt",
            jt.updated_at as "updatedAt",
            COALESCE(
              json_agg(
                DISTINCT jsonb_build_object(
                  'id', s.id,
                  'title', s.title,
                  'persona', s.persona,
                  'jobTitleId', s.job_title_id,
                  'simulationType', s.simulation_type
                )
              ) FILTER (WHERE s.id IS NOT NULL),
              '[]'
            ) as scenarios,
            COALESCE(
              json_agg(
                DISTINCT jsonb_build_object(
                  'id', jc.id,
                  'jobTitleId', jc.job_title_id,
                  'criteriaId', jc.criteria_id,
                  'weight', jc.weight,
                  'criteria', jsonb_build_object(
                    'id', c.id,
                    'name', c.name,
                    'description', c.description,
                    'category', c.category
                  )
                )
              ) FILTER (WHERE jc.id IS NOT NULL),
              '[]'
            ) as "jobCriteria"
          FROM job_titles jt
          LEFT JOIN scenarios s ON s.job_title_id = jt.id
          LEFT JOIN job_criteria jc ON jc.job_title_id = jt.id
          LEFT JOIN criteria c ON c.id = jc.criteria_id
          WHERE jt.org_id IS NULL
          GROUP BY jt.id
          ORDER BY jt.name ASC
        `;

    return NextResponse.json(jobTitles);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to fetch job titles:', message);
    return NextResponse.json(
      { error: 'Failed to fetch job titles', detail: message },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    // Require admin role for creating job titles
    const { session } = await requireAuth(request, 'ADMIN');
    const userOrgId = session.user.orgId;

    const body = await request.json();
    const [jobTitle] = await sql`
      INSERT INTO job_titles (name, description, org_id)
      VALUES (${body.name}, ${body.description}, ${userOrgId})
      RETURNING 
        id,
        name,
        description,
        org_id as "orgId",
        created_at as "createdAt",
        updated_at as "updatedAt"
    `;
    return NextResponse.json(jobTitle, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to create job title:', message);
    return NextResponse.json(
      {
        error: 'Failed to create job title',
        detail: process.env.NODE_ENV !== 'production' ? message : undefined,
      },
      { status: 500 }
    );
  }
}

