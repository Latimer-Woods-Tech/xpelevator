
import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAuth, AuthError } from '@/lib/auth-api';


export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Require admin role for updating criteria
    const { session } = await requireAuth(request, 'ADMIN');
    const userOrgId = session.user.orgId;

    const { id } = await params;

    // Verify ownership: must belong to user's org or be global
    const existingRows = await sql`
      SELECT org_id as "orgId" FROM criteria WHERE id = ${id}
    `;
    if (existingRows.length === 0) {
      return NextResponse.json({ error: 'Criteria not found' }, { status: 404 });
    }
    const existing: any = existingRows[0];
    if (existing.orgId && existing.orgId !== userOrgId) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const body = await request.json();
    await sql`
      UPDATE criteria
      SET 
        name = ${body.name},
        description = ${body.description},
        weight = ${body.weight},
        category = ${body.category},
        active = ${body.active}
      WHERE id = ${id}
    `;
    const criterionRows = await sql`
      SELECT 
        id,
        name,
        description,
        weight,
        category,
        active,
        org_id as "orgId",
        created_at as "createdAt"
      FROM criteria
      WHERE id = ${id}
    `;
    const criterion: any = criterionRows[0];
    return NextResponse.json(criterion);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Failed to update criteria:', error);
    return NextResponse.json({ error: 'Failed to update criteria' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Require admin role for deleting criteria
    const { session } = await requireAuth(request, 'ADMIN');
    const userOrgId = session.user.orgId;

    const { id } = await params;

    // Verify ownership: must belong to user's org or be global
    const existingRows = await sql`
      SELECT org_id as "orgId" FROM criteria WHERE id = ${id}
    `;
    if (existingRows.length === 0) {
      return NextResponse.json({ error: 'Criteria not found' }, { status: 404 });
    }
    const existing: any = existingRows[0];
    if (existing.orgId && existing.orgId !== userOrgId) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    await sql`DELETE FROM criteria WHERE id = ${id}`;
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Failed to delete criteria:', error);
    return NextResponse.json({ error: 'Failed to delete criteria' }, { status: 500 });
  }
}
