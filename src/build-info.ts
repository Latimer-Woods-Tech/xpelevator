/**
 * Build identity for /api/health (Factory gap G72).
 *
 * This committed default is what local dev and CI builds compile. The deploy
 * workflow (.github/workflows/deploy.yml, "Stamp build info" step) OVERWRITES
 * this file with the real ${GITHUB_SHA} + UTC timestamp immediately before the
 * OpenNext build, so the promoted production build always reports exactly
 * which commit it was built from. A generated module (not process.env) because
 * Cloudflare Pages runtime env does not reliably carry build-time vars.
 */
export const buildInfo: { commit: string; builtAt: string | null } = {
  commit: 'dev',
  builtAt: null,
};
