/**
 * Unit tests for the operator-workspace view rules (src/lib/operator-workspace.ts,
 * R-052). The pure decision the `/operator` page branches on — locks that it
 * never grants more than the server's `canManageOrgClients` allows.
 */
import { describe, it, expect } from 'vitest';
import { operatorWorkspaceView } from '@/lib/operator-workspace';
import type { SelfContext } from '@/lib/self-context';

function self(over: Partial<SelfContext> & { org?: SelfContext['org'] }): SelfContext {
  return {
    user: { id: 'u1', email: 'a@b.c', name: 'A', role: 'ADMIN', ...(over.user ?? {}) },
    org:
      over.org === undefined
        ? { id: 'o1', name: 'Acme', slug: 'acme', kind: 'OPERATOR', plan: 'FREE', parentOrgId: null }
        : over.org,
    canManageClients: over.canManageClients ?? true,
  };
}

describe('operatorWorkspaceView', () => {
  it('a MEMBER is ineligible regardless of org', () => {
    const v = operatorWorkspaceView(self({ user: { id: 'u', email: null, name: null, role: 'MEMBER' } }));
    expect(v.kind).toBe('ineligible');
    if (v.kind === 'ineligible') expect(v.reason).toMatch(/admin/i);
  });

  it('an ADMIN with no org is a platform admin', () => {
    const v = operatorWorkspaceView(self({ org: null }));
    expect(v.kind).toBe('platform-admin');
  });

  it('an ADMIN of a CLIENT org is ineligible (managed by its operator)', () => {
    const v = operatorWorkspaceView(
      self({ org: { id: 'c1', name: 'Client', slug: 'client', kind: 'CLIENT', plan: 'FREE', parentOrgId: 'o1' } })
    );
    expect(v.kind).toBe('ineligible');
    if (v.kind === 'ineligible') expect(v.reason).toMatch(/client workspace/i);
  });

  it('an ADMIN of an OPERATOR org is an operator (not new)', () => {
    const v = operatorWorkspaceView(self({}));
    expect(v).toEqual({ kind: 'operator', orgId: 'o1', isNew: false });
  });

  it('an ADMIN of a STANDALONE org is an operator flagged isNew (onboarding)', () => {
    const v = operatorWorkspaceView(
      self({ org: { id: 's1', name: 'Solo', slug: 'solo', kind: 'STANDALONE', plan: 'FREE', parentOrgId: null } })
    );
    expect(v).toEqual({ kind: 'operator', orgId: 's1', isNew: true });
  });
});
