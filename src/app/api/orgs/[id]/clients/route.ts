/**
 * GET  /api/orgs/[id]/clients  — list the CLIENT orgs beneath operator [id]
 * POST /api/orgs/[id]/clients  — create a CLIENT org beneath operator [id]
 *
 * The operator→client hierarchy foundation (issue #16, Phase 4). An OPERATOR org
 * owns CLIENT orgs; this is the channel model where an operator manages client
 * workspaces beneath them.
 *
 * Security + tenancy:
 *   - ADMIN only (`requireAuth(_, ADMIN)`): anon → 401 (middleware + handler),
 *     non-admin → 403.
 *   - Strictly scoped by `canManageOrgClients`: a platform admin (no org) may
 *     manage any operator; an operator admin may manage ONLY their own operator
 *     org's clients — never another operator's (cross-tenant → 403).
 *   - The parent [id] must exist (404) and must not itself be a CLIENT (409):
 *     the hierarchy is deliberately two levels (operator → client).
 *
 * Creating the first client promotes a STANDALONE parent to OPERATOR. Wholesale
 * billing / Stripe Connect and white-label branding are later, founder-gated
 * slices — this ships only the data-model + management API foundation.
 */
import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAuth, AuthError } from '@/lib/auth-api';
import { canManageOrgClients, slugify, suffixSlug } from '@/lib/org-hierarchy';

interface ClientRow {
  id: string;
  name: string;
  slug: string;
  plan: string;
  kind: string;
  parentOrgId: string | null;
  createdAt: string;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { session } = await requireAuth(request, 'ADMIN');
    const { id } = await params;

    if (!canManageOrgClients(id, session.user)) {
      return NextResponse.json(
        { error: 'You may only manage your own operator org' },
        { status: 403 }
      );
    }

    const parent = await sql`SELECT id FROM organizations WHERE id = ${id}`;
    if (parent.length === 0) {
      return NextResponse.json({ error: 'Operator org not found' }, { status: 404 });
    }

    const rows = await sql`
      SELECT
        o.id,
        o.name,
        o.slug,
        o.plan,
        o.kind,
        o.parent_org_id as "parentOrgId",
        o.created_at as "createdAt",
        COUNT(DISTINCT u.id) as "_count.users",
        COUNT(DISTINCT ss.id) as "_count.sessions"
      FROM organizations o
      LEFT JOIN users u ON u.org_id = o.id
      LEFT JOIN simulation_sessions ss ON ss.org_id = o.id
      WHERE o.parent_org_id = ${id}
      GROUP BY o.id
      ORDER BY o.created_at DESC
    `;

    const clients = rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      plan: row.plan,
      kind: row.kind,
      parentOrgId: row.parentOrgId,
      createdAt: row.createdAt,
      _count: {
        users: Number(row['_count.users']),
        sessions: Number(row['_count.sessions']),
      },
    }));

    return NextResponse.json(clients);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Failed to list client orgs:', error);
    return NextResponse.json({ error: 'Failed to list client orgs' }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { session } = await requireAuth(request, 'ADMIN');
    const { id } = await params;

    if (!canManageOrgClients(id, session.user)) {
      return NextResponse.json(
        { error: 'You may only manage your own operator org' },
        { status: 403 }
      );
    }

    let body: { name?: unknown; slug?: unknown };
    try {
      body = (await request.json()) as { name?: unknown; slug?: unknown };
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    // Parent must exist and must not itself be a CLIENT (two-level hierarchy).
    const parentRows = await sql`SELECT id, kind FROM organizations WHERE id = ${id}`;
    if (parentRows.length === 0) {
      return NextResponse.json({ error: 'Operator org not found' }, { status: 404 });
    }
    if (parentRows[0].kind === 'CLIENT') {
      return NextResponse.json(
        { error: 'A client org cannot own client orgs' },
        { status: 409 }
      );
    }

    // Promote a STANDALONE parent to OPERATOR (idempotent — a no-op if already
    // OPERATOR). Done before the insert so the parent's role is correct even if
    // a caller races two creates.
    await sql`
      UPDATE organizations SET kind = 'OPERATOR'
      WHERE id = ${id} AND kind = 'STANDALONE'
    `;

    // Global-unique slug: try the requested/derived slug, then fall back to a
    // suffixed variant on conflict. ON CONFLICT DO NOTHING avoids a race throw.
    const requested =
      typeof body.slug === 'string' && body.slug.trim()
        ? slugify(body.slug)
        : slugify(name);
    const base = requested || 'client';

    let created: ClientRow | undefined;
    for (let attempt = 0; attempt < 4 && !created; attempt++) {
      const candidate = attempt === 0 ? base : suffixSlug(base, crypto.randomUUID());
      const inserted = await sql`
        INSERT INTO organizations (id, name, slug, kind, parent_org_id, created_at)
        VALUES (gen_random_uuid()::text, ${name}, ${candidate}, 'CLIENT', ${id}, now())
        ON CONFLICT (slug) DO NOTHING
        RETURNING id, name, slug, plan, kind, parent_org_id as "parentOrgId", created_at as "createdAt"
      `;
      if (inserted.length > 0) created = inserted[0] as ClientRow;
    }

    if (!created) {
      return NextResponse.json(
        { error: 'Could not allocate a unique slug for the client org' },
        { status: 409 }
      );
    }

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Failed to create client org:', error);
    return NextResponse.json({ error: 'Failed to create client org' }, { status: 500 });
  }
}
