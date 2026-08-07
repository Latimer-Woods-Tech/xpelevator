/**
 * GET /api/audit — read the governance audit trail (issue #157 §10)
 *
 * The read side of the append-only audit log written by `src/lib/audit.ts`.
 * Governance mutations (org rename / re-plan / delete, member add / remove,
 * client-org creation, scenario-pack import / upgrade, white-label branding
 * change) each leave one `audit_log` row; this endpoint lets an admin ask
 * "who changed this tenant, and when" without shell access to the DB.
 *
 * Access + tenancy (mirrors the manager-report route):
 *   - ADMIN only (`requireAuth(_, ADMIN)`): anon → 401 (middleware + handler),
 *     non-admin member → 403.
 *   - Strictly org-scoped. The trail returned is the caller's OWN org by
 *     default; `?orgId=<id>` lets a platform admin read any org and an OPERATOR
 *     admin read a CLIENT org beneath them — authorized by the pure
 *     `canAccessOrgReport` (own org / a client you own / any org for a platform
 *     admin), so an operator can never read another operator's client trail
 *     (cross-tenant → 403). An unknown org id is 404.
 *   - A PLATFORM admin (ADMIN with no org) and no `?orgId` reads the
 *     platform-wide trail — the only caller that can, since every tenant admin
 *     carries an `orgId` and lands in the scoped branch.
 *
 * Filters (all narrow, never widen, the authorized set):
 *   - `?action=<name>` — exact action match (e.g. `org.update`), served by the
 *     `(action, created_at)` index.
 *   - `?limit=<n>` — page size, default 50, capped at 200.
 *
 * Rows are returned most-recent-first. This route only ever READS; the log is
 * append-only (no update/delete path exists anywhere in the app).
 */
import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAuth, AuthError } from '@/lib/auth-api';
import { canAccessOrgReport } from '@/lib/org-hierarchy';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

interface AuditRow {
  id: string;
  action: string;
  actorUserId: string | null;
  actorEmail: string | null;
  orgId: string | null;
  targetType: string | null;
  targetId: string | null;
  metadata: unknown;
  createdAt: string;
}

/** Clamp `?limit` to [1, MAX_LIMIT], falling back to the default when absent/invalid. */
function parseLimit(raw: string | null): number {
  if (raw === null) return DEFAULT_LIMIT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

export async function GET(request: Request) {
  try {
    const { session } = await requireAuth(request, 'ADMIN');

    const params = new URL(request.url).searchParams;
    const limit = parseLimit(params.get('limit'));
    const action = params.get('action');
    const orgIdParam = params.get('orgId');

    // Resolve which tenant's trail to read.
    //  - An explicit `?orgId` targets a (possibly different) org: load it to
    //    check existence (404) and the operator↔client relationship, then
    //    authorize with the pure `canAccessOrgReport` (403 on cross-tenant).
    //  - No `?orgId`: default to the caller's OWN org — no lookup or authz
    //    needed (they are trivially authorized for their own tenant). A platform
    //    admin (no org) with no param falls through to the unscoped read.
    let targetOrgId: string | null;
    if (orgIdParam !== null) {
      const orgRows = await sql`
        SELECT id, parent_org_id AS "parentOrgId"
        FROM organizations
        WHERE id = ${orgIdParam}
        LIMIT 1
      `;
      if (orgRows.length === 0) {
        return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
      }
      const org = orgRows[0] as { id: string; parentOrgId: string | null };
      if (!canAccessOrgReport({ id: org.id, parentOrgId: org.parentOrgId }, session.user)) {
        return NextResponse.json(
          { error: 'You may only read the audit trail for your own org or the clients beneath it' },
          { status: 403 }
        );
      }
      targetOrgId = orgIdParam;
    } else {
      targetOrgId = session.user.orgId ?? null;
    }

    // Build the read. Every branch is org-scoped except the platform-admin
    // unscoped read (targetOrgId === null, only reachable by an ADMIN with no
    // org). The optional action filter uses the (action, created_at) index.
    let rows: Array<Record<string, unknown>>;
    if (targetOrgId !== null && action !== null) {
      rows = await sql`
        SELECT id, action, actor_user_id AS "actorUserId", actor_email AS "actorEmail",
               org_id AS "orgId", target_type AS "targetType", target_id AS "targetId",
               metadata, created_at AS "createdAt"
        FROM audit_log
        WHERE org_id = ${targetOrgId} AND action = ${action}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
    } else if (targetOrgId !== null) {
      rows = await sql`
        SELECT id, action, actor_user_id AS "actorUserId", actor_email AS "actorEmail",
               org_id AS "orgId", target_type AS "targetType", target_id AS "targetId",
               metadata, created_at AS "createdAt"
        FROM audit_log
        WHERE org_id = ${targetOrgId}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
    } else if (action !== null) {
      rows = await sql`
        SELECT id, action, actor_user_id AS "actorUserId", actor_email AS "actorEmail",
               org_id AS "orgId", target_type AS "targetType", target_id AS "targetId",
               metadata, created_at AS "createdAt"
        FROM audit_log
        WHERE action = ${action}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
    } else {
      rows = await sql`
        SELECT id, action, actor_user_id AS "actorUserId", actor_email AS "actorEmail",
               org_id AS "orgId", target_type AS "targetType", target_id AS "targetId",
               metadata, created_at AS "createdAt"
        FROM audit_log
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
    }

    return NextResponse.json({ entries: rows as unknown as AuditRow[] });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Failed to read audit trail:', error);
    return NextResponse.json({ error: 'Failed to read audit trail' }, { status: 500 });
  }
}
