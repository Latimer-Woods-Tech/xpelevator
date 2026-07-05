
/**
 * GET    /api/orgs/[id]  — get organization details with member count
 * PUT    /api/orgs/[id]  — update org name / plan
 * DELETE /api/orgs/[id]  — delete organization (only if no sessions)
 */
import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAuth, AuthError } from '@/lib/auth-api';


export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Require admin role for viewing org details
    await requireAuth(request, 'ADMIN');

    const { id } = await params;
    const orgRows = await sql`
      SELECT 
        o.id,
        o.name,
        o.slug,
        o.plan,
        o.created_at as "createdAt",
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'id', u.id,
              'email', u.email,
              'name', u.name,
              'role', u.role,
              'createdAt', u.created_at
            )
          ) FILTER (WHERE u.id IS NOT NULL),
          '[]'
        ) as users,
        COUNT(DISTINCT ss.id) as "_count.sessions",
        COUNT(DISTINCT jt.id) as "_count.jobTitles",
        COUNT(DISTINCT s.id) as "_count.scenarios"
      FROM organizations o
      LEFT JOIN users u ON u.org_id = o.id
      LEFT JOIN simulation_sessions ss ON ss.org_id = o.id
      LEFT JOIN job_titles jt ON jt.org_id = o.id
      LEFT JOIN scenarios s ON s.org_id = o.id
      WHERE o.id = ${id}
      GROUP BY o.id
    `;

    if (orgRows.length === 0) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }
    
    const orgData: any = orgRows[0];
    const org = {
      id: orgData.id,
      name: orgData.name,
      slug: orgData.slug,
      plan: orgData.plan,
      createdAt: orgData.createdAt,
      users: orgData.users,
      _count: {
        sessions: Number(orgData['_count.sessions']),
        jobTitles: Number(orgData['_count.jobTitles']),
        scenarios: Number(orgData['_count.scenarios'])
      }
    };

    return NextResponse.json(org);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Failed to get organization:', error);
    return NextResponse.json({ error: 'Failed to get organization' }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Require admin role for updating orgs
    await requireAuth(request, 'ADMIN');

    const { id } = await params;
    const body = (await request.json()) as { name?: string; plan?: string };

    await sql`
      UPDATE organizations
      SET 
        name = COALESCE(${body.name ?? null}, name),
        plan = COALESCE(${body.plan ?? null}, plan)
      WHERE id = ${id}
    `;
    
    const orgRows = await sql`
      SELECT 
        id,
        name,
        slug,
        plan,
        created_at as "createdAt"
      FROM organizations
      WHERE id = ${id}
    `;
    const org: any = orgRows[0];

    return NextResponse.json(org);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Failed to update organization:', error);
    return NextResponse.json({ error: 'Failed to update organization' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Require admin role for deleting orgs
    await requireAuth(request, 'ADMIN');

    const { id } = await params;

    // Safety check — refuse if org has sessions
    const countResult = await sql`
      SELECT COUNT(*) as count FROM simulation_sessions WHERE org_id = ${id}
    `;
    const sessionCount = Number(countResult[0].count);
    if (sessionCount > 0) {
      return NextResponse.json(
        { error: `Cannot delete: org has ${sessionCount} session(s)` },
        { status: 409 }
      );
    }

    await sql`DELETE FROM organizations WHERE id = ${id}`;
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Failed to delete organization:', error);
    return NextResponse.json({ error: 'Failed to delete organization' }, { status: 500 });
  }
}
