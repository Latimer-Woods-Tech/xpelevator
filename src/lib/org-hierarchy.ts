/**
 * Operator→client org hierarchy helpers (issue #16, Phase 4).
 *
 * The channel model: an OPERATOR org owns CLIENT orgs beneath it. This module
 * holds the pure, dependency-free rules the client-management API enforces — an
 * authorization predicate and slug helpers — so they can be unit-tested without
 * NextAuth / Neon imports, and so a single source of truth backs every
 * hierarchy-touching route (mirrors `session-access.ts`).
 */

/** Minimal shape of the authenticated caller. */
export interface OrgManager {
  role?: 'ADMIN' | 'MEMBER';
  orgId?: string | null;
}

/**
 * Whether `viewer` may create/list the CLIENT orgs beneath operator
 * `operatorOrgId`.
 *
 * Rules (tenant isolation):
 *   - Must be an ADMIN. A MEMBER never manages orgs.
 *   - A PLATFORM admin (ADMIN with no org) may manage any operator's clients —
 *     matching the existing `/api/orgs` admin surface.
 *   - An OPERATOR admin (ADMIN whose org IS the operator) may manage ONLY their
 *     own operator's clients — never another operator's.
 *
 * `null` / `undefined` orgIds are normalized so a real DB `null` and an absent
 * field compare equal.
 */
export function canManageOrgClients(
  operatorOrgId: string,
  viewer: OrgManager
): boolean {
  if (viewer.role !== 'ADMIN') return false;
  const viewerOrg = viewer.orgId ?? null;
  if (viewerOrg === null) return true; // platform admin
  return viewerOrg === operatorOrgId; // operator admin, own operator only
}

/**
 * Turn a human org name into a URL-safe slug: lowercased, non-alphanumerics
 * collapsed to single hyphens, no leading/trailing hyphen.
 */
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Append a short, collision-avoiding suffix to a base slug. Used when a
 * generated client slug already exists (org slugs are globally unique). The
 * suffix is derived from a caller-supplied token (e.g. `crypto.randomUUID()`)
 * so this stays pure/testable — no ambient randomness here.
 */
export function suffixSlug(base: string, token: string): string {
  const clean = token.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6);
  const root = base || 'client';
  return clean ? `${root}-${clean}` : root;
}
