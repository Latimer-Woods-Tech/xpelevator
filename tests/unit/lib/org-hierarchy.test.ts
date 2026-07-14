import { describe, it, expect } from 'vitest';
import {
  canManageOrgClients,
  canAccessOrgReport,
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
