/**
 * White-label operator branding helpers (issue #16, Phase 4, R-044).
 *
 * The channel model: an OPERATOR org presents its own brand (name / logo /
 * colors) so the workspace it hands a client looks like the operator's product,
 * not the platform's. This module holds the pure, dependency-free rules the
 * branding management API enforces — validation/normalization for each field
 * and the authorization predicate for who may edit an org's branding — so they
 * can be unit-tested without NextAuth / Neon imports, and so a single source of
 * truth backs the route (mirrors `org-hierarchy.ts` / `session-access.ts`).
 */

/** The four white-label fields. `null` = "fall back to the platform default". */
export interface Branding {
  displayName: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
}

/** A validated partial update — only the keys the caller actually sent. */
export type BrandingPatch = Partial<Branding>;

/** Minimal shape of the authenticated caller. */
export interface OrgManager {
  role?: 'ADMIN' | 'MEMBER';
  orgId?: string | null;
}

/** The org whose branding is being read/written, with the parent link needed
 * to authorize an operator editing one of its client orgs. */
export interface BrandingTarget {
  id: string;
  parentOrgId?: string | null;
}

// Field caps — generous but bounded, so a bad/oversized value can't bloat a row
// or a rendered page.
const MAX_NAME_LEN = 120;
const MAX_URL_LEN = 2048;

/**
 * Normalize a brand display name: trim and length-cap. Returns `null` for an
 * empty/blank value (which clears the field) and `undefined` for a value that
 * is present but invalid (non-string, or over the length cap) so the caller can
 * reject it with a 400 rather than silently dropping it.
 */
export function normalizeBrandName(input: unknown): string | null | undefined {
  if (input === null) return null;
  if (typeof input !== 'string') return undefined;
  const trimmed = input.trim();
  if (trimmed === '') return null;
  if (trimmed.length > MAX_NAME_LEN) return undefined;
  return trimmed;
}

/**
 * Normalize a logo URL: https-only, length-capped. Returns `null` for an
 * empty/blank value (clears the field) and `undefined` for an invalid value
 * (non-string, non-https, unparseable, or over the length cap). https-only
 * keeps mixed-content and non-web schemes (`javascript:`, `data:`) out of the
 * rendered brand.
 */
export function normalizeLogoUrl(input: unknown): string | null | undefined {
  if (input === null) return null;
  if (typeof input !== 'string') return undefined;
  const trimmed = input.trim();
  if (trimmed === '') return null;
  if (trimmed.length > MAX_URL_LEN) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'https:') return undefined;
  return trimmed;
}

/**
 * Normalize a hex color to lowercase `#rrggbb`. Accepts `#rgb` or `#rrggbb`
 * (case-insensitive), expanding the short form. Returns `null` for an
 * empty/blank value (clears the field) and `undefined` for anything that is not
 * a valid hex color (so the caller rejects it with a 400).
 */
export function normalizeHexColor(input: unknown): string | null | undefined {
  if (input === null) return null;
  if (typeof input !== 'string') return undefined;
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const short = /^#([0-9a-fA-F]{3})$/.exec(trimmed);
  if (short) {
    const [r, g, b] = short[1].split('');
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  const long = /^#([0-9a-fA-F]{6})$/.exec(trimmed);
  if (long) return `#${long[1]}`.toLowerCase();
  return undefined;
}

/**
 * Validate a request body into a `BrandingPatch` containing ONLY the keys the
 * caller actually sent (so an update leaves untouched fields unchanged). A key
 * present with `null`/`''` clears that field; a present-but-invalid value fails
 * the whole request. Returns `{ error }` on any invalid field, else `{ patch }`.
 */
export function parseBrandingBody(
  body: unknown
): { error: string } | { patch: BrandingPatch } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { error: 'Body must be a JSON object' };
  }
  const b = body as Record<string, unknown>;
  const patch: BrandingPatch = {};

  const fields: Array<{
    key: keyof Branding;
    bodyKey: string;
    normalize: (v: unknown) => string | null | undefined;
    label: string;
  }> = [
    { key: 'displayName', bodyKey: 'displayName', normalize: normalizeBrandName, label: 'displayName' },
    { key: 'logoUrl', bodyKey: 'logoUrl', normalize: normalizeLogoUrl, label: 'logoUrl (must be an https URL)' },
    { key: 'primaryColor', bodyKey: 'primaryColor', normalize: normalizeHexColor, label: 'primaryColor (must be a #rrggbb hex color)' },
    { key: 'accentColor', bodyKey: 'accentColor', normalize: normalizeHexColor, label: 'accentColor (must be a #rrggbb hex color)' },
  ];

  for (const f of fields) {
    if (!(f.bodyKey in b)) continue; // absent → leave unchanged
    const normalized = f.normalize(b[f.bodyKey]);
    if (normalized === undefined) {
      return { error: `Invalid ${f.label}` };
    }
    patch[f.key] = normalized;
  }

  return { patch };
}

/** Apply a validated patch to the current branding, returning the merged set. */
export function mergeBranding(current: Branding, patch: BrandingPatch): Branding {
  return {
    displayName: 'displayName' in patch ? patch.displayName ?? null : current.displayName,
    logoUrl: 'logoUrl' in patch ? patch.logoUrl ?? null : current.logoUrl,
    primaryColor: 'primaryColor' in patch ? patch.primaryColor ?? null : current.primaryColor,
    accentColor: 'accentColor' in patch ? patch.accentColor ?? null : current.accentColor,
  };
}

/**
 * Whether `viewer` may read/write the branding of the org described by
 * `target`.
 *
 * Rules (tenant isolation), mirroring `canManageOrgClients`:
 *   - Must be an ADMIN. A MEMBER never edits branding.
 *   - A PLATFORM admin (ADMIN with no org) may manage any org's branding.
 *   - An org's own ADMIN (`viewer.orgId === target.id`) may manage that org.
 *   - An OPERATOR admin may manage the branding of a CLIENT org beneath them
 *     (`target.parentOrgId === viewer.orgId`).
 *   - Everything else (another org, another operator's client) → denied.
 */
export function canManageOrgBranding(
  target: BrandingTarget,
  viewer: OrgManager
): boolean {
  if (viewer.role !== 'ADMIN') return false;
  const viewerOrg = viewer.orgId ?? null;
  if (viewerOrg === null) return true; // platform admin
  if (viewerOrg === target.id) return true; // own org
  const parent = target.parentOrgId ?? null;
  return parent !== null && parent === viewerOrg; // operator → own client
}
