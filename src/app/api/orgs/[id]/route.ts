
/**
 * GET    /api/orgs/[id]  — get organization details with member count
 * PUT    /api/orgs/[id]  — update org name / plan
 * DELETE /api/orgs/[id]  — delete organization (only if no sessions)
 */
import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAuth, AuthError } from '@/lib/auth-api';
import { canAccessOrg, canSetOrgPlan, canDeleteOrg } from '@/lib/org-hierarchy';
import { getOrgGovernanceTarget } from '@/lib/org-guard';
import { isOrgPlan } from '@/lib/plans';

// Per-caller, tenant-scoped governance surface — never cache a response.
export const dynamic = 'force-dynamic';
export const revalidate = 0;


export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Require admin role for viewing org details
    const { session } = await requireAuth(request, 'ADMIN');

    const { id } = await params;

    // Tenant isolation (R-043): the org must exist and the caller must govern
    // it — their own org, a client org they own, or platform admin. Otherwise a
    // tenant admin could read another tenant's member roster (emails, roles).
    const target = await getOrgGovernanceTarget(id);
    if (!target) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }
    if (!canAccessOrg(target, session.user)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

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
    const { session } = await requireAuth(request, 'ADMIN');

    const { id } = await params;

    // Tenant isolation (R-043): only govern an org you own — else a tenant
    // admin could rename or re-plan another tenant's org.
    const target = await getOrgGovernanceTarget(id);
    if (!target) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }
    if (!canAccessOrg(target, session.user)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const body = (await request.json()) as { name?: string; plan?: string };

    // `plan` is the seat-tier source of truth every entitlement gate reads, so
    // changing it is authorized more narrowly than a rename: `canAccessOrg`
    // (above) lets an org's own admin edit `name`, but only a platform admin or
    // the parent operator may set `plan`. Without this an org's own admin could
    // self-upgrade (FREE → ENTERPRISE) and unlock paid VOICE/PHONE seats for
    // free. Validate the value too, so a garbage tier never lands in the column.
    if (body.plan != null) {
      if (!isOrgPlan(body.plan)) {
        return NextResponse.json(
          { error: 'Invalid plan', code: 'INVALID_PLAN' },
          { status: 400 }
        );
      }
      if (!canSetOrgPlan(target, session.user)) {
        return NextResponse.json(
          { error: 'You may not change this org’s plan', code: 'PLAN_CHANGE_FORBIDDEN' },
          { status: 403 }
        );
      }
    }

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
    const { session } = await requireAuth(request, 'ADMIN');

    const { id } = await params;

    // Tenant isolation (R-043): only delete an org you own — else a tenant
    // admin could delete another tenant's (session-free) org outright.
    const target = await getOrgGovernanceTarget(id);
    if (!target) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }
    if (!canAccessOrg(target, session.user)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Deletion is authorized more narrowly than the rename `canAccessOrg` allows
    // (same split as `plan`, R-043): only a platform admin or the parent
    // operator may delete an org. An org's OWN admin — including a CLIENT org's
    // admin — may NOT self-delete the workspace an operator provisioned and pays
    // wholesale seats for. Without this a downstream client could destroy the
    // upstream operator's provisioned asset (seats, branding, scenario library).
    if (!canDeleteOrg(target, session.user)) {
      return NextResponse.json(
        { error: 'You may not delete this org', code: 'ORG_DELETE_FORBIDDEN' },
        { status: 403 }
      );
    }

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
