
/**
 * GET  /api/orgs  — list all organizations (admin only)
 * POST /api/orgs  — create a new organization (admin only)
 */
import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAuth, AuthError } from '@/lib/auth-api';


export async function GET() {
  try {
    // Require admin role for listing organizations
    await requireAuth(undefined, 'ADMIN');

    const orgsRows = await sql`
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
    await requireAuth(request, 'ADMIN');

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
