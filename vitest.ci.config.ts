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
 * Routes under the gate: `analytics`, `analytics/latency`, `plans`, `me`,
 * `reports/sessions` (each ≥ the floors: analytics/plans/me at 100%,
 * reports/sessions at ~98% lines / ~89% branches). Retiring the credential-bound `tests/integration`
 * tier + the `DISABLE_AUTH` crutch (P1-7) follows once the remaining routes
 * finish the sweep.
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
        'src/app/api/reports/sessions/route.ts',
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
