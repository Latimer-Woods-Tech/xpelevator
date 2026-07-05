import { describe, it, expect } from 'vitest';
import { canAccessSession } from '@/lib/session-access';

const OWNER = { userId: 'user-1', orgId: 'org-A' };

describe('canAccessSession', () => {
  it('grants the owner access regardless of role', () => {
    expect(canAccessSession(OWNER, { id: 'user-1', role: 'MEMBER', orgId: 'org-A' })).toBe(true);
    expect(canAccessSession(OWNER, { id: 'user-1', role: 'MEMBER', orgId: null })).toBe(true);
  });

  it('denies a member who does not own the session, even in the same org', () => {
    expect(canAccessSession(OWNER, { id: 'user-2', role: 'MEMBER', orgId: 'org-A' })).toBe(false);
  });

  it('grants an admin in the same org', () => {
    expect(canAccessSession(OWNER, { id: 'admin-9', role: 'ADMIN', orgId: 'org-A' })).toBe(true);
  });

  it('denies an admin from a different org (cross-tenant)', () => {
    expect(canAccessSession(OWNER, { id: 'admin-9', role: 'ADMIN', orgId: 'org-B' })).toBe(false);
  });

  it('denies an admin with no org against an org-scoped session', () => {
    expect(canAccessSession(OWNER, { id: 'admin-9', role: 'ADMIN', orgId: null })).toBe(false);
  });

  it('matches org-null admin to org-null sessions (global/test data)', () => {
    const globalSession = { userId: 'someone-else', orgId: null };
    expect(canAccessSession(globalSession, { id: 'admin-9', role: 'ADMIN', orgId: null })).toBe(true);
  });

  it('never grants access to a stranger member', () => {
    expect(canAccessSession(OWNER, { id: 'user-3', role: 'MEMBER', orgId: 'org-B' })).toBe(false);
  });

  it('treats a null session owner as unmatched for non-admins', () => {
    const orphan = { userId: null, orgId: 'org-A' };
    expect(canAccessSession(orphan, { id: 'user-1', role: 'MEMBER', orgId: 'org-A' })).toBe(false);
  });
});
