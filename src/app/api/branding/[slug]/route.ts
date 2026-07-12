/**
 * GET /api/branding/[slug] — PUBLIC, brand-safe read of an org's white-label
 * branding, keyed by its URL slug.
 *
 * This is the read half of the client-facing render surface (issue #16,
 * Phase 4, R-050). The admin write path (`PUT /api/orgs/[id]/branding`, R-049)
 * lets an operator SET a name / logo / colors; this route lets the operator's
 * brand actually SHOW on the login / workspace shell for anyone who arrives via
 * the operator's slug — before they authenticate.
 *
 * Security contract (why this is safe to be public):
 *   - Returns ONLY the four white-label fields + the slug (`toPublicBranding`).
 *     Never the internal org `name`, `plan`, `parentOrgId`, id, or any member /
 *     tenant data. The SELECT lists only the brand-safe columns, and the
 *     projection copies fields explicitly — a new sensitive column can't leak.
 *   - Colors are stored normalized to `#rrggbb` and the logo URL is https-only
 *     (validated on write in `src/lib/branding.ts`), so nothing unsafe reaches
 *     the rendered page.
 *   - Unknown slug → 404 (the same shape as a real org with no branding would
 *     differ only in the null fields, so this leaks nothing about existence
 *     beyond the slug the caller already supplied).
 *   - Public by design in `middleware.ts` (`/api/branding` prefix); there is no
 *     write verb on this path.
 */
import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { toPublicBranding } from '@/lib/branding';

// A slug is lowercase alphanumerics + hyphens (see `slugify` in
// `src/lib/org-hierarchy.ts`). Bounding the input keeps a malformed or oversized
// value from reaching the query at all.
const MAX_SLUG_LEN = 128;

interface PublicBrandingRow {
  slug: string;
  brandDisplayName: string | null;
  brandLogoUrl: string | null;
  brandPrimaryColor: string | null;
  brandAccentColor: string | null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    if (typeof slug !== 'string' || slug.length === 0 || slug.length > MAX_SLUG_LEN) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    const rows = await sql`
      SELECT
        slug,
        brand_display_name  as "brandDisplayName",
        brand_logo_url      as "brandLogoUrl",
        brand_primary_color as "brandPrimaryColor",
        brand_accent_color  as "brandAccentColor"
      FROM organizations
      WHERE slug = ${slug}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    const row = rows[0] as PublicBrandingRow;
    const branding = toPublicBranding({
      slug: row.slug,
      displayName: row.brandDisplayName,
      logoUrl: row.brandLogoUrl,
      primaryColor: row.brandPrimaryColor,
      accentColor: row.brandAccentColor,
    });

    return NextResponse.json(branding, {
      headers: { 'Cache-Control': 'public, max-age=300' },
    });
  } catch (error) {
    console.error('Failed to read public branding:', error);
    return NextResponse.json({ error: 'Failed to read branding' }, { status: 500 });
  }
}
