/**
 * Tenant-isolation helper for simulation sessions.
 *
 * A simulation session is reachable only by the user who owns it, or by an
 * ADMIN acting within the same org. Members can never reach another user's
 * session, and no caller can reach a session belonging to a different org.
 *
 * Centralised so every session-scoped route applies the identical rule:
 * `/api/chat` POST + GET (incl. the phone-transcript SSE stream), and
 * `/api/scoring`. Before this helper existed, `GET /api/chat` returned any
 * session's full transcript, scores and scenario to any authenticated caller
 * (an IDOR / cross-tenant leak) while its sibling POST enforced access.
 */

/** The owning identity of a session row (from `simulation_sessions`). */
export interface SessionOwner {
  userId: string | null;
  orgId: string | null;
}

/** The authenticated caller requesting access. */
export interface SessionViewer {
  id: string;
  role?: 'ADMIN' | 'MEMBER';
  orgId?: string | null;
}

/**
 * Returns true when `viewer` may access `session`.
 *
 * Access is granted when the viewer owns the session, or when the viewer is an
 * ADMIN in the same org as the session. Mirrors the check that
 * `POST /api/chat` and `POST /api/scoring` already applied inline.
 */
export function canAccessSession(
  session: SessionOwner,
  viewer: SessionViewer
): boolean {
  if (session.userId != null && session.userId === viewer.id) {
    return true;
  }
  if (
    viewer.role === 'ADMIN' &&
    session.orgId === (viewer.orgId ?? null)
  ) {
    return true;
  }
  return false;
}
