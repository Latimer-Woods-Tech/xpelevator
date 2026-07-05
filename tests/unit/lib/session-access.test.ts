/**
 * Unit tests for the simulation-session tenant-isolation guard
 * (src/lib/session-access.ts).
 *
 * Root cause this covers:
 *   GET /api/chat?sessionId=... authenticated the caller but performed NO
 *   ownership/org check, so any logged-in user could read any session's full
 *   transcript + scores by guessing the session UUID (cross-tenant IDOR). The
 *   create/scoring paths already enforced owner-or-same-org-admin; this guard
 *   centralizes that rule so every session-touching route shares one source of
 *   truth.
 */

import { describe, it, expect } from 'vitest';
import { canAccessSession } from '@/lib/session-access';

describe('canAccessSession', () => {
  it('allows the session owner (member)', () => {
    expect(
      canAccessSession(
        { userId: 'u1', orgId: 'orgA' },
        { id: 'u1', role: 'MEMBER', orgId: 'orgA' }
      )
    ).toBe(true);
  });

  it('allows the owner even when their org differs from the session org', () => {
    // Ownership is sufficient regardless of org drift.
    expect(
      canAccessSession(
        { userId: 'u1', orgId: 'orgA' },
        { id: 'u1', role: 'MEMBER', orgId: 'orgB' }
      )
    ).toBe(true);
  });

  it('DENIES a member reading another user\'s session in the same org', () => {
    expect(
      canAccessSession(
        { userId: 'owner', orgId: 'orgA' },
        { id: 'intruder', role: 'MEMBER', orgId: 'orgA' }
      )
    ).toBe(false);
  });

  it('allows an admin to read a session in their own org', () => {
    expect(
      canAccessSession(
        { userId: 'someone', orgId: 'orgA' },
        { id: 'admin', role: 'ADMIN', orgId: 'orgA' }
      )
    ).toBe(true);
  });

  it('DENIES an admin reading a session in a DIFFERENT org (the IDOR)', () => {
    expect(
      canAccessSession(
        { userId: 'victim', orgId: 'orgB' },
        { id: 'admin', role: 'ADMIN', orgId: 'orgA' }
      )
    ).toBe(false);
  });

  it('DENIES an anonymous-org member reading an org-scoped session', () => {
    expect(
      canAccessSession(
        { userId: 'owner', orgId: 'orgA' },
        { id: 'intruder', role: 'MEMBER', orgId: null }
      )
    ).toBe(false);
  });

  it('treats null and undefined orgId as equal for a global-scope admin', () => {
    // A no-org admin may read no-org ("global") sessions — the current
    // single-tenant behavior the create/scoring paths already allow.
    expect(
      canAccessSession(
        { userId: 'someone', orgId: null },
        { id: 'admin', role: 'ADMIN', orgId: undefined }
      )
    ).toBe(true);
  });

  it('DENIES a null-org admin reading an org-scoped session', () => {
    expect(
      canAccessSession(
        { userId: 'someone', orgId: 'orgA' },
        { id: 'admin', role: 'ADMIN', orgId: null }
      )
    ).toBe(false);
  });

  it('DENIES when the session has no owner and the viewer is not an admin', () => {
    expect(
      canAccessSession(
        { userId: null, orgId: null },
        { id: 'u1', role: 'MEMBER', orgId: null }
      )
    ).toBe(false);
  });
});
