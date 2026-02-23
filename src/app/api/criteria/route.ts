import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAuth, getAuthOrNull, AuthError } from '@/lib/auth-api';


export async function GET() {
  try {
    // Public read - optionally scoped to user's org if authenticated
    const authResult = await getAuthOrNull();
    const userOrgId = authResult?.session.user.orgId;

    // Multi-tenancy: show user's org criteria + global ones
    // If not authenticated, only show global criteria
    const criteria = userOrgId
      ? await sql`
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
          WHERE org_id = ${userOrgId} OR org_id IS NULL
          ORDER BY name ASC
        `
      : await sql`
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
          WHERE org_id IS NULL
          ORDER BY name ASC
        `;

    return NextResponse.json(criteria);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Failed to fetch criteria:', error);
    return NextResponse.json({ error: 'Failed to fetch criteria' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    // Require admin role for creating criteria
    const { session } = await requireAuth(request, 'ADMIN');
    const userOrgId = session.user.orgId;

    const body = await request.json();
    const [criterion] = await sql`
      INSERT INTO criteria (name, description, weight, category, active, org_id)
      VALUES (
        ${body.name},
        ${body.description},
        ${body.weight ?? 5},
        ${body.category},
        ${body.active ?? true},
        ${userOrgId}
      )
      RETURNING 
        id,
        name,
        description,
        weight,
        category,
        active,
        org_id as "orgId",
        created_at as "createdAt"
    `;
    return NextResponse.json(criterion, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Failed to create criteria:', error);
    return NextResponse.json({ error: 'Failed to create criteria' }, { status: 500 });
  }
}

