import { describe, it, expect } from 'vitest';
import {
  toSelfContext,
  normalizeOrgKind,
  type RawOrgRow,
} from '@/lib/self-context';

// Pure-projection tests for the `GET /api/me` self-context (R-051). These lock
// the security contract (self-scoped, explicit field copy — no leak of an extra
// org column) and the derived `canManageClients` rule, with no DB/auth imports.

const OP_ORG: RawOrgRow = {
  id: 'org-op',
  name: 'Acme Operator',
  slug: 'acme',
  plan: 'ENTERPRISE',
  kind: 'OPERATOR',
  parentOrgId: null,
};

describe('normalizeOrgKind', () => {
  it('passes through OPERATOR and CLIENT', () => {
    expect(normalizeOrgKind('OPERATOR')).toBe('OPERATOR');
    expect(normalizeOrgKind('CLIENT')).toBe('CLIENT');
  });

  it('defaults unknown / absent to STANDALONE', () => {
    expect(normalizeOrgKind('STANDALONE')).toBe('STANDALONE');
    expect(normalizeOrgKind(undefined)).toBe('STANDALONE');
    expect(normalizeOrgKind(null)).toBe('STANDALONE');
    expect(normalizeOrgKind('nonsense')).toBe('STANDALONE');
  });
});

describe('toSelfContext — identity', () => {
  it('copies the caller and coalesces missing email/name to null', () => {
    const ctx = toSelfContext({ id: 'u1', role: 'MEMBER' }, null);
    expect(ctx.user).toEqual({
      id: 'u1',
      email: null,
      name: null,
      role: 'MEMBER',
    });
  });

  it('defaults an absent/unknown role to MEMBER (never silently ADMIN)', () => {
    expect(toSelfContext({ id: 'u1' }, null).user.role).toBe('MEMBER');
    expect(
      // @ts-expect-error — exercising a bad runtime value
      toSelfContext({ id: 'u1', role: 'SUPERUSER' }, null).user.role
    ).toBe('MEMBER');
  });
});

describe('toSelfContext — org scoping', () => {
  it('platform admin (no org) → org null, canManageClients true', () => {
    const ctx = toSelfContext({ id: 'u1', role: 'ADMIN' }, null);
    expect(ctx.org).toBeNull();
    expect(ctx.canManageClients).toBe(true);
  });

  it('operator admin → own org echoed, canManageClients true', () => {
    const ctx = toSelfContext(
      { id: 'u1', email: 'a@acme.io', name: 'Ada', role: 'ADMIN' },
      OP_ORG
    );
    expect(ctx.org).toEqual({
      id: 'org-op',
      name: 'Acme Operator',
      slug: 'acme',
      kind: 'OPERATOR',
      plan: 'ENTERPRISE',
      parentOrgId: null,
    });
    expect(ctx.canManageClients).toBe(true);
  });

  it('client admin → cannot manage clients (two-level hierarchy)', () => {
    const ctx = toSelfContext(
      { id: 'u1', role: 'ADMIN' },
      { id: 'org-c', name: 'Client', slug: 'client', plan: 'FREE', kind: 'CLIENT', parentOrgId: 'org-op' }
    );
    expect(ctx.org?.parentOrgId).toBe('org-op');
    expect(ctx.canManageClients).toBe(false);
  });

  it('standalone admin (not yet an operator) → cannot manage clients', () => {
    const ctx = toSelfContext(
      { id: 'u1', role: 'ADMIN' },
      { id: 'org-s', name: 'Solo', slug: 'solo', plan: 'FREE', kind: 'STANDALONE', parentOrgId: null }
    );
    expect(ctx.canManageClients).toBe(false);
  });

  it('member of an operator org → cannot manage clients (role gate)', () => {
    const ctx = toSelfContext({ id: 'u1', role: 'MEMBER' }, OP_ORG);
    expect(ctx.canManageClients).toBe(false);
  });

  it('defaults a null plan / unknown kind on the row', () => {
    const ctx = toSelfContext(
      { id: 'u1', role: 'ADMIN' },
      { id: 'org-x', name: 'X', slug: 'x', plan: null, kind: null, parentOrgId: undefined }
    );
    expect(ctx.org?.plan).toBe('FREE');
    expect(ctx.org?.kind).toBe('STANDALONE');
    expect(ctx.org?.parentOrgId).toBeNull();
  });
});

describe('toSelfContext — no-leak projection', () => {
  it('drops any extra column present on the org row', () => {
    const leaky = {
      ...OP_ORG,
      // Columns that must never surface through /api/me:
      stripe_customer_id: 'cus_secret',
      brand_logo_url: 'https://x/y.png',
      internalNotes: 'do not expose',
    } as unknown as RawOrgRow;
    const ctx = toSelfContext({ id: 'u1', role: 'ADMIN' }, leaky);
    expect(Object.keys(ctx.org ?? {}).sort()).toEqual([
      'id',
      'kind',
      'name',
      'parentOrgId',
      'plan',
      'slug',
    ]);
  });
});
