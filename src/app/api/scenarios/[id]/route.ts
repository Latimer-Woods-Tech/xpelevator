import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAuth, AuthError } from '@/lib/auth-api';


export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Require authentication for reading scenarios
    const { session } = await requireAuth();
    const userOrgId = session.user.orgId;

    const { id } = await params;
    const scenarios = await sql`
      SELECT 
        s.id,
        s.name,
        s.description,
        s.type,
        s.script,
        s.job_title_id as "jobTitleId",
        s.org_id as "orgId",
        s.created_at as "createdAt",
        json_build_object('id', jt.id, 'name', jt.name) as "jobTitle"
      FROM scenarios s
      LEFT JOIN job_titles jt ON jt.id = s.job_title_id
      WHERE s.id = ${id}
    `;
    if (scenarios.length === 0) {
      return NextResponse.json({ error: 'Scenario not found' }, { status: 404 });
    }
    const scenario: any = scenarios[0];
    // Multi-tenancy: verify user can access (same org or global)
    if (scenario.orgId && scenario.orgId !== userOrgId) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }
    return NextResponse.json(scenario);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[scenarios/[id]] GET failed:', error);
    return NextResponse.json({ error: 'Failed to fetch scenario' }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Require admin role for updating scenarios
    const { session } = await requireAuth(request, 'ADMIN');
    const userOrgId = session.user.orgId;

    const { id } = await params;

    // Verify ownership: must belong to user's org or be global
    const existingRows = await sql`
      SELECT org_id as "orgId" FROM scenarios WHERE id = ${id}
    `;
    if (existingRows.length === 0) {
      return NextResponse.json({ error: 'Scenario not found' }, { status: 404 });
    }
    const existing: any = existingRows[0];
    if (existing.orgId && existing.orgId !== userOrgId) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const body = await request.json();
    await sql`
      UPDATE scenarios
      SET 
        name = ${body.name},
        description = ${body.description ?? null},
        type = ${body.type},
        script = ${JSON.stringify(body.script ?? {})}
      WHERE id = ${id}
    `;
    
    // Fetch updated scenario with relations
    const scenarioRows = await sql`
      SELECT 
        s.id,
        s.name,
        s.description,
        s.type,
        s.script,
        s.job_title_id as "jobTitleId",
        s.org_id as "orgId",
        s.created_at as "createdAt",
        json_build_object('id', jt.id, 'name', jt.name) as "jobTitle"
      FROM scenarios s
      LEFT JOIN job_titles jt ON jt.id = s.job_title_id
      WHERE s.id = ${id}
    `;
    const scenario: any = scenarioRows[0];
    return NextResponse.json(scenario);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[scenarios/[id]] PUT failed:', error);
    return NextResponse.json({ error: 'Failed to update scenario' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Require admin role for deleting scenarios
    const { session } = await requireAuth(request, 'ADMIN');
    const userOrgId = session.user.orgId;

    const { id } = await params;

    // Verify ownership: must belong to user's org or be global
    const existingRows = await sql`
      SELECT org_id as "orgId" FROM scenarios WHERE id = ${id}
    `;
    if (existingRows.length === 0) {
      return NextResponse.json({ error: 'Scenario not found' }, { status: 404 });
    }
    const existing: any = existingRows[0];
    if (existing.orgId && existing.orgId !== userOrgId) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    await sql`DELETE FROM scenarios WHERE id = ${id}`;
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[scenarios/[id]] DELETE failed:', error);
    return NextResponse.json({ error: 'Failed to delete scenario' }, { status: 500 });
  }
}
