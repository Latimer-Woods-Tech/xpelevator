
/**
 * GET    /api/orgs/[id]/members  — list members of an org
 * POST   /api/orgs/[id]/members  — invite a user by email (creates User record if new)
 * DELETE /api/orgs/[id]/members  — remove a user from the org (body: { userId })
 */
import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAuth, AuthError } from '@/lib/auth-api';
import { canAccessOrg } from '@/lib/org-hierarchy';
import { getOrgGovernanceTarget } from '@/lib/org-guard';

// Per-caller, tenant-scoped governance surface — never cache a response.
export const dynamic = 'force-dynamic';
export const revalidate = 0;


export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Require admin role for listing org members
    const { session } = await requireAuth(request, 'ADMIN');

    const { id } = await params;

    // Tenant isolation (R-043): only an admin who governs this org may see its
    // roster — else a tenant admin could read another tenant's member emails.
    const target = await getOrgGovernanceTarget(id);
    if (!target) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }
    if (!canAccessOrg(target, session.user)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

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
    const { session } = await requireAuth(request, 'ADMIN');

    const { id: orgId } = await params;

    // Tenant isolation (R-043): only govern an org you own — else a tenant admin
    // could plant or reassign a user into another tenant's org (this upsert sets
    // org_id = the target org).
    const target = await getOrgGovernanceTarget(orgId);
    if (!target) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }
    if (!canAccessOrg(target, session.user)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const body = (await request.json()) as { email: string; name?: string; role?: string };

    if (!body.email?.trim()) {
      return NextResponse.json({ error: 'email is required' }, { status: 400 });
    }

    const email = body.email.trim().toLowerCase();
    const role = (body.role as 'ADMIN' | 'MEMBER') ?? 'MEMBER';

    // Cross-tenant member-hijack guard (R-043): the email-keyed upsert below sets
    // `org_id = <destination>`, so an EXISTING user is silently RELOCATED out of
    // whatever org they belong to. Governance was checked on the DESTINATION org
    // only — so without this, an operator/tenant admin could POST a user's email
    // and yank that user out of ANOTHER tenant's org (one the caller does not
    // govern) into their own: stealing the account and evicting the victim's
    // membership. Refuse to move a user whose CURRENT org the caller cannot
    // govern. Creating a new user, re-inviting a same-org user, adopting an
    // org-less user, or moving a user between orgs the caller DOES govern
    // (platform admin, or an operator among their own clients) all still pass.
    const existingRows = await sql`
      SELECT org_id as "orgId" FROM users WHERE email = ${email} LIMIT 1
    `;
    if (existingRows.length > 0) {
      const currentOrgId = (existingRows[0].orgId as string | null) ?? null;
      if (currentOrgId !== null && currentOrgId !== orgId) {
        const sourceOrg = await getOrgGovernanceTarget(currentOrgId);
        if (sourceOrg && !canAccessOrg(sourceOrg, session.user)) {
          return NextResponse.json(
            {
              error: 'That user already belongs to another organization',
              code: 'USER_IN_ANOTHER_ORG',
            },
            { status: 409 }
          );
        }
      }
    }

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
    const user = userRows[0] as {
      id: string;
      email: string;
      name: string | null;
      orgId: string;
      role: string;
      createdAt: string;
    };

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
    const { session } = await requireAuth(request, 'ADMIN');

    const { id: orgId } = await params;

    // Tenant isolation (R-043): only govern an org you own — else a tenant admin
    // could evict another tenant's members.
    const target = await getOrgGovernanceTarget(orgId);
    if (!target) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }
    if (!canAccessOrg(target, session.user)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

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
