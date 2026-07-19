import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAuth, AuthError } from '@/lib/auth-api';
import { canMutateResource, canReadResource } from '@/lib/tenant-guard';

/**
 * Loads a job title's org and enforces the tenant rule for link mutations:
 * the caller's org must own the job title (global job titles are only
 * manageable by platform/null-org admins). Returns a NextResponse error to
 * short-circuit with, or null when the caller may proceed.
 */
async function guardJobOwnership(
  jobTitleId: string,
  userOrgId: string | null | undefined
): Promise<NextResponse | null> {
  const jobRows = await sql`
    SELECT org_id as "orgId" FROM job_titles WHERE id = ${jobTitleId}
  `;
  if (jobRows.length === 0) {
    return NextResponse.json({ error: 'Job title not found' }, { status: 404 });
  }
  if (!canMutateResource(jobRows[0].orgId as string | null, userOrgId)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }
  return null;
}


// GET /api/jobs/[id]/criteria — list all criteria linked to a job title
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Authenticated read, scoped to the caller's org.
    const { session } = await requireAuth();
    const userOrgId = session.user.orgId;

    const { id } = await params;

    // Tenant isolation: the job title must be visible to the caller (their own
    // org or the global catalog). Without this an authenticated user in org A
    // (even a trainee/MEMBER) could enumerate org B's scoring rubric — the
    // linked criteria names/descriptions — by supplying another tenant's job
    // title id (a cross-tenant read IDOR).
    const jobRows = await sql`
      SELECT org_id as "orgId" FROM job_titles WHERE id = ${id}
    `;
    if (jobRows.length === 0) {
      return NextResponse.json({ error: 'Job title not found' }, { status: 404 });
    }
    if (!canReadResource(jobRows[0].orgId as string | null, userOrgId)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

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
    const { session } = await requireAuth(request, 'ADMIN');
    const userOrgId = session.user.orgId;

    const { id: jobTitleId } = await params;
    const body = await request.json();

    if (!body.criteriaId || typeof body.criteriaId !== 'string') {
      return NextResponse.json({ error: 'criteriaId is required' }, { status: 400 });
    }

    // The job title must belong to the caller's org — without this an org-A
    // admin could rewrite the scoring criteria of org-B's job titles.
    const denied = await guardJobOwnership(jobTitleId, userOrgId);
    if (denied) return denied;

    // The criterion being linked must be visible to the caller (own org or global).
    const criterionRows = await sql`
      SELECT org_id as "orgId" FROM criteria WHERE id = ${body.criteriaId}
    `;
    if (criterionRows.length === 0) {
      return NextResponse.json({ error: 'Criteria not found' }, { status: 404 });
    }
    if (!canReadResource(criterionRows[0].orgId as string | null, userOrgId)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
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
    const { session } = await requireAuth(request, 'ADMIN');
    const userOrgId = session.user.orgId;

    const { id: jobTitleId } = await params;

    // Same tenant rule as linking: only the org that owns the job title may
    // change which criteria it is scored against.
    const denied = await guardJobOwnership(jobTitleId, userOrgId);
    if (denied) return denied;

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
