import { describe, it, expect } from 'vitest';
import {
  normalizeBrandName,
  normalizeLogoUrl,
  normalizeHexColor,
  parseBrandingBody,
  mergeBranding,
  canManageOrgBranding,
  toPublicBranding,
  hasBranding,
  type Branding,
} from '@/lib/branding';

describe('normalizeBrandName', () => {
  it('trims and accepts a normal name', () => {
    expect(normalizeBrandName('  Acme Training  ')).toBe('Acme Training');
  });

  it('treats null/blank as a clear (null)', () => {
    expect(normalizeBrandName(null)).toBeNull();
    expect(normalizeBrandName('')).toBeNull();
    expect(normalizeBrandName('   ')).toBeNull();
  });

  it('rejects non-strings and over-long names (undefined)', () => {
    expect(normalizeBrandName(42)).toBeUndefined();
    expect(normalizeBrandName({})).toBeUndefined();
    expect(normalizeBrandName('x'.repeat(121))).toBeUndefined();
  });
});

describe('normalizeLogoUrl', () => {
  it('accepts an https URL', () => {
    expect(normalizeLogoUrl('https://cdn.example.com/logo.png')).toBe(
      'https://cdn.example.com/logo.png'
    );
    expect(normalizeLogoUrl('  https://x.io/a.svg  ')).toBe('https://x.io/a.svg');
  });

  it('treats null/blank as a clear (null)', () => {
    expect(normalizeLogoUrl(null)).toBeNull();
    expect(normalizeLogoUrl('')).toBeNull();
    expect(normalizeLogoUrl('   ')).toBeNull();
  });

  it('rejects non-https, non-string, unparseable, and over-long (undefined)', () => {
    expect(normalizeLogoUrl('http://insecure.example/logo.png')).toBeUndefined();
    expect(normalizeLogoUrl('javascript:alert(1)')).toBeUndefined();
    expect(normalizeLogoUrl('data:image/png;base64,AAAA')).toBeUndefined();
    expect(normalizeLogoUrl('not a url')).toBeUndefined();
    expect(normalizeLogoUrl(99)).toBeUndefined();
    expect(normalizeLogoUrl('https://x.io/' + 'a'.repeat(2048))).toBeUndefined();
  });
});

describe('normalizeHexColor', () => {
  it('normalizes #rrggbb and expands #rgb to lowercase', () => {
    expect(normalizeHexColor('#AABBCC')).toBe('#aabbcc');
    expect(normalizeHexColor('  #0f0  ')).toBe('#00ff00');
    expect(normalizeHexColor('#123')).toBe('#112233');
  });

  it('treats null/blank as a clear (null)', () => {
    expect(normalizeHexColor(null)).toBeNull();
    expect(normalizeHexColor('')).toBeNull();
    expect(normalizeHexColor('  ')).toBeNull();
  });

  it('rejects malformed colors and non-strings (undefined)', () => {
    expect(normalizeHexColor('aabbcc')).toBeUndefined(); // no #
    expect(normalizeHexColor('#gggggg')).toBeUndefined();
    expect(normalizeHexColor('#12345')).toBeUndefined(); // wrong length
    expect(normalizeHexColor('#12')).toBeUndefined();
    expect(normalizeHexColor(0xffffff)).toBeUndefined();
  });
});

describe('parseBrandingBody', () => {
  it('returns only the keys that were sent (partial patch)', () => {
    const r = parseBrandingBody({ displayName: 'Acme', primaryColor: '#f00' });
    expect(r).toEqual({ patch: { displayName: 'Acme', primaryColor: '#ff0000' } });
    // untouched keys are absent, not null
    if ('patch' in r) {
      expect('logoUrl' in r.patch).toBe(false);
      expect('accentColor' in r.patch).toBe(false);
    }
  });

  it('lets an explicit null/empty clear a field', () => {
    const r = parseBrandingBody({ logoUrl: null, displayName: '' });
    expect(r).toEqual({ patch: { logoUrl: null, displayName: null } });
  });

  it('rejects the whole request on any invalid field', () => {
    expect(parseBrandingBody({ primaryColor: 'red' })).toEqual({
      error: 'Invalid primaryColor (must be a #rrggbb hex color)',
    });
    expect(parseBrandingBody({ logoUrl: 'http://x/y.png' })).toEqual({
      error: 'Invalid logoUrl (must be an https URL)',
    });
    expect(parseBrandingBody({ accentColor: '#zzz' })).toEqual({
      error: 'Invalid accentColor (must be a #rrggbb hex color)',
    });
    expect(parseBrandingBody({ displayName: 5 })).toEqual({
      error: 'Invalid displayName',
    });
  });

  it('rejects a non-object body', () => {
    expect(parseBrandingBody(null)).toEqual({ error: 'Body must be a JSON object' });
    expect(parseBrandingBody([])).toEqual({ error: 'Body must be a JSON object' });
    expect(parseBrandingBody('x')).toEqual({ error: 'Body must be a JSON object' });
  });

  it('accepts an empty object as a no-op patch', () => {
    expect(parseBrandingBody({})).toEqual({ patch: {} });
  });
});

