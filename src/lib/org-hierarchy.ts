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

/** Minimal shape of the org a report is being requested for. */
export interface OrgReportTarget {
  /** The org whose sessions the report would cover. */
  id: string;
  /** The operator that owns this org when it is a CLIENT, else `null`. */
  parentOrgId: string | null;
}

/**
 * Whether `viewer` may pull the manager report (session export) for org
 * `target`.
 *
 * The manager report is "the artifact an operator shows their client" — but an
 * operator's OWN org carries no trainee sessions; the sessions live in the
 * CLIENT orgs beneath it. So an operator must be able to report on a specific
 * client, while never reaching another operator's client.
 *
 * Rules (tenant isolation — mirrors {@link canManageOrgClients}):
 *   - Must be an ADMIN. A MEMBER never exports another org's sessions.
 *   - A PLATFORM admin (ADMIN with no org) may report on any org.
 *   - An org admin may report on their OWN org (`viewerOrg === target.id`) — the
 *     same data the no-parameter report already returns.
 *   - An OPERATOR admin may report on a CLIENT they own
 *     (`viewerOrg === target.parentOrgId`) — never another operator's client.
 *
 * `null`/`undefined` orgIds are normalized so a real DB `null` and an absent
 * field compare equal.
 */
export function canAccessOrgReport(
  target: OrgReportTarget,
  viewer: OrgManager
): boolean {
  if (viewer.role !== 'ADMIN') return false;
  const viewerOrg = viewer.orgId ?? null;
  if (viewerOrg === null) return true; // platform admin — any org
  if (viewerOrg === target.id) return true; // own org
  return viewerOrg === (target.parentOrgId ?? null); // operator owns this client
}

/** Outcome of resolving which operator a portfolio roll-up should cover. */
export type OperatorRollupResolution =
  | { ok: true; operatorOrgId: string }
  | { ok: false; status: 400 | 403 };

/**
 * Resolve the operator whose CLIENT orgs a portfolio roll-up report
 * (`?scope=clients`) should span, and authorize the caller for it.
 *
 * The roll-up is the operator's book-of-clients view — every client org beneath
 * one operator, in a single export. Who that operator is depends on the caller:
 *   - An OPERATOR admin rolls up their OWN clients. `operatorOrgIdParam` is
 *     optional; if given it MUST equal their own org, else 403 (no peeking at
 *     another operator's portfolio).
 *   - A PLATFORM admin (ADMIN with no org) has no operator of their own, so they
 *     MUST name one via `operatorOrgIdParam`; absent → 400.
 *   - A non-admin never reaches a roll-up → 403 (the route also gates ADMIN
 *     upstream; this keeps the rule self-contained and testable).
 *
 * Returns the resolved `operatorOrgId` to scope the client query, or a status to
 * return. `null`/`undefined` orgIds normalise so a DB `null` and an absent field
 * compare equal.
 */
export function resolveOperatorRollup(
  viewer: OrgManager,
  operatorOrgIdParam?: string | null
): OperatorRollupResolution {
  if (viewer.role !== 'ADMIN') return { ok: false, status: 403 };
  const viewerOrg = viewer.orgId ?? null;
  const param = operatorOrgIdParam || null;

  if (viewerOrg === null) {
    // Platform admin: must name the operator to roll up.
    return param ? { ok: true, operatorOrgId: param } : { ok: false, status: 400 };
  }
  // Operator admin: their own clients only. A mismatched explicit param is a
  // cross-operator attempt → 403.
  if (param && param !== viewerOrg) return { ok: false, status: 403 };
  return { ok: true, operatorOrgId: viewerOrg };
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
