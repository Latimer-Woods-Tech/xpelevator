import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unit test for GET /api/branding/[slug] — the PUBLIC, brand-safe read that
// powers the client-facing render surface (R-050). DB mocked; no auth import
// (the route is intentionally unauthenticated). Proves the security contract:
// the response carries ONLY the four white-label fields + slug and NEVER an
// internal org field (name / plan / parentOrgId / id), plus the 404 + 500 paths.

const sqlMock = vi.fn();
vi.mock('@/lib/db', () => ({
  sql: (...args: unknown[]) => sqlMock(...args),
}));

import { GET } from '@/app/api/branding/[slug]/route';

function params(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

function req(slug = 'acme'): Request {
  return new Request(`http://localhost/api/branding/${slug}`);
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

describe('GET /api/branding/[slug]', () => {
  it('returns 200 with the brand-safe projection for a known slug', async () => {
    sqlMock.mockResolvedValueOnce([brandingRow()]);
    const res = await GET(req(), params('acme'));
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
    // Even though the SELECT/row could carry sensitive columns, the response
    // must contain exactly the five brand-safe keys and nothing else.
    sqlMock.mockResolvedValueOnce([
      brandingRow({ name: 'Acme Internal LLC', plan: 'ENTERPRISE', parentOrgId: 'p1', id: 'org-9' }),
    ]);
    const res = await GET(req(), params('acme'));
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(
      ['accentColor', 'displayName', 'logoUrl', 'primaryColor', 'slug'].sort()
    );
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/Acme Internal LLC/);
    expect(text).not.toMatch(/ENTERPRISE/);
    expect(text).not.toMatch(/parentOrgId/);
    expect(text).not.toMatch(/org-9/);
  });

  it('returns nulls for an org with no custom brand', async () => {
    sqlMock.mockResolvedValueOnce([
      brandingRow({
        brandDisplayName: null,
        brandLogoUrl: null,
        brandPrimaryColor: null,
        brandAccentColor: null,
      }),
    ]);
    const res = await GET(req(), params('plain'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      slug: 'acme',
      displayName: null,
      logoUrl: null,
      primaryColor: null,
      accentColor: null,
    });
  });

  it('returns 404 for an unknown slug (no row)', async () => {
    sqlMock.mockResolvedValueOnce([]);
    const res = await GET(req(), params('nope'));
    expect(res.status).toBe(404);
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it('returns 404 for an empty or oversized slug WITHOUT hitting the DB', async () => {
    const empty = await GET(req(), params(''));
    expect(empty.status).toBe(404);
    const huge = await GET(req(), params('x'.repeat(129)));
    expect(huge.status).toBe(404);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('returns 500 when the query throws', async () => {
    sqlMock.mockRejectedValueOnce(new Error('db down'));
    const res = await GET(req(), params('acme'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Failed to read branding');
  });
});
