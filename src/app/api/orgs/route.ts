
/**
 * GET  /api/orgs  — list organizations the caller governs (admin only)
 * POST /api/orgs  — create a new top-level organization (platform admin only)
 *
 * Tenant isolation (issue #16, R-043 — the platform-super-admin vs tenant-admin
 * split deferred from Phase 2): both verbs are ADMIN-only, but ADMIN alone is
 * NOT enough. A PLATFORM admin (ADMIN with no org) governs the whole platform;
 * a tenant/operator admin is scoped to their own org and the CLIENT orgs beneath
 * them. Listing every tenant's org (with member/session counts) to any tenant
 * admin was a cross-tenant leak; minting arbitrary top-level orgs was a
 * cross-tenant write. Operators create client orgs via `/api/orgs/[id]/clients`.
 */
import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAuth, AuthError } from '@/lib/auth-api';
import { isPlatformAdmin } from '@/lib/org-hierarchy';


export async function GET() {
  try {
    // Require admin role for listing organizations
    const { session } = await requireAuth(undefined, 'ADMIN');
    const viewerOrg = session.user.orgId ?? null;

    // Scope the list: a platform admin (no org) sees every org; a tenant/
    // operator admin sees only their OWN org and the CLIENT orgs beneath them
    // (parent_org_id = their org) — never another tenant's.
    const orgsRows = isPlatformAdmin(session.user)
      ? await sql`
          SELECT
            o.id,
            o.name,
            o.slug,
            o.plan,
            o.created_at as "createdAt",
            COUNT(DISTINCT u.id) as "_count.users",
            COUNT(DISTINCT ss.id) as "_count.sessions"
          FROM organizations o
          LEFT JOIN users u ON u.org_id = o.id
          LEFT JOIN simulation_sessions ss ON ss.org_id = o.id
          GROUP BY o.id
          ORDER BY o.created_at DESC
        `
      : await sql`
          SELECT
            o.id,
            o.name,
            o.slug,
            o.plan,
            o.created_at as "createdAt",
            COUNT(DISTINCT u.id) as "_count.users",
            COUNT(DISTINCT ss.id) as "_count.sessions"
          FROM organizations o
          LEFT JOIN users u ON u.org_id = o.id
          LEFT JOIN simulation_sessions ss ON ss.org_id = o.id
          WHERE o.id = ${viewerOrg} OR o.parent_org_id = ${viewerOrg}
          GROUP BY o.id
          ORDER BY o.created_at DESC
        `;

    // Transform the flat structure to match Prisma's _count pattern
    const orgs = orgsRows.map((row: any) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      plan: row.plan,
      createdAt: row.createdAt,
      _count: {
        users: Number(row['_count.users']),
        sessions: Number(row['_count.sessions'])
      }
    }));
    return NextResponse.json(orgs);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Failed to list organizations:', error);
    return NextResponse.json({ error: 'Failed to list organizations' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    // Require admin role for creating organizations
    const { session } = await requireAuth(request, 'ADMIN');

    // Minting a NEW top-level org is a platform operation. A tenant/operator
    // admin must not create free-standing orgs (they add CLIENT orgs beneath
    // themselves via /api/orgs/[id]/clients, which is scoped by ownership).
    if (!isPlatformAdmin(session.user)) {
      return NextResponse.json(
        {
          error:
            'Only a platform admin may create a top-level organization; operators add client orgs via /api/orgs/[id]/clients',
        },
        { status: 403 }
      );
    }

    const body = (await request.json()) as { name: string; slug?: string };

    if (!body.name?.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    // Auto-generate slug if not provided
    const slug =
      body.slug?.trim() ??
      body.name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

    const orgRows = await sql`
      INSERT INTO organizations (id, name, slug, created_at)
      VALUES (gen_random_uuid(), ${body.name.trim()}, ${slug}, NOW())
      RETURNING id, name, slug, plan, created_at as "createdAt"
    `;
    const org: any = orgRows[0];

    return NextResponse.json(org, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Failed to create organization:', error);
    return NextResponse.json({ error: 'Failed to create organization' }, { status: 500 });
  }
}
