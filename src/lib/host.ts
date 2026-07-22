/**
 * Operator subdomain resolution (issue #16, Phase 4, R-055 — the remaining
 * "operator subdomain" half of white-label branding, R-044).
 *
 * The channel model's launch rung: an operator's clients arrive at
 * `<operator>.xpelevator.com` and see the operator's brand before they sign in,
 * without the slug ever appearing in the URL path. This module holds the pure,
 * dependency-free rule that maps an incoming `Host` header to the operator slug
 * whose branding should render — so it can be unit-tested without Next.js /
 * Neon imports, and so a single source of truth backs the host-resolved public
 * read (`GET /api/branding/by-host`) and any future host-aware surface.
 *
 * It is deliberately conservative. It resolves ONLY a single-label subdomain of
 * a known operator base domain, and only when that label is a valid org slug
 * (the exact shape `slugify` produces in `org-hierarchy.ts`) and is not a
 * reserved platform label. Everything else — the apex, `www`, the `*.pages.dev`
 * deploy alias, `localhost`, an IP literal, a deep multi-label host — resolves
 * to `null`, meaning "no operator; render the platform default". Branding is
 * presentation, never a gate, so an unresolved host is never an error.
 */

/**
 * The registrable base domains under which an operator subdomain lives. Only
 * the branded apex qualifies — the `*.pages.dev` deploy alias and `localhost`
 * are platform-owned hosts and never carry an operator subdomain, so they fall
 * through to `null` (platform default).
 */
export const OPERATOR_BASE_DOMAINS = ['xpelevator.com'] as const;

/**
 * Subdomain labels reserved for the platform itself — never an operator slug.
 * A request to any of these under a base domain resolves to `null` so it can
 * never be mistaken for (or shadow) a tenant's brand.
 */
export const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  'www',
  'api',
  'app',
  'admin',
  'mail',
  'static',
  'assets',
  'cdn',
  'staging',
  'preview',
]);

// A slug is what `slugify` emits: lowercase alphanumerics in hyphen-separated
// groups, no leading/trailing hyphen. Bounding the length keeps a malformed or
// oversized label from reaching a query at all.
const MAX_SLUG_LEN = 128;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Whether `label` is a syntactically valid operator slug (shape + length). */
export function isValidOperatorSlug(label: string): boolean {
  return label.length > 0 && label.length <= MAX_SLUG_LEN && SLUG_RE.test(label);
}

/**
 * Resolve the operator slug a `Host` header should render, or `null` when the
 * host carries no operator subdomain (apex, reserved label, deploy alias,
 * localhost, IP, multi-label host, or an invalid slug label).
 *
 * `host` may include a port (`acme.xpelevator.com:443`) and/or a trailing FQDN
 * dot; both are stripped before matching, and matching is case-insensitive.
 * `baseDomains` is injectable for tests but defaults to the production set.
 */
export function resolveOperatorSlugFromHost(
  host: string | null | undefined,
  baseDomains: readonly string[] = OPERATOR_BASE_DOMAINS
): string | null {
  if (typeof host !== 'string') return null;

  let h = host.trim().toLowerCase();
  if (h === '') return null;

  // Bracketed IPv6 literals (`[::1]`) are never an operator host.
  if (h.startsWith('[')) return null;

  // Strip a trailing FQDN root dot, then any `:port` suffix.
  h = h.replace(/\.+$/, '');
  const colon = h.indexOf(':');
  if (colon !== -1) h = h.slice(0, colon);
  if (h === '') return null;

  for (const base of baseDomains) {
    const suffix = '.' + base;
    if (!h.endsWith(suffix)) continue;

    const label = h.slice(0, h.length - suffix.length);
    if (label === '') return null; // exactly the apex
    if (label.includes('.')) return null; // multi-label subdomain — not an operator
    if (RESERVED_SUBDOMAINS.has(label)) return null;
    if (!isValidOperatorSlug(label)) return null;
    return label;
  }

  // Apex, unknown domain, *.pages.dev alias, localhost, IPv4 — no operator.
  return null;
}