describe('mergeBranding', () => {
  const current: Branding = {
    displayName: 'Old',
    logoUrl: 'https://old/logo.png',
    primaryColor: '#111111',
    accentColor: '#222222',
  };

  it('overrides only the patched keys, leaves the rest', () => {
    expect(mergeBranding(current, { displayName: 'New' })).toEqual({
      ...current,
      displayName: 'New',
    });
  });

  it('clears a field patched to null', () => {
    expect(mergeBranding(current, { logoUrl: null })).toEqual({
      ...current,
      logoUrl: null,
    });
  });

  it('an empty patch is a full no-op', () => {
    expect(mergeBranding(current, {})).toEqual(current);
  });
});

describe('canManageOrgBranding', () => {
  const ORG = 'org-1';
  const OPERATOR = 'op-1';

  it('platform admin (ADMIN, no org) may manage any org', () => {
    expect(canManageOrgBranding({ id: ORG }, { role: 'ADMIN', orgId: null })).toBe(true);
    expect(canManageOrgBranding({ id: ORG }, { role: 'ADMIN' })).toBe(true);
  });

  it("an org's own admin may manage that org", () => {
    expect(canManageOrgBranding({ id: ORG }, { role: 'ADMIN', orgId: ORG })).toBe(true);
  });

  it('an operator admin may manage a CLIENT beneath them', () => {
    expect(
      canManageOrgBranding({ id: 'client-1', parentOrgId: OPERATOR }, { role: 'ADMIN', orgId: OPERATOR })
    ).toBe(true);
  });

  it('rejects cross-tenant: another org, or another operator’s client', () => {
    expect(canManageOrgBranding({ id: ORG }, { role: 'ADMIN', orgId: 'other' })).toBe(false);
    expect(
      canManageOrgBranding({ id: 'client-1', parentOrgId: 'op-2' }, { role: 'ADMIN', orgId: OPERATOR })
    ).toBe(false);
    expect(
      canManageOrgBranding({ id: 'client-1', parentOrgId: null }, { role: 'ADMIN', orgId: OPERATOR })
    ).toBe(false);
  });

  it('members are never allowed', () => {
    expect(canManageOrgBranding({ id: ORG }, { role: 'MEMBER', orgId: null })).toBe(false);
    expect(canManageOrgBranding({ id: ORG }, { role: 'MEMBER', orgId: ORG })).toBe(false);
    expect(canManageOrgBranding({ id: ORG }, {})).toBe(false);
  });
});

describe('toPublicBranding', () => {
  it('projects slug + the four brand-safe fields', () => {
    const out = toPublicBranding({
      slug: 'acme',
      displayName: 'Acme Training',
      logoUrl: 'https://cdn.acme.example/logo.svg',
      primaryColor: '#112233',
      accentColor: '#445566',
    });
    expect(out).toEqual({
      slug: 'acme',
      displayName: 'Acme Training',
      logoUrl: 'https://cdn.acme.example/logo.svg',
      primaryColor: '#112233',
      accentColor: '#445566',
    });
  });

  it('carries nulls through unchanged (no brand set)', () => {
    const out = toPublicBranding({
      slug: 'plain',
      displayName: null,
      logoUrl: null,
      primaryColor: null,
      accentColor: null,
    });
    expect(out).toEqual({
      slug: 'plain',
      displayName: null,
      logoUrl: null,
      primaryColor: null,
      accentColor: null,
    });
  });

  it('exposes ONLY brand-safe keys — never leaks an extra field', () => {
    // Guards the security contract: even if a caller passes a row with a
    // sensitive field spread in, the projection copies fields explicitly and
    // drops everything else.
    const out = toPublicBranding({
      slug: 'acme',
      displayName: 'Acme',
      logoUrl: null,
      primaryColor: null,
      accentColor: null,
      // extra fields a real org row would carry — must NOT appear on the output
      ...({ name: 'Acme Internal LLC', plan: 'ENTERPRISE', parentOrgId: 'p1', id: 'org-9' } as unknown as Branding),
    });
    expect(Object.keys(out).sort()).toEqual(
      ['accentColor', 'displayName', 'logoUrl', 'primaryColor', 'slug'].sort()
    );
    expect(out as Record<string, unknown>).not.toHaveProperty('name');
    expect(out as Record<string, unknown>).not.toHaveProperty('plan');
    expect(out as Record<string, unknown>).not.toHaveProperty('parentOrgId');
    expect(out as Record<string, unknown>).not.toHaveProperty('id');
  });
});

describe('hasBranding', () => {
  const none: Branding = { displayName: null, logoUrl: null, primaryColor: null, accentColor: null };

  it('is false when every field is null', () => {
    expect(hasBranding(none)).toBe(false);
  });

  it('is true when any single field is set', () => {
    expect(hasBranding({ ...none, displayName: 'Acme' })).toBe(true);
    expect(hasBranding({ ...none, logoUrl: 'https://x.example/l.png' })).toBe(true);
    expect(hasBranding({ ...none, primaryColor: '#000000' })).toBe(true);
    expect(hasBranding({ ...none, accentColor: '#ffffff' })).toBe(true);
  });
});
