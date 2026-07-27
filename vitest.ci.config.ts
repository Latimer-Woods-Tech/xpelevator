import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * CI coverage gate — deterministic tiers only.
 *
 * The base `vitest.config.ts` runs EVERY tier (including integration/smoke,
 * which hit live Neon + Groq via `tests/setup.ts`) and can't be a required
 * gate: it flakes on credentials and drifts. This config isolates the two
 * DETERMINISTIC tiers — `tests/unit` and `tests/ui` (all deps mocked, no DB /
 * LLM / Telnyx creds) — and enforces a real coverage floor on the pure
 * business-logic surface (`src/lib/**`).
 *
 * Runtime-only glue that cannot be exercised without a live Cloudflare/Neon
 * binding is excluded from the measured surface (it belongs to the integration
 * tier, not this deterministic gate):
 *   - db.ts / prisma.ts         — client construction against a real binding
 *   - http-agent-polyfill.ts    — Node undici polyfill, no logic to assert
 *
 * API routes (`src/app/api/**`) join this gate INCREMENTALLY (issue #16, P2-7):
 * a route is added to `include` below only once it has a DETERMINISTIC test
 * under `tests/unit/api/**` (mocks `@/lib/db` + `@/lib/auth-api`, no live
 * creds — the pattern that replaces the credential-bound `tests/integration`
 * tier and the `DISABLE_AUTH` crutch). An explicit allowlist keeps the floor
 * honest: an untested route can't silently drag the measured percentage.
 * Routes under the gate (16): `analytics`, `analytics/latency`, `plans`, `me`,
 * `health`, `reports/sessions`, `branding/[slug]`, `branding/by-host`,
 * `orgs/[id]/branding`, `orgs/[id]/clients`, `orgs/[id]/members`,
 * `scenario-packs`, `scenario-packs/import`, `scenario-packs/status`, `scoring`,
 * `scenario-packs/upgrade` (each ≥ the floors — `scenario-packs/upgrade` at 100%
 * branch after the null-version / no-match-UPDATE / no-job-title / ON-CONFLICT
 * cases added this slice). NOT yet gated because they sit below the 85% branch
 * floor and need more deterministic tests first: `simulations` (~44%),
 * `telnyx/call` (~81%), `scenarios*`, `jobs/[id]/criteria`. Retiring the
 * credential-bound `tests/integration` tier + the `DISABLE_AUTH` crutch (P1-7)
 * follows once the remaining routes finish the sweep.
 *
 * Thresholds sit below the currently-achieved numbers (lines ~97, branches ~91,
 * functions ~99) so ordinary edits don't flake the gate, while still catching a
 * real regression. Target per PLATFORM_STANDARDS §3-4: 80 line / 85 branch / 70
 * function — ALL THREE now met and gated: the branch floor is at the §3-4 target
 * of 85 (achieved ~91, a healthy margin), completing the "branches ratchet toward
 * 85" Phase-3 sub-slice tracked in issue #16.
 */
export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['./tsconfig.test.json'] })],
  esbuild: { jsx: 'automatic' },
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  test: {
    globals: true,
    environment: 'node',
    environmentMatchGlobs: [['tests/ui/**', 'happy-dom']],
    setupFiles: ['./tests/setup.ts'],
    include: [
      'tests/unit/**/*.test.ts',
      'tests/unit/**/*.test.tsx',
      'tests/ui/**/*.test.tsx',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: [
        'src/lib/**/*.ts',
        // API routes join the gate as they gain a deterministic test (P2-7).
        'src/app/api/analytics/route.ts',
        'src/app/api/analytics/latency/route.ts',
        'src/app/api/plans/route.ts',
        'src/app/api/me/route.ts',
        'src/app/api/health/route.ts',
        'src/app/api/reports/sessions/route.ts',
        // Operator-hierarchy + white-label + SKU surfaces (the R-043 routes that
        // had live cross-tenant bugs in runs 30/31/32) — each already ≥ floor.
        'src/app/api/branding/[slug]/route.ts',
        'src/app/api/branding/by-host/route.ts',
        'src/app/api/orgs/[id]/branding/route.ts',
        'src/app/api/orgs/[id]/clients/route.ts',
        'src/app/api/orgs/[id]/members/route.ts',
        'src/app/api/scenario-packs/route.ts',
        'src/app/api/scenario-packs/import/route.ts',
        'src/app/api/scenario-packs/status/route.ts',
        // Manual score-override write path — ADMIN-only, tenant-scoped; the
        // rows it writes feed analytics + the operator-facing manager reports.
        'src/app/api/scoring/route.ts',
        // Opt-in pack re-sync (R-047 counterpart to the frozen import) — ADMIN-only,
        // tenant + provenance scoped; every write branch (stale UPDATE, idempotent
        // INSERT, orphan-report) now deterministically covered.
        'src/app/api/scenario-packs/upgrade/route.ts',
      ],
      exclude: [
        'src/lib/db.ts',
        'src/lib/prisma.ts',
        'src/lib/http-agent-polyfill.ts',
      ],
      thresholds: {
        lines: 85,
        functions: 90,
        branches: 85,
        statements: 85,
      },
    },
  },
});
