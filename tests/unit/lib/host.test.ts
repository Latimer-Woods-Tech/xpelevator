import { describe, it, expect } from 'vitest';
import {
  resolveOperatorSlugFromHost,
  isValidOperatorSlug,
  RESERVED_SUBDOMAINS,
} from '@/lib/host';

// Unit tests for the operator-subdomain resolver (R-055) — the pure rule that
// maps a `Host` header to the operator slug whose brand should render on
// `<operator>.xpelevator.com`. Proves the conservative contract: a single-label
// subdomain of a base domain resolves; the apex, reserved labels, the pages.dev
// alias, localhost, IPs, deep hosts, and malformed labels all fall through to
// `null` ("no operator; render the platform default").

describe('isValidOperatorSlug', () => {
  it('accepts slugify-shaped labels', () => {
    expect(isValidOperatorSlug('acme')).toBe(true);
    expect(isValidOperatorSlug('acme-training')).toBe(true);
    expect(isValidOperatorSlug('a1b2-c3')).toBe(true);
    expect(isValidOperatorSlug('x')).toBe(true);
  });

  it('rejects empty, over-long, and non-slug shapes', () => {
    expect(isValidOperatorSlug('')).toBe(false);
    expect(isValidOperatorSlug('a'.repeat(129))).toBe(false);
    expect(isValidOperatorSlug('-acme')).toBe(false); // leading hyphen
    expect(isValidOperatorSlug('acme-')).toBe(false); // trailing hyphen
    expect(isValidOperatorSlug('ac--me')).toBe(false); // double hyphen
    expect(isValidOperatorSlug('Acme')).toBe(false); // uppercase
    expect(isValidOperatorSlug('a_b')).toBe(false); // underscore
    expect(isValidOperatorSlug('a.b')).toBe(false); // dot
  });
});

describe('resolveOperatorSlugFromHost — resolves an operator subdomain', () => {
  it('maps a single-label subdomain of the base domain to its slug', () => {
    expect(resolveOperatorSlugFromHost('acme.xpelevator.com')).toBe('acme');
    expect(resolveOperatorSlugFromHost('acme-training.xpelevator.com')).toBe(
      'acme-training'
    );
  });

  it('is case-insensitive and strips a port', () => {
    expect(resolveOperatorSlugFromHost('ACME.XPElevator.com')).toBe('acme');
    expect(resolveOperatorSlugFromHost('acme.xpelevator.com:443')).toBe('acme');
    expect(resolveOperatorSlugFromHost('  acme.xpelevator.com  ')).toBe('acme');
  });

  it('strips a trailing FQDN root dot', () => {
    expect(resolveOperatorSlugFromHost('acme.xpelevator.com.')).toBe('acme');
  });
});

describe('resolveOperatorSlugFromHost — falls through to null', () => {
  it('null/blank/non-string host', () => {
    expect(resolveOperatorSlugFromHost(null)).toBeNull();
    expect(resolveOperatorSlugFromHost(undefined)).toBeNull();
    expect(resolveOperatorSlugFromHost('')).toBeNull();
    expect(resolveOperatorSlugFromHost('   ')).toBeNull();
    // @ts-expect-error — defensive: a non-string must not throw
    expect(resolveOperatorSlugFromHost(42)).toBeNull();
  });

  it('the apex and www (no operator subdomain)', () => {
    expect(resolveOperatorSlugFromHost('xpelevator.com')).toBeNull();
    expect(resolveOperatorSlugFromHost('www.xpelevator.com')).toBeNull();
  });

  it('every reserved platform label', () => {
    for (const label of RESERVED_SUBDOMAINS) {
      expect(resolveOperatorSlugFromHost(`${label}.xpelevator.com`)).toBeNull();
    }
  });

  it('the pages.dev deploy alias and other unknown domains', () => {
    expect(resolveOperatorSlugFromHost('xpelevator-sim.pages.dev')).toBeNull();
    expect(resolveOperatorSlugFromHost('acme.pages.dev')).toBeNull();
    expect(resolveOperatorSlugFromHost('acme.example.com')).toBeNull();
  });

  it('localhost and IP literals', () => {
    expect(resolveOperatorSlugFromHost('localhost')).toBeNull();
    expect(resolveOperatorSlugFromHost('localhost:3000')).toBeNull();
    expect(resolveOperatorSlugFromHost('127.0.0.1')).toBeNull();
    expect(resolveOperatorSlugFromHost('192.168.1.10:8080')).toBeNull();
    expect(resolveOperatorSlugFromHost('[::1]:3000')).toBeNull();
  });

  it('a deep multi-label subdomain (never an operator)', () => {
    expect(resolveOperatorSlugFromHost('a.b.xpelevator.com')).toBeNull();
    expect(resolveOperatorSlugFromHost('deep.acme.xpelevator.com')).toBeNull();
  });

  it('a syntactically invalid slug label', () => {
    expect(resolveOperatorSlugFromHost('Acme_Corp.xpelevator.com')).toBeNull();
    expect(resolveOperatorSlugFromHost('-acme.xpelevator.com')).toBeNull();
  });

  it('a look-alike suffix that is not a true subdomain boundary', () => {
    // `notxpelevator.com` ends with `xpelevator.com` but not with the
    // `.xpelevator.com` label boundary — must not resolve.
    expect(resolveOperatorSlugFromHost('notxpelevator.com')).toBeNull();
    expect(resolveOperatorSlugFromHost('evilxpelevator.com')).toBeNull();
  });
});

describe('resolveOperatorSlugFromHost — injectable base domains', () => {
  it('resolves against a custom base domain set', () => {
    expect(
      resolveOperatorSlugFromHost('acme.example.test', ['example.test'])
    ).toBe('acme');
    expect(
      resolveOperatorSlugFromHost('acme.xpelevator.com', ['example.test'])
    ).toBeNull();
  });
});
