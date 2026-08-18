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
import { resolveInheritedBranding, toPublicBranding, type Branding } from '@/lib/branding';
import { resolveOperatorSlugFromHost } from '@/lib/host';
import { enforceRateLimit } from '@/lib/rate-limit';
import { errorFields, log, requestIdFrom } from '@/lib/log';

interface PublicBrandingRow {
  slug: string;
  /** Set when this org is a CLIENT owned by an OPERATOR — drives inheritance. */
  parentOrgId: string | null;
  brandDisplayName: string | null;
  brandLogoUrl: string | null;
  brandPrimaryColor: string | null;
  brandAccentColor: string | null;
  // The parent OPERATOR's brand columns (all null when there is no parent).
  parentBrandDisplayName: string | null;
  parentBrandLogoUrl: string | null;
  parentBrandPrimaryColor: string | null;
  parentBrandAccentColor: string | null;
}

export async function GET(request: Request) {
  try {
    // Shares the anonymous 'branding' budget with the slug read (#157).
    const limited = await enforceRateLimit(request, 'branding');
    if (limited) return limited;

    const slug = resolveOperatorSlugFromHost(request.headers.get('host'));

    if (slug === null) {
      // No operator subdomain on this host → fall back to the platform default.
      return NextResponse.json(
        { error: 'No operator brand for this host' },
        { status: 404 }
      );
    }

    // Self-join to the parent operator for the same inheritance the slug read
    // does. A host-resolved slug is an operator subdomain (top-level, no parent)
    // so the LEFT JOIN is a no-op here today; kept symmetric with the slug read
    // so "the public resolver inherits" is one invariant, not two.
    const rows = await sql`
      SELECT
        o.slug,
        o.parent_org_id       as "parentOrgId",
        o.brand_display_name  as "brandDisplayName",
        o.brand_logo_url      as "brandLogoUrl",
        o.brand_primary_color as "brandPrimaryColor",
        o.brand_accent_color  as "brandAccentColor",
        p.brand_display_name  as "parentBrandDisplayName",
        p.brand_logo_url      as "parentBrandLogoUrl",
        p.brand_primary_color as "parentBrandPrimaryColor",
        p.brand_accent_color  as "parentBrandAccentColor"
      FROM organizations o
      LEFT JOIN organizations p ON p.id = o.parent_org_id
      WHERE o.slug = ${slug}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    const row = rows[0] as PublicBrandingRow;
    const own: Branding = {
      displayName: row.brandDisplayName,
      logoUrl: row.brandLogoUrl,
      primaryColor: row.brandPrimaryColor,
      accentColor: row.brandAccentColor,
    };
    const parent: Branding | null = row.parentOrgId
      ? {
          displayName: row.parentBrandDisplayName ?? null,
          logoUrl: row.parentBrandLogoUrl ?? null,
          primaryColor: row.parentBrandPrimaryColor ?? null,
          accentColor: row.parentBrandAccentColor ?? null,
        }
      : null;
    const branding = toPublicBranding({
      slug: row.slug,
      ...resolveInheritedBranding(own, parent),
    });

    return NextResponse.json(branding, {
      headers: { 'Cache-Control': 'public, max-age=300' },
    });
  } catch (error) {
    const requestId = requestIdFrom(request.headers);
    log('error', 'branding.host_read_failed', { requestId, ...errorFields(error) });
    return NextResponse.json({ error: 'Failed to read branding' }, { status: 500 });
  }
}
