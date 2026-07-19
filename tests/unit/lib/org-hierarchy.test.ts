import { describe, it, expect } from 'vitest';
import {
  canManageOrgClients,
  canAccessOrgReport,
  canAccessOrg,
  isPlatformAdmin,
  resolveOperatorRollup,
  slugify,
  suffixSlug,
} from '@/lib/org-hierarchy';

describe('canManageOrgClients', () => {
  const OP = 'operator-1';

  it('platform admin (ADMIN, no org) may manage any operator', () => {
    expect(canManageOrgClients(OP, { role: 'ADMIN', orgId: null })).toBe(true);
    expect(canManageOrgClients(OP, { role: 'ADMIN' })).toBe(true); // undefined org == null
    expect(canManageOrgClients('other', { role: 'ADMIN', orgId: null })).toBe(true);
  });

  it('operator admin may manage ONLY their own operator', () => {
    expect(canManageOrgClients(OP, { role: 'ADMIN', orgId: OP })).toBe(true);
    expect(canManageOrgClients(OP, { role: 'ADMIN', orgId: 'operator-2' })).toBe(false);
  });

  it('members are never allowed, regardless of org', () => {
    expect(canManageOrgClients(OP, { role: 'MEMBER', orgId: OP })).toBe(false);
    expect(canManageOrgClients(OP, { role: 'MEMBER', orgId: null })).toBe(false);
    expect(canManageOrgClients(OP, {})).toBe(false); // no role → not admin
  });
});

describe('isPlatformAdmin', () => {
  it('is true only for an ADMIN with no org', () => {
    expect(isPlatformAdmin({ role: 'ADMIN', orgId: null })).toBe(true);
    expect(isPlatformAdmin({ role: 'ADMIN' })).toBe(true); // undefined org == null
  });

  it('is false for a tenant/operator admin (ADMIN with an org)', () => {
    expect(isPlatformAdmin({ role: 'ADMIN', orgId: 'operator-1' })).toBe(false);
  });

  it('is false for any MEMBER', () => {
    expect(isPlatformAdmin({ role: 'MEMBER', orgId: null })).toBe(false);
    expect(isPlatformAdmin({ role: 'MEMBER', orgId: 'operator-1' })).toBe(false);
    expect(isPlatformAdmin({})).toBe(false);
  });
});

describe('canAccessOrg', () => {
  const OP = 'operator-1';
  const OWN = { id: OP, parentOrgId: null };
  const CLIENT = { id: 'client-1', parentOrgId: OP };
  const OTHER_CLIENT = { id: 'client-9', parentOrgId: 'operator-2' };
  const OTHER_STANDALONE = { id: 'solo-9', parentOrgId: null };

  it('a platform admin (ADMIN, no org) may govern any org', () => {
    expect(canAccessOrg(OWN, { role: 'ADMIN', orgId: null })).toBe(true);
    expect(canAccessOrg(OTHER_CLIENT, { role: 'ADMIN', orgId: null })).toBe(true);
    expect(canAccessOrg(OTHER_STANDALONE, { role: 'ADMIN' })).toBe(true);
  });

  it('an operator admin may govern their own org and clients they own', () => {
    expect(canAccessOrg(OWN, { role: 'ADMIN', orgId: OP })).toBe(true);
    expect(canAccessOrg(CLIENT, { role: 'ADMIN', orgId: OP })).toBe(true);
  });

  it('an operator admin may NOT govern another tenant (the closed IDOR)', () => {
    expect(canAccessOrg(OTHER_CLIENT, { role: 'ADMIN', orgId: OP })).toBe(false);
    expect(canAccessOrg(OTHER_STANDALONE, { role: 'ADMIN', orgId: OP })).toBe(false);
  });

  it('a MEMBER never governs an org, even their own', () => {
    expect(canAccessOrg(OWN, { role: 'MEMBER', orgId: OP })).toBe(false);
    expect(canAccessOrg(CLIENT, { role: 'MEMBER', orgId: OP })).toBe(false);
    expect(canAccessOrg(OWN, {})).toBe(false);
  });
});

