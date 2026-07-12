/**
 * GET /api/me — the authenticated caller's own identity + org context.
 *
 * The bootstrap primitive for the operator-workspace UX (issue #16, Phase 4,
 * R-051). Any authenticated user may read it; it returns ONLY the caller's own
 * user and own org — never a list, never another tenant — so the workspace can
 * learn its own org id and whether it is an OPERATOR (may own clients), a
 * CLIENT, a STANDALONE tenant, or a platform admin (no org), and thereby know
 * which subsequent calls (`/api/orgs/[id]/clients`, `/api/orgs/[id]/branding`)
 * it can make.
 *
 * Security + tenancy:
 *   - Authentication required: anon → 401 (the `/api/*` middleware matcher gates
 *     the path and `requireAuth` double-checks in the handler).
 *   - Strictly self-scoped: the org is looked up by the caller's OWN
 *     `session.user.orgId`, so no id is ever accepted from the request and no
 *     cross-tenant read is possible.
 *   - `toSelfContext` copies each field explicitly, so no sensitive
 *     `organizations` column can leak through.
 *   - `Cache-Control: no-store` — this is per-user identity, never shared.
 */
import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAuth, AuthError } from '@/lib/auth-api';
import { toSelfContext, type RawOrgRow } from '@/lib/self-context';

export async function GET(request: Request) {
  try {
    // Any authenticated user (ADMIN or MEMBER). Anon → AuthError(401).
    const { session } = await requireAuth(request);
    const user = session.user;

    let orgRow: RawOrgRow | null = null;
    if (user.orgId) {
      const rows = await sql`
        SELECT
          id,
          name,
          slug,
          plan,
          kind,
          parent_org_id AS "parentOrgId"
        FROM organizations
        WHERE id = ${user.orgId}
        LIMIT 1
      `;
      if (rows.length > 0) {
        orgRow = rows[0] as RawOrgRow;
      }
    }

    return NextResponse.json(toSelfContext(user, orgRow), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Failed to load self context:', error);
    return NextResponse.json(
      { error: 'Failed to load self context' },
      { status: 500 }
    );
  }
}
