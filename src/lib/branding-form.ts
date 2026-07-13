/**
 * Operator branding-editor form helpers (issue #16, Phase 4, R-049 — closes the
 * in-workspace half of R-040).
 *
 * The `/operator` workspace ships a form that lets an operator admin set their
 * white-label brand (name / logo / colors) and PUT it to
 * `/api/orgs/[id]/branding`. This module holds the pure, dependency-free glue
 * between the stored `Branding` (nullable fields) and the controlled-input form
 * (all-string fields), plus a client-side pre-validation that reuses the SAME
 * normalizers the server enforces — so the page and its tests share one source
 * of truth and the UI never accepts a value the API would reject (mirrors
 * `branding.ts` / `operator-workspace.ts`).
 *
 * The server re-validates every field on write; `validateBrandingForm` is a
 * friendly pre-check that surfaces the error inline before the round-trip, never
 * the security gate.
 */
import {
  normalizeBrandName,
  normalizeLogoUrl,
  normalizeHexColor,
  type Branding,
} from './branding';

/** The four white-label fields as controlled-input strings ('' = "unset"). */
export interface BrandingForm {
  displayName: string;
  logoUrl: string;
  primaryColor: string;
  accentColor: string;
}

/** A pristine, all-blank form (every field falls back to the platform default). */
export const EMPTY_BRANDING_FORM: BrandingForm = {
  displayName: '',
  logoUrl: '',
  primaryColor: '',
  accentColor: '',
};

/**
 * Map stored branding (nullable fields) into controlled-input strings — a
 * `null` field (fall back to the platform default) becomes an empty string so
 * the input renders blank.
 */
export function brandingToForm(b: Branding): BrandingForm {
  return {
    displayName: b.displayName ?? '',
    logoUrl: b.logoUrl ?? '',
    primaryColor: b.primaryColor ?? '',
    accentColor: b.accentColor ?? '',
  };
}

/**
 * Validate the four form fields client-side (reusing the exact normalizers the
 * server enforces) and build the full `Branding` PUT body. Each blank field
 * normalizes to `null`, which clears it. Returns the first field error for
 * inline display, or the normalized body ready to send. The server re-validates
 * on write — this is a pre-check, not the gate.
 */
export function validateBrandingForm(
  form: BrandingForm
): { ok: true; body: Branding } | { ok: false; error: string } {
  const displayName = normalizeBrandName(form.displayName);
  if (displayName === undefined) {
    return { ok: false, error: 'Brand name is too long (max 120 characters).' };
  }
  const logoUrl = normalizeLogoUrl(form.logoUrl);
  if (logoUrl === undefined) {
    return { ok: false, error: 'Logo must be an https:// URL.' };
  }
  const primaryColor = normalizeHexColor(form.primaryColor);
  if (primaryColor === undefined) {
    return { ok: false, error: 'Primary color must be a hex value like #2563eb.' };
  }
  const accentColor = normalizeHexColor(form.accentColor);
  if (accentColor === undefined) {
    return { ok: false, error: 'Accent color must be a hex value like #22d3ee.' };
  }
  return { ok: true, body: { displayName, logoUrl, primaryColor, accentColor } };
}
