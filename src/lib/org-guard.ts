/**
 * DB-touching companion to the pure `org-hierarchy.ts` predicates.
 *
 * `org-hierarchy.ts` is deliberately dependency-free (no Neon/NextAuth) so its
 * authorization rules stay unit-testable. The `/api/orgs/*` governance routes
 * still need the target org's `parent_org_id` (to let an operator admin reach a
 * CLIENT org they own) before they can call `canAccessOrg`. This module holds
 * that single shared lookup so every governance route — `/api/orgs/[id]` and
 * `/api/orgs/[id]/members` — resolves the target the same way.
 */
import { sql } from '@/lib/db';
import type { OrgGovernanceTarget } from '@/lib/org-hierarchy';

/**
 * Resolve a target org's existence + parent for the tenant-isolation gate.
 * Returns `null` when the org does not exist (callers map that to `404`).
 * `parentOrgId` drives `canAccessOrg` so an operator admin may reach a CLIENT
 * org they own.
 */
export async function getOrgGovernanceTarget(
  id: string
): Promise<OrgGovernanceTarget | null> {
  const rows = await sql`
    SELECT id, parent_org_id as "parentOrgId"
    FROM organizations
    WHERE id = ${id}
  `;
  if (rows.length === 0) return null;
  return { id: rows[0].id, parentOrgId: rows[0].parentOrgId ?? null };
}
