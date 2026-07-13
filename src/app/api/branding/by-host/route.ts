/**
 * GET /api/branding/by-host — PUBLIC, brand-safe read of an operator's
 * white-label branding resolved from the request's `Host` header, with no slug
 * in the URL path.
 *
 * This is the operator-subdomain half of the client-facing render surface
 * (issue #16, Phase 4, R-055; the "operator subdomain" line of R-044). Where
 * `GET /api/branding/[slug]` (R-050) needs the operator's slug in the path, this
 * route derives it from `<operator>.xpelevator.com` via
 * `resolveOperatorSlugFromHost` — so a trainee who arrives at the operator's own
 * subdomain sees the operator's brand on the login shell before authenticating,
 * without the slug ever appearing in the URL.
 *
 * Security contract (identical to the slug read — safe to be public):
 *   - Returns ONLY the four white-label fields + the resolved slug
 *     (`toPublicBranding`). Never the internal org `name`, `plan`, `parentOrgId`,
 *     id, or any member / tenant data. The SELECT lists only brand-safe columns
 *     and the projection copies fields explicitly — a new sensitive column can't
 *     leak.
 *   - A host that carries no operator subdomain (the apex, `www`, the
 *     `*.pages.dev` deploy alias, localhost, an IP, a reserved or invalid label)
 *     resolves to `null` → 404 with no query run: "no operator; render the
 *     platform default". Branding is presentation, never a gate — an unresolved
 *     host is a 404, not an error.
 *   - Unknown (resolved-but-absent) slug → 404, same as the slug read.
 *   - Public by design in `middleware.ts` (`/api/branding` prefix); read-only,
 *     no write verb under the prefix. `by-host` is a static segment so it takes
 *     precedence over `[slug]` for this exact path and never reads a
 *     caller-supplied path value.
 */
import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { toPublicBranding } from '@/lib/branding';
import { resolveOperatorSlugFromHost } from '@/lib/host';

interface PublicBrandingRow {
  slug: string;
  brandDisplayName: string | null;
  brandLogoUrl: string | null;
  brandPrimaryColor: string | null;
  brandAccentColor: string | null;
}

export async function GET(request: Request) {
  try {
    const slug = resolveOperatorSlugFromHost(request.headers.get('host'));

    if (slug === null) {
      // No operator subdomain on this host → fall back to the platform default.
      return NextResponse.json(
        { error: 'No operator brand for this host' },
        { status: 404 }
      );
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
    console.error('Failed to read host-resolved branding:', error);
    return NextResponse.json({ error: 'Failed to read branding' }, { status: 500 });
  }
}
