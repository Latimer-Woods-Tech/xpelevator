
/**
 * GET    /api/orgs/[id]/members  — list members of an org
 * POST   /api/orgs/[id]/members  — invite a user by email (creates User record if new)
 * DELETE /api/orgs/[id]/members  — remove a user from the org (body: { userId })
 */
import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAuth, AuthError } from '@/lib/auth-api';


export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Require admin role for listing org members
    await requireAuth(request, 'ADMIN');

    const { id } = await params;
    const members = await sql`
      SELECT 
        id,
        email,
        name,
        role,
        created_at as "createdAt"
      FROM users
      WHERE org_id = ${id}
      ORDER BY created_at ASC
    `;
    return NextResponse.json(members);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Failed to list members:', error);
    return NextResponse.json({ error: 'Failed to list members' }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Require admin role for adding org members
    await requireAuth(request, 'ADMIN');

    const { id: orgId } = await params;
    const body = (await request.json()) as { email: string; name?: string; role?: string };

    if (!body.email?.trim()) {
      return NextResponse.json({ error: 'email is required' }, { status: 400 });
    }

    const email = body.email.trim().toLowerCase();
    const role = (body.role as 'ADMIN' | 'MEMBER') ?? 'MEMBER';
    
    // Upsert user — create if new, update orgId if existing
    const userRows = await sql`
      INSERT INTO users (id, email, name, org_id, role, created_at)
      VALUES (gen_random_uuid(), ${email}, ${body.name?.trim() ?? null}, ${orgId}, ${role}, NOW())
      ON CONFLICT (email) DO UPDATE
      SET 
        org_id = ${orgId},
        role = COALESCE(${body.role ?? null}, users.role)
      RETURNING id, email, name, org_id as "orgId", role, created_at as "createdAt"
    `;
    const user: any = userRows[0];

    return NextResponse.json(user, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Failed to add member:', error);
    return NextResponse.json({ error: 'Failed to add member' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Require admin role for removing org members
    await requireAuth(request, 'ADMIN');

    const { id: orgId } = await params;
    const { userId } = (await request.json()) as { userId: string };

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    // Verify user exists in this org
    const userRows = await sql`
      SELECT id FROM users WHERE id = ${userId} AND org_id = ${orgId}
    `;
    if (userRows.length === 0) {
      return NextResponse.json({ error: 'User not found in this org' }, { status: 404 });
    }

    // Remove org association (don't delete the user record)
    await sql`
      UPDATE users
      SET org_id = NULL
      WHERE id = ${userId}
    `;

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Failed to remove member:', error);
    return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 });
  }
}
