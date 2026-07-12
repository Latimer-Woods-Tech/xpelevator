import { describe, it, expect } from 'vitest';
import {
  canManageOrgClients,
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
