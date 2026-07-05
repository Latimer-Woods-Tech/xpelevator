
import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAuth, AuthError } from '@/lib/auth-api';


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
    if (existing.orgId && existing.orgId !== userOrgId) {
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
    console.error('[jobs/[id]] PUT failed:', error);
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
    if (existing.orgId && existing.orgId !== userOrgId) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    await sql`DELETE FROM job_titles WHERE id = ${id}`;
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[jobs/[id]] DELETE failed:', error);
    return NextResponse.json({ error: 'Failed to delete job title' }, { status: 500 });
  }
}
