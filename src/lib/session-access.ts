/**
 * Tenant-isolation guard for simulation sessions.
 *
 * A simulation session belongs to a trainee (`userId`) inside an org (`orgId`).
 * The access rule — matching the create (`/api/simulations`, `/api/chat` POST)
 * and scoring (`/api/scoring`) paths — is: a caller may read or mutate a session
 * only if they OWN it, or they are an ADMIN in the SAME org. Sessions must never
 * be cross-tenant readable by guessing the session UUID.
 *
 * This lives in its own dependency-free module so it can be unit-tested without
 * pulling in NextAuth / DB imports, and so every session-touching route shares a
 * single source of truth for the check.
 */

/** Minimal shape of a session's ownership columns. */
export interface SessionOwnership {
  userId?: string | null;
  orgId?: string | null;
}

/** Minimal shape of the authenticated caller. */
export interface SessionViewer {
  id: string;
  role?: 'ADMIN' | 'MEMBER';
  orgId?: string | null;
}

/**
 * Whether `viewer` may access `session`.
 *
 * Owner-or-same-org-admin. Admin cross-user access requires a CONCRETE org
 * match — "no org" is never treated as a shared tenant. Every self-registered
 * user has `org_id = NULL`, so the previous `null === null` rule let any
 * null-org ADMIN read every self-registered user's sessions, transcripts, and
 * scores. Null-org sessions are therefore owner-only.
 */
export function canAccessSession(
  session: SessionOwnership,
  viewer: SessionViewer
): boolean {
  const ownsIt = session.userId != null && session.userId === viewer.id;
  const sameOrgAdmin =
    viewer.role === 'ADMIN' &&
    session.orgId != null &&
    session.orgId === (viewer.orgId ?? null);
  return ownsIt || sameOrgAdmin;
}
