/**
 * Tenant-isolation guards for org-scoped RESOURCES (scenarios, criteria,
 * job titles) — the shared catalog rows admins author, as opposed to
 * simulation sessions (see session-access.ts).
 *
 * Rules:
 *  - READ:   a resource is visible if it is global (`org_id IS NULL`) or
 *            belongs to the viewer's org.
 *  - MUTATE: a resource may be updated/deleted only by an admin of the SAME
 *            org. Global rows are the platform's shared catalog — a tenant
 *            admin must never be able to edit or delete them (they underpin
 *            every other tenant). Only a platform admin (no org) manages the
 *            global catalog, until a dedicated SUPERADMIN role exists.
 *
 * Dependency-free so it is unit-testable and shared by every resource route
 * as a single source of truth (the previous inline checks skipped the guard
 * entirely for global rows).
 */

/** Whether a viewer in `viewerOrgId` may read a resource owned by `resourceOrgId`. */
export function canReadResource(
  resourceOrgId: string | null | undefined,
  viewerOrgId: string | null | undefined
): boolean {
  const resource = resourceOrgId ?? null;
  return resource === null || resource === (viewerOrgId ?? null);
}

/**
 * Whether a viewer in `viewerOrgId` may mutate (update/delete/link) a resource
 * owned by `resourceOrgId`. Requires an exact org match — org admins own their
 * org's rows, platform (null-org) admins own the global catalog, and neither
 * can touch the other's.
 */
export function canMutateResource(
  resourceOrgId: string | null | undefined,
  viewerOrgId: string | null | undefined
): boolean {
  return (resourceOrgId ?? null) === (viewerOrgId ?? null);
}
