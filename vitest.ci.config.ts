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
 * creds — the pattern that RETIRED the credential-bound `tests/integration`
 * tier and the `DISABLE_AUTH` crutch). An explicit allowlist keeps the floor
 * honest: an untested route can't silently drag the measured percentage.
 * Routes under the gate (21): `analytics`, `analytics/latency`, `plans`, `me`,
 * `health`, `reports/sessions`, `branding/[slug]`, `branding/by-host`,
 * `orgs/[id]/branding`, `orgs/[id]/clients`, `orgs/[id]/members`,
 * `scenario-packs`, `scenario-packs/import`, `scenario-packs/status`, `scoring`,
 * `scenario-packs/upgrade`, `telnyx/call`, `simulations`, `scenarios`,
 * `scenarios/[id]`, `jobs/[id]/criteria` (each ≥ the floors — `jobs/[id]/criteria`
 * joined this slice: its DELETE handler + the GET/POST auth-401 and 500 boundaries
 * + POST idempotent-relink path were previously untested, so it now covers every
 * unlink-guard branch, 100% branch). **The `src/app/api/**` coverage-gate sweep is
 * COMPLETE — every API route now sits under the deterministic gate.** The
 * credential-bound `tests/integration` tier + the `DISABLE_AUTH` crutch (P1-7)
 * have since been RETIRED — the deterministic mocks cover the whole surface.
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
        // Billable outbound PSTN dial — auth + ownership + per-seat modality gate
        // at the money point, plus the from-number resolution (caller / CF binding /
        // process.env) and the 500 error boundary — all branches now covered.
        'src/app/api/telnyx/call/route.ts',
        // Core session-create + list write path (the last core write route to
        // join the gate): POST guards (auth/validation/not-found/cross-tenant/
        // daily-cap/500) + per-seat modality gate, and the GET list's admin-org
        // vs own-sessions branches with hidden-script sanitization — 94% branch
        // (only the NODE_ENV==='production' detail-suppression ternaries remain).
        'src/app/api/simulations/route.ts',
        // Admin-authored scenario CRUD — the hidden-mechanic boundary (persona /
        // objective / hints live in `script`). GET list + GET-by-id now cover
        // every org-scoped query shape and the sanitizer (trainee sees only
        // ttsVoiceName; admin sees the full script); POST tenant-scope guard and
        // PUT/DELETE global-catalog protection + all auth/500 boundaries covered.
        'src/app/api/scenarios/route.ts',
        'src/app/api/scenarios/[id]/route.ts',
        // Job↔criteria link CRUD — the LAST route to join the gate. GET/POST
        // cross-tenant read/link IDOR guards + the DELETE unlink guards (own-org
        // admin only; global catalog protected) all covered → sweep complete.
        'src/app/api/jobs/[id]/criteria/route.ts',
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
