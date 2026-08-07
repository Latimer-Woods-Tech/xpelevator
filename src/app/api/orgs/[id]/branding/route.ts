/**
 * GET  /api/orgs/[id]/branding  — read org [id]'s white-label branding
 * PUT  /api/orgs/[id]/branding  — update org [id]'s white-label branding
 *
 * White-label operator branding (issue #16, Phase 4, R-044). An OPERATOR org
 * presents its own brand (name / logo / colors) so the workspace it hands a
 * client looks like the operator's product. This ships the branding data-model
 * + admin management API; the operator subdomain and the client-facing render
 * surface are later slices.
 *
 * Security + tenancy:
 *   - ADMIN only (`requireAuth(_, ADMIN)`): anon → 401 (middleware + handler),
 *     non-admin → 403.
 *   - Strictly scoped by `canManageOrgBranding`: a platform admin (no org) may
 *     manage any org; an org's own admin may manage that org; an operator admin
 *     may manage a CLIENT org beneath them — never another org's branding
 *     (cross-tenant → 403).
 *   - The org [id] must exist (404).
 *   - PUT validates every field (https-only logo, `#rrggbb` colors, capped
 *     name); an invalid field fails the whole request (400). A field sent as
 *     `null`/`""` clears it; an omitted field is left unchanged.
 */
import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAuth, AuthError } from '@/lib/auth-api';
import { recordAudit } from '@/lib/audit';
import {
  canManageOrgBranding,
  parseBrandingBody,
  mergeBranding,
  type Branding,
} from '@/lib/branding';

/** The branding fields, for a before/after diff (audit records real changes only). */
const BRANDING_FIELDS = ['displayName', 'logoUrl', 'primaryColor', 'accentColor'] as const;

/** Names of the branding fields whose value actually changed. */
function changedBrandingFields(before: Branding, after: Branding): string[] {
  return BRANDING_FIELDS.filter((f) => (before[f] ?? null) !== (after[f] ?? null));
}

interface OrgBrandingRow {
  id: string;
  parentOrgId: string | null;
  brandDisplayName: string | null;
  brandLogoUrl: string | null;
  brandPrimaryColor: string | null;
  brandAccentColor: string | null;
}

function rowToBranding(row: OrgBrandingRow): Branding {
  return {
    displayName: row.brandDisplayName,
    logoUrl: row.brandLogoUrl,
    primaryColor: row.brandPrimaryColor,
    accentColor: row.brandAccentColor,
  };
}

/** Load the org's id + parent + branding, or `null` if it does not exist. */
async function loadOrg(id: string): Promise<OrgBrandingRow | null> {
  const rows = await sql`
    SELECT
      id,
      parent_org_id       as "parentOrgId",
      brand_display_name  as "brandDisplayName",
      brand_logo_url      as "brandLogoUrl",
      brand_primary_color as "brandPrimaryColor",
      brand_accent_color  as "brandAccentColor"
    FROM organizations
    WHERE id = ${id}
    LIMIT 1
  `;
  return rows.length > 0 ? (rows[0] as OrgBrandingRow) : null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { session } = await requireAuth(request, 'ADMIN');
    const { id } = await params;

    const org = await loadOrg(id);
    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    if (!canManageOrgBranding({ id: org.id, parentOrgId: org.parentOrgId }, session.user)) {
      return NextResponse.json(
        { error: 'You may only manage branding for your own org or the clients beneath it' },
        { status: 403 }
      );
    }

    return NextResponse.json(rowToBranding(org));
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Failed to read org branding:', error);
    return NextResponse.json({ error: 'Failed to read org branding' }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { session } = await requireAuth(request, 'ADMIN');
    const { id } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = parseBrandingBody(body);
    if ('error' in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const org = await loadOrg(id);
    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    if (!canManageOrgBranding({ id: org.id, parentOrgId: org.parentOrgId }, session.user)) {
      return NextResponse.json(
        { error: 'You may only manage branding for your own org or the clients beneath it' },
        { status: 403 }
      );
    }

    const before = rowToBranding(org);
    const merged = mergeBranding(before, parsed.patch);

    const updated = await sql`
      UPDATE organizations
      SET
        brand_display_name  = ${merged.displayName},
        brand_logo_url      = ${merged.logoUrl},
        brand_primary_color = ${merged.primaryColor},
        brand_accent_color  = ${merged.accentColor}
      WHERE id = ${id}
      RETURNING
        id,
        parent_org_id       as "parentOrgId",
        brand_display_name  as "brandDisplayName",
        brand_logo_url      as "brandLogoUrl",
        brand_primary_color as "brandPrimaryColor",
        brand_accent_color  as "brandAccentColor"
    `;

    const after = rowToBranding(updated[0] as OrgBrandingRow);

    // Audit only a REAL change (issue #157 §10): a PUT that merges to the same
    // values (e.g. re-saving the form unchanged, or only omitted fields) alters
    // nothing, so it writes no audit row. Metadata carries the changed field
    // NAMES only — a logo URL / colour is not a secret but the trail needs the
    // "what changed", not the values.
    const changed = changedBrandingFields(before, after);
    if (changed.length > 0) {
      await recordAudit({
        action: 'org.branding.update',
        actorUserId: session.user.dbUserId,
        actorEmail: session.user.email,
        orgId: id,
        targetType: 'organization',
        targetId: id,
        metadata: { changed },
      });
    }

    return NextResponse.json(after);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Failed to update org branding:', error);
    return NextResponse.json({ error: 'Failed to update org branding' }, { status: 500 });
  }
}
