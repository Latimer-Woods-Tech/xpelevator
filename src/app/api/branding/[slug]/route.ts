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
import { resolveInheritedBranding, toPublicBranding, type Branding } from '@/lib/branding';
import { enforceRateLimit } from '@/lib/rate-limit';
import { errorFields, log, requestIdFrom } from '@/lib/log';

// A slug is lowercase alphanumerics + hyphens (see `slugify` in
// `src/lib/org-hierarchy.ts`). Bounding the input keeps a malformed or oversized
// value from reaching the query at all.
const MAX_SLUG_LEN = 128;

interface PublicBrandingRow {
  slug: string;
  /** Set when this org is a CLIENT owned by an OPERATOR — drives inheritance. */
  parentOrgId: string | null;
  brandDisplayName: string | null;
  brandLogoUrl: string | null;
  brandPrimaryColor: string | null;
  brandAccentColor: string | null;
  // The parent OPERATOR's brand columns (all null when there is no parent), so a
  // CLIENT that left a field unset inherits its operator's value for it.
  parentBrandDisplayName: string | null;
  parentBrandLogoUrl: string | null;
  parentBrandPrimaryColor: string | null;
  parentBrandAccentColor: string | null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    // Anonymous, always-public enumeration point (#157): throttle per-IP before
    // any DB work so a slug-guessing sweep can't run unbounded.
    const limited = await enforceRateLimit(request, 'branding');
    if (limited) return limited;

    const { slug } = await params;

    if (typeof slug !== 'string' || slug.length === 0 || slug.length > MAX_SLUG_LEN) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    // Self-join to the parent OPERATOR so a CLIENT org inherits any brand field
    // it left unset — the white-label channel model (R-050). The LEFT JOIN
    // yields all-null parent columns for a top-level org (no parent), so the
    // inheritance helper is a no-op there.
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
    // Only build a parent set when this org actually has a parent operator; an
    // org with no parent inherits nothing (helper returns `own` unchanged).
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
    log('error', 'branding.public_read_failed', { requestId, ...errorFields(error) });
    return NextResponse.json({ error: 'Failed to read branding' }, { status: 500 });
  }
}
