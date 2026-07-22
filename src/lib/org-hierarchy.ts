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

/** Minimal shape of the org a governance action (read/update/delete) targets. */
export interface OrgGovernanceTarget {
  /** The org record being read or mutated via `/api/orgs/[id]`. */
  id: string;
  /** The operator that owns this org when it is a CLIENT, else `null`. */
  parentOrgId: string | null;
}

/**
 * Whether `viewer` is a PLATFORM admin — an ADMIN with no org of their own.
 *
 * This is the ratified super-admin marker already relied on by
 * {@link canManageOrgClients}, {@link canAccessOrgReport}, and
 * {@link resolveOperatorRollup}: a null org means "belongs to no single tenant,
 * governs the platform". A tenant/operator admin always carries an org id.
 */
export function isPlatformAdmin(viewer: OrgManager): boolean {
  return viewer.role === 'ADMIN' && (viewer.orgId ?? null) === null;
}

/**
 * Whether `viewer` may read or mutate the organization record `target` through
 * the `/api/orgs/[id]` governance surface (GET details / PUT name+plan / DELETE).
 *
 * Closes the cross-tenant IDOR where those verbs gated on the ADMIN role ALONE
 * and never on org identity — so any tenant admin could read another tenant's
 * member roster (emails, roles), retitle or re-plan their org, or delete it.
 * Mirrors the split the operator hierarchy already enforces
 * ({@link canManageOrgClients} / {@link canAccessOrgReport}):
 *
 *   - Must be an ADMIN. A MEMBER never governs an org record.
 *   - A PLATFORM admin (ADMIN with no org) may govern any org.
 *   - A tenant/operator admin may govern their OWN org (`viewerOrg === target.id`)
 *     or a CLIENT org they own (`viewerOrg === target.parentOrgId`) — never
 *     another tenant's org.
 *
 * `null`/`undefined` orgIds normalise so a DB `null` and an absent field compare
 * equal.
 */
export function canAccessOrg(
  target: OrgGovernanceTarget,
  viewer: OrgManager
): boolean {
  if (viewer.role !== 'ADMIN') return false;
  const viewerOrg = viewer.orgId ?? null;
  if (viewerOrg === null) return true; // platform admin — any org
  if (viewerOrg === target.id) return true; // own org
  return viewerOrg === (target.parentOrgId ?? null); // operator owns this client
}

/**
 * Whether `viewer` may change the persisted `plan` (seat tier) of org `target`.
 *
 * `plan` is the single source of truth every seat-entitlement gate reads — the
 * `POST /api/simulations` create gate, the billable PHONE-call gate, and the
 * `/api/me` entitlement read. A free write to it is a full billing bypass: a
 * FREE org's own admin could self-upgrade to ENTERPRISE and unlock VOICE +
 * PHONE without paying. So plan authority is deliberately NARROWER than
 * {@link canAccessOrg} (which also lets an org's own admin rename it):
 *
 *   - A PLATFORM admin (ADMIN, no org) may set any org's plan — they carry the
 *     billing authority (admin panel / Stripe webhooks).
 *   - An OPERATOR admin may set the plan of a CLIENT beneath them
 *     (`viewerOrg === target.parentOrgId`) — the wholesale seat tier the
 *     operator allocates in the channel model.
 *   - An org's OWN admin (`viewerOrg === target.id`) may NOT — self-upgrade is
 *     exactly the hole this closes. Their own plan comes from billing.
 *   - A MEMBER never sets a plan.
 *
 * `null`/`undefined` orgIds normalise so a DB `null` and an absent field
 * compare equal.
 */
export function canSetOrgPlan(
  target: OrgGovernanceTarget,
  viewer: OrgManager
): boolean {
  if (viewer.role !== 'ADMIN') return false;
  const viewerOrg = viewer.orgId ?? null;
  if (viewerOrg === null) return true; // platform admin — billing authority
  // Operator admin may set a CLIENT's plan; an org's own admin may NOT
  // self-upgrade (own-org and standalone both fall through to false here).
  return viewerOrg === (target.parentOrgId ?? null);
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
