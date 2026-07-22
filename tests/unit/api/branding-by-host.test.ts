import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unit test for GET /api/branding/by-host — the PUBLIC, brand-safe read that
// resolves an operator's brand from the request Host header, no slug in the path
// (R-055). DB mocked; no auth import (the route is intentionally unauthenticated).
// Proves: an operator subdomain resolves + returns ONLY brand-safe fields; a host
// with no operator subdomain 404s WITHOUT touching the DB; unknown slug 404s; and
// the internal org fields never leak.

const sqlMock = vi.fn();
vi.mock('@/lib/db', () => ({
  sql: (...args: unknown[]) => sqlMock(...args),
}));

import { GET } from '@/app/api/branding/by-host/route';

/** Build a request whose Host header drives resolution. */
function req(host: string | null): Request {
  const headers = new Headers();
  if (host !== null) headers.set('host', host);
  return new Request('http://internal/api/branding/by-host', { headers });
}

/** A stored org row as the route's SELECT shape — includes fields the public
 *  read must NEVER expose, so the test proves they are dropped. */
function brandingRow(over: Record<string, unknown> = {}) {
  return {
    slug: 'acme',
    brandDisplayName: 'Acme Training',
    brandLogoUrl: 'https://cdn.acme.example/logo.svg',
    brandPrimaryColor: '#112233',
    brandAccentColor: '#445566',
    ...over,
  };
}

beforeEach(() => {
  sqlMock.mockReset();
});

describe('GET /api/branding/by-host', () => {
  it('resolves the operator subdomain and returns the brand-safe projection', async () => {
    sqlMock.mockResolvedValueOnce([brandingRow()]);
    const res = await GET(req('acme.xpelevator.com'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toContain('max-age=300');
    const body = await res.json();
    expect(body).toEqual({
      slug: 'acme',
      displayName: 'Acme Training',
      logoUrl: 'https://cdn.acme.example/logo.svg',
      primaryColor: '#112233',
      accentColor: '#445566',
    });
  });

  it('exposes ONLY brand-safe keys — no internal org data', async () => {
    sqlMock.mockResolvedValueOnce([
      brandingRow({
        name: 'Internal Acme LLC',
        plan: 'ENTERPRISE',
        parentOrgId: 'op-1',
        id: 'org-1',
      }),
    ]);
    const res = await GET(req('acme.xpelevator.com'));
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(
      ['accentColor', 'displayName', 'logoUrl', 'primaryColor', 'slug'].sort()
    );
    expect(body).not.toHaveProperty('name');
    expect(body).not.toHaveProperty('plan');
    expect(body).not.toHaveProperty('parentOrgId');
    expect(body).not.toHaveProperty('id');
  });

  it('404s WITHOUT querying when the host carries no operator subdomain', async () => {
    for (const host of [
      'xpelevator.com',
      'www.xpelevator.com',
      'xpelevator-sim.pages.dev',
      'localhost:3000',
      null,
    ]) {
      const res = await GET(req(host));
      expect(res.status).toBe(404);
    }
    // Never reached the database for any non-operator host.
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('404s a resolved-but-absent operator slug', async () => {
    sqlMock.mockResolvedValueOnce([]);
    const res = await GET(req('ghost.xpelevator.com'));
    expect(res.status).toBe(404);
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it('500s on a database error', async () => {
    sqlMock.mockRejectedValueOnce(new Error('db down'));
    const res = await GET(req('acme.xpelevator.com'));
    expect(res.status).toBe(500);
  });
});
