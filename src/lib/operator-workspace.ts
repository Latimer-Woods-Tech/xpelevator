/**
 * Operator-workspace view rules (issue #16, Phase 4, R-052 — advances R-040).
 *
 * The self-serve operator workspace (`/operator`) reads the caller's own
 * self-context (`GET /api/me`, R-051) and must decide, in ONE place, what the
 * caller may do. This module holds that pure, dependency-free decision so the
 * page and its tests share a single source of truth and never re-encode tenant
 * authority differently from the server (mirrors `org-hierarchy.ts` /
 * `self-context.ts`).
 *
 * The rule deliberately admits a STANDALONE org's admin as an operator with
 * `isNew: true`: creating their first client promotes STANDALONE → OPERATOR
 * (R-048), which IS "self-serve operator onboarding". This is a super-set of the
 * server's `canManageClients` flag (which is false for a not-yet-operator
 * STANDALONE admin); the write is still authorised server-side by
 * `canManageOrgClients(org.id, viewer)` — true for an ADMIN acting on their OWN
 * org id — so the UI never widens what the API allows.
 */
import type { SelfContext } from './self-context';

/** What the operator workspace should render for the current caller. */
export type WorkspaceState =
  /** The caller may not run an operator workspace; `reason` is display copy. */
  | { kind: 'ineligible'; reason: string }
  /** A platform admin (no org) — operators are managed from the admin panel. */
  | { kind: 'platform-admin' }
  /**
   * An org admin who may manage clients under `orgId`. `isNew` is true for a
   * STANDALONE org that has not yet created a client (onboarding — the first
   * create promotes it to OPERATOR); false for an established OPERATOR.
   */
  | { kind: 'operator'; orgId: string; isNew: boolean };

/**
 * Decide the operator-workspace view for a caller's self-context. The single
 * source of truth the `/operator` page branches on.
 *
 *   - Not an ADMIN            → ineligible (org management is admin-only).
 *   - ADMIN, no org           → platform-admin (manage operators via /admin).
 *   - ADMIN, org is a CLIENT  → ineligible (a client is managed by its operator).
 *   - ADMIN, OPERATOR/STANDALONE org → operator (STANDALONE ⇒ isNew, onboarding).
 */
export function operatorWorkspaceView(self: SelfContext): WorkspaceState {
  if (self.user.role !== 'ADMIN') {
    return {
      kind: 'ineligible',
      reason:
        'Operator workspaces are managed by an organisation admin. Ask your admin for access.',
    };
  }

  const org = self.org;
  if (org === null) {
    return { kind: 'platform-admin' };
  }

  if (org.kind === 'CLIENT') {
    return {
      kind: 'ineligible',
      reason:
        'This organisation is a client workspace, managed by its operator. There is nothing to set up here.',
    };
  }

  return { kind: 'operator', orgId: org.id, isNew: org.kind !== 'OPERATOR' };
}
