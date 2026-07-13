import { describe, it, expect } from 'vitest';
import {
  brandingToForm,
  validateBrandingForm,
  EMPTY_BRANDING_FORM,
  type BrandingForm,
} from '@/lib/branding-form';
import type { Branding } from '@/lib/branding';

describe('EMPTY_BRANDING_FORM', () => {
  it('is all-blank', () => {
    expect(EMPTY_BRANDING_FORM).toEqual({
      displayName: '',
      logoUrl: '',
      primaryColor: '',
      accentColor: '',
    });
  });
});

describe('brandingToForm', () => {
  it('maps stored values through unchanged', () => {
    const stored: Branding = {
      displayName: 'Northwind',
      logoUrl: 'https://cdn.example.com/logo.svg',
      primaryColor: '#2563eb',
      accentColor: '#22d3ee',
    };
    expect(brandingToForm(stored)).toEqual(stored);
  });

  it('turns null fields into empty strings for controlled inputs', () => {
    const stored: Branding = {
      displayName: null,
      logoUrl: null,
      primaryColor: null,
      accentColor: null,
    };
    expect(brandingToForm(stored)).toEqual(EMPTY_BRANDING_FORM);
  });

  it('handles a partially-set brand', () => {
    const stored: Branding = {
      displayName: 'Acme',
      logoUrl: null,
      primaryColor: '#ff0000',
      accentColor: null,
    };
    expect(brandingToForm(stored)).toEqual({
      displayName: 'Acme',
      logoUrl: '',
      primaryColor: '#ff0000',
      accentColor: '',
    });
  });
});

describe('validateBrandingForm', () => {
  const base: BrandingForm = {
    displayName: 'Northwind',
    logoUrl: 'https://cdn.example.com/logo.svg',
    primaryColor: '#2563eb',
    accentColor: '#22d3ee',
  };

  it('accepts a fully-valid form and normalizes to a Branding body', () => {
    const result = validateBrandingForm(base);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body).toEqual({
        displayName: 'Northwind',
        logoUrl: 'https://cdn.example.com/logo.svg',
        primaryColor: '#2563eb',
        accentColor: '#22d3ee',
      });
    }
  });

  it('trims the name and expands short-hex colors (server normalizers)', () => {
    const result = validateBrandingForm({
      displayName: '  Acme Training  ',
      logoUrl: '  https://x.io/l.png  ',
      primaryColor: '#ABC',
      accentColor: '#Def',
    });
    expect(result).toEqual({
      ok: true,
      body: {
        displayName: 'Acme Training',
        logoUrl: 'https://x.io/l.png',
        primaryColor: '#aabbcc',
        accentColor: '#ddeeff',
      },
    });
  });

  it('treats every blank field as a clear (null)', () => {
    const result = validateBrandingForm(EMPTY_BRANDING_FORM);
    expect(result).toEqual({
      ok: true,
      body: { displayName: null, logoUrl: null, primaryColor: null, accentColor: null },
    });
  });

  it('rejects an over-long name', () => {
    const result = validateBrandingForm({ ...base, displayName: 'x'.repeat(121) });
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/name is too long/i) });
  });

  it('rejects a non-https logo URL', () => {
    const result = validateBrandingForm({ ...base, logoUrl: 'http://x.io/l.png' });
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/https/i) });
  });

  it('rejects a malformed primary color', () => {
    const result = validateBrandingForm({ ...base, primaryColor: 'blue' });
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/primary color/i) });
  });

  it('rejects a malformed accent color', () => {
    const result = validateBrandingForm({ ...base, accentColor: '#12' });
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/accent color/i) });
  });

  it('reports the FIRST invalid field (name before logo)', () => {
    const result = validateBrandingForm({
      displayName: 'x'.repeat(200),
      logoUrl: 'not-a-url',
      primaryColor: 'nope',
      accentColor: 'nope',
    });
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/name is too long/i) });
  });
});
