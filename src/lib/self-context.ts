/**
 * The authenticated caller's own identity + org context (issue #16, Phase 4,
 * R-051) — the bootstrap primitive behind `GET /api/me`.
 *
 * The operator-workspace UX (R-040) needs one thing before it can render: to
 * learn WHO the caller is and WHICH org they belong to. Without it a client can
 * never call `/api/orgs/[id]/clients` or `/api/orgs/[id]/branding` — it has no
 * way to discover its own org id or whether it is an OPERATOR (may own clients),
 * a CLIENT (managed beneath one), a STANDALONE tenant, or a platform admin (no
 * org). This module holds the pure, dependency-free projection that shapes that
 * answer — so it can be unit-tested without NextAuth / Neon imports, and so a
 * single source of truth backs the route (mirrors `branding.ts` /
 * `org-hierarchy.ts` / `session-access.ts`).
 *
 * Security contract: the projection is strictly SELF-scoped — it only ever
 * describes the caller's OWN user and OWN org, never a list, never another
 * tenant. It copies each org field explicitly (never spreads the row) so a new
 * sensitive column added to `organizations` can never leak through here — the
 * same discipline as `toPublicBranding`.
 */

import {
  ALL_MODALITIES,
  modalitiesForPlan,
  type SimulationType,
} from '@/lib/plans';

/** The two-level channel taxonomy an org can occupy. */
export type OrgKind = 'STANDALONE' | 'OPERATOR' | 'CLIENT';

/** The caller's own identity — no secrets, no tokens. */
export interface SelfUser {
  id: string;
  email: string | null;
  name: string | null;
  role: 'ADMIN' | 'MEMBER';
}

/** The caller's OWN org context — the facts the workspace UI branches on. */
export interface SelfOrg {
  id: string;
  name: string;
  slug: string;
  kind: OrgKind;
  plan: string;
  /** The operator this org sits beneath, if it is a CLIENT; else null. */
  parentOrgId: string | null;
}

/**
 * The caller's practice-modality entitlements — a read-only mirror of the
 * `POST /api/simulations` seat gate (issue #16 Phase 4). The trainee UI reads
 * this to grey out modalities the org's plan does not unlock, so a trainee sees
 * *why* a modality is locked before hitting the server 403 (`MODALITY_LOCKED`).
 * Derived from the plan via `modalitiesForPlan`, so the UI never re-encodes the
 * plan→modality mapping and can never drift from the server gate.
 */
export interface SelfEntitlements {
  /**
   * The practice modalities this caller may START (cumulative: CHAT ⊆ VOICE ⊆
   * PHONE). A caller with no org (platform staff / test mode) is ungated and
   * gets every modality — matching the server gate, which only engages when an
   * `orgId` is present. Advisory only: the server remains the enforcement point.
   */
  modalities: readonly SimulationType[];
}

/** The `GET /api/me` response shape. `org` is null for a platform admin. */
export interface SelfContext {
  user: SelfUser;
  /** The caller's own org, or null when the caller has no org (platform admin). */
  org: SelfOrg | null;
  /**
   * Whether this caller may create/manage client orgs — derived so the UI does
   * not have to re-encode the rule. True for a platform admin (ADMIN, no org)
   * or an OPERATOR org's ADMIN. A MEMBER, a CLIENT admin, or a not-yet-operator
   * STANDALONE admin is false (a STANDALONE admin becomes an operator by
   * creating its first client — R-048 — at which point this flips true).
   */
  canManageClients: boolean;
  /**
   * The caller's practice-modality entitlements, derived from the org plan so
   * the trainee UI can grey out locked modalities before the server 403.
   */
  entitlements: SelfEntitlements;
}

/** The minimal caller shape carried by the authenticated session. */
export interface SelfUserInput {
  id: string;
  email?: string | null;
  name?: string | null;
  role?: 'ADMIN' | 'MEMBER';
}

/** A raw `organizations` row as read for the caller's own org (may carry extra
 * columns — they are deliberately dropped by the explicit copy below). */
export interface RawOrgRow {
  id: string;
  name: string;
  slug: string;
  plan?: string | null;
  kind?: string | null;
  parentOrgId?: string | null;
}

/** Normalize a stored `kind` string to the closed `OrgKind` set, defaulting an
 * unknown/absent value to `STANDALONE` (the additive-migration default). */
export function normalizeOrgKind(kind: unknown): OrgKind {
  if (kind === 'OPERATOR' || kind === 'CLIENT') return kind;
  return 'STANDALONE';
}

/**
 * Project the caller + their own org row down to the self-scoped `SelfContext`.
 * The single source of truth for what `GET /api/me` may expose. Copies each
 * field explicitly (never spreads the row) so a new sensitive `organizations`
 * column can never leak through this projection.
 */
export function toSelfContext(
  user: SelfUserInput,
  orgRow: RawOrgRow | null
): SelfContext {
  const role: 'ADMIN' | 'MEMBER' = user.role === 'ADMIN' ? 'ADMIN' : 'MEMBER';

  const org: SelfOrg | null = orgRow
    ? {
        id: orgRow.id,
        name: orgRow.name,
        slug: orgRow.slug,
        kind: normalizeOrgKind(orgRow.kind),
        plan: orgRow.plan ?? 'FREE',
        parentOrgId: orgRow.parentOrgId ?? null,
      }
    : null;

  // Platform admin (ADMIN, no org) → manage any operator; OPERATOR org's ADMIN
  // → manage own clients. Mirrors the server-side `canManageOrgClients` rule so
  // the UI never re-derives tenant authority differently from the API.
  const canManageClients =
    role === 'ADMIN' && (org === null || org.kind === 'OPERATOR');

  // Seat entitlements: an org's plan decides its unlocked modalities; a caller
  // with no org (platform staff / test) is ungated → every modality. Mirrors the
  // `POST /api/simulations` gate, which only engages when an `orgId` is present.
  const modalities: readonly SimulationType[] =
    org === null ? ALL_MODALITIES : modalitiesForPlan(org.plan);

  return {
    user: {
      id: user.id,
      email: user.email ?? null,
      name: user.name ?? null,
      role,
    },
    org,
    canManageClients,
    entitlements: { modalities },
  };
}
