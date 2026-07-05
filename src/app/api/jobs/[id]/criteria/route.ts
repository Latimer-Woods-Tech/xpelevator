import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAuth, AuthError } from '@/lib/auth-api';


// GET /api/jobs/[id]/criteria — list all criteria linked to a job title
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Require authentication for reading job criteria
    await requireAuth();

    const { id } = await params;
    const criteriaRows = await sql`
      SELECT 
        c.id,
        c.name,
        c.description,
        c.org_id as "orgId",
        c.created_at as "createdAt"
      FROM job_criteria jc
      INNER JOIN criteria c ON c.id = jc.criteria_id
      WHERE jc.job_title_id = ${id}
      ORDER BY c.name ASC
    `;
    return NextResponse.json(criteriaRows);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[jobs/[id]/criteria] GET failed:', error);
    return NextResponse.json({ error: 'Failed to fetch criteria' }, { status: 500 });
  }
}

// POST /api/jobs/[id]/criteria — link a criterion to a job title
// Body: { criteriaId: string }
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Require admin role for linking criteria
    await requireAuth(request, 'ADMIN');

    const { id: jobTitleId } = await params;
    const body = await request.json();

    if (!body.criteriaId) {
      return NextResponse.json({ error: 'criteriaId is required' }, { status: 400 });
    }

    // Check if link already exists
    const existingRows = await sql`
      SELECT job_title_id as "jobTitleId", criteria_id as "criteriaId"
      FROM job_criteria
      WHERE job_title_id = ${jobTitleId} AND criteria_id = ${body.criteriaId}
    `;
    
    if (existingRows.length === 0) {
      // Create new link
      await sql`
        INSERT INTO job_criteria (id, job_title_id, criteria_id)
        VALUES (gen_random_uuid(), ${jobTitleId}, ${body.criteriaId})
      `;
    }
    
    // Return the link (existing or new)
    const linkRows = await sql`
      SELECT job_title_id as "jobTitleId", criteria_id as "criteriaId"
      FROM job_criteria
      WHERE job_title_id = ${jobTitleId} AND criteria_id = ${body.criteriaId}
    `;
    const link: any = linkRows[0];
    return NextResponse.json(link, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[jobs/[id]/criteria] POST failed:', error);
    return NextResponse.json({ error: 'Failed to link criteria' }, { status: 500 });
  }
}

// DELETE /api/jobs/[id]/criteria — unlink all or a specific criterion
// Body: { criteriaId: string }
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Require admin role for unlinking criteria
    await requireAuth(request, 'ADMIN');

    const { id: jobTitleId } = await params;
    const body = await request.json().catch(() => ({}));

    if (body.criteriaId) {
      await sql`
        DELETE FROM job_criteria
        WHERE job_title_id = ${jobTitleId} AND criteria_id = ${body.criteriaId}
      `;
    } else {
      // Remove all criteria links for this job
      await sql`DELETE FROM job_criteria WHERE job_title_id = ${jobTitleId}`;
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[jobs/[id]/criteria] DELETE failed:', error);
    return NextResponse.json({ error: 'Failed to unlink criteria' }, { status: 500 });
  }
}
