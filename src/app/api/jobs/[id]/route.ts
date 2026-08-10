
import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAuth, AuthError } from '@/lib/auth-api';
import { canMutateResource } from '@/lib/tenant-guard';
import { errorFields, log, requestIdFrom } from '@/lib/log';


export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Require admin role for updating job titles
    const { session } = await requireAuth(request, 'ADMIN');
    const userOrgId = session.user.orgId;

    const { id } = await params;

    // Verify ownership: must belong to user's org or be global
    const existingRows = await sql`
      SELECT org_id as "orgId" FROM job_titles WHERE id = ${id}
    `;
    if (existingRows.length === 0) {
      return NextResponse.json({ error: 'Job title not found' }, { status: 404 });
    }
    const existing: any = existingRows[0];
    // Same-org only; global (null-org) rows are the shared catalog and are
    // mutable only by platform (null-org) admins — never by tenant admins.
    if (!canMutateResource(existing.orgId, userOrgId)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const body = await request.json();
    await sql`
      UPDATE job_titles
      SET 
        name = ${body.name},
        description = ${body.description ?? null}
      WHERE id = ${id}
    `;
    const jobTitleRows = await sql`
      SELECT 
        id,
        name,
        description,
        org_id as "orgId",
        created_at as "createdAt"
      FROM job_titles
      WHERE id = ${id}
    `;
    const jobTitle: any = jobTitleRows[0];
    return NextResponse.json(jobTitle);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const requestId = requestIdFrom(request.headers);
    log('error', 'jobs.update_failed', { requestId, ...errorFields(error) });
    return NextResponse.json({ error: 'Failed to update job title' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Require admin role for deleting job titles
    const { session } = await requireAuth(request, 'ADMIN');
    const userOrgId = session.user.orgId;

    const { id } = await params;

    // Verify ownership: must belong to user's org or be global
    const existingRows = await sql`
      SELECT org_id as "orgId" FROM job_titles WHERE id = ${id}
    `;
    if (existingRows.length === 0) {
      return NextResponse.json({ error: 'Job title not found' }, { status: 404 });
    }
    const existing: any = existingRows[0];
    // Same-org only; global (null-org) rows are the shared catalog and are
    // mutable only by platform (null-org) admins — never by tenant admins.
    if (!canMutateResource(existing.orgId, userOrgId)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    await sql`DELETE FROM job_titles WHERE id = ${id}`;
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const requestId = requestIdFrom(request.headers);
    log('error', 'jobs.delete_failed', { requestId, ...errorFields(error) });
    return NextResponse.json({ error: 'Failed to delete job title' }, { status: 500 });
  }
}
