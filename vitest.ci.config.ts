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
      include: ['src/lib/**/*.ts'],
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