describe('canAccessOrgReport', () => {
  const OP = 'operator-1';
  const CLIENT = { id: 'client-1', parentOrgId: OP };
  const OTHER_CLIENT = { id: 'client-9', parentOrgId: 'operator-2' };
  const STANDALONE = { id: 'solo-1', parentOrgId: null };

  it('a platform admin (ADMIN, no org) may report on any org', () => {
    expect(canAccessOrgReport(CLIENT, { role: 'ADMIN', orgId: null })).toBe(true);
    expect(canAccessOrgReport(OTHER_CLIENT, { role: 'ADMIN', orgId: null })).toBe(true);
    expect(canAccessOrgReport(STANDALONE, { role: 'ADMIN' })).toBe(true);
  });

  it('an operator admin may report on a CLIENT they own', () => {
    expect(canAccessOrgReport(CLIENT, { role: 'ADMIN', orgId: OP })).toBe(true);
  });

  it('an operator admin may NOT report on another operator’s client', () => {
    expect(canAccessOrgReport(OTHER_CLIENT, { role: 'ADMIN', orgId: OP })).toBe(false);
  });

  it('an org admin may report on their OWN org', () => {
    expect(canAccessOrgReport(STANDALONE, { role: 'ADMIN', orgId: 'solo-1' })).toBe(true);
    expect(canAccessOrgReport(CLIENT, { role: 'ADMIN', orgId: 'client-1' })).toBe(true);
  });

  it('a MEMBER never exports another org’s sessions, even their own client', () => {
    expect(canAccessOrgReport(CLIENT, { role: 'MEMBER', orgId: OP })).toBe(false);
    expect(canAccessOrgReport(CLIENT, { role: 'MEMBER', orgId: null })).toBe(false);
  });

  it('an operator admin may NOT report on an unrelated standalone org', () => {
    expect(canAccessOrgReport(STANDALONE, { role: 'ADMIN', orgId: OP })).toBe(false);
  });
});

describe('resolveOperatorRollup', () => {
  const OP = 'operator-1';

  it('operator admin rolls up their OWN clients (no param needed)', () => {
    expect(resolveOperatorRollup({ role: 'ADMIN', orgId: OP })).toEqual({
      ok: true,
      operatorOrgId: OP,
    });
  });

  it('operator admin: a matching explicit operatorOrgId is accepted', () => {
    expect(resolveOperatorRollup({ role: 'ADMIN', orgId: OP }, OP)).toEqual({
      ok: true,
      operatorOrgId: OP,
    });
  });

  it('operator admin: a DIFFERENT operatorOrgId is a cross-operator attempt → 403', () => {
    expect(resolveOperatorRollup({ role: 'ADMIN', orgId: OP }, 'operator-2')).toEqual({
      ok: false,
      status: 403,
    });
  });

  it('platform admin (no org) MUST name an operator → 400 when absent', () => {
    expect(resolveOperatorRollup({ role: 'ADMIN', orgId: null })).toEqual({
      ok: false,
      status: 400,
    });
    expect(resolveOperatorRollup({ role: 'ADMIN' })).toEqual({ ok: false, status: 400 });
    expect(resolveOperatorRollup({ role: 'ADMIN', orgId: null }, '')).toEqual({
      ok: false,
      status: 400,
    });
  });

  it('platform admin may roll up any named operator', () => {
    expect(resolveOperatorRollup({ role: 'ADMIN', orgId: null }, OP)).toEqual({
      ok: true,
      operatorOrgId: OP,
    });
  });

  it('a MEMBER never reaches a roll-up → 403', () => {
    expect(resolveOperatorRollup({ role: 'MEMBER', orgId: OP })).toEqual({
      ok: false,
      status: 403,
    });
    expect(resolveOperatorRollup({})).toEqual({ ok: false, status: 403 });
  });
});

describe('slugify', () => {
  it('lowercases, hyphenates, and trims non-alphanumerics', () => {
    expect(slugify('Acme Corp')).toBe('acme-corp');
    expect(slugify('  Weird__Name!!  ')).toBe('weird-name');
    expect(slugify('Café & Co.')).toBe('caf-co');
  });

  it('collapses to empty when nothing alphanumeric remains', () => {
    expect(slugify('   ')).toBe('');
    expect(slugify('!!!')).toBe('');
  });
});

describe('suffixSlug', () => {
  it('appends up to 6 alphanumeric chars from the token', () => {
    expect(suffixSlug('acme', 'ABCD-EFGH-1234')).toBe('acme-abcdef');
    expect(suffixSlug('acme', '9f')).toBe('acme-9f');
  });

  it('falls back to a "client" root when the base is empty', () => {
    expect(suffixSlug('', 'abcdef')).toBe('client-abcdef');
  });

  it('returns the bare root when the token has no usable chars', () => {
    expect(suffixSlug('acme', '----')).toBe('acme');
    expect(suffixSlug('', '')).toBe('client');
  });
});
