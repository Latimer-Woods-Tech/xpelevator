import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['./tsconfig.test.json'] })],
  // Source components (src/app/**) use Next.js' automatic JSX runtime and do
  // NOT `import React`. esbuild defaults to the classic runtime (React.create-
  // Element), which throws "React is not defined" when rendering those files in
  // the ui tier. Force the automatic runtime so component tests transform the
  // same way `next build` does.
  esbuild: { jsx: 'automatic' },
  resolve: {
    // Note: 'node' condition was previously needed for next-auth v5 package
    // exports resolution. Removed because it causes React to resolve differently
    // for 'use client' components, leading to duplicate React instances.
    // Auth tests now use vi.doMock() so they don't need special conditions.
    //
    // dedupe forces all react/react-dom imports to resolve from the root
    // node_modules, preventing multiple React instances ("Invalid hook call")
    // when testing 'use client' components with @testing-library/react.
    dedupe: ['react', 'react-dom'],
  },
  test: {
    globals: true,
    environment: 'node',
    // ui/ tests run in happy-dom so React components can render
    environmentMatchGlobs: [
      ['tests/ui/**', 'happy-dom'],
    ],
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: ['tests/e2e/**', 'tests/voice/**', 'node_modules/**'],
    // NOTE: no coverage gate lives here on purpose. This config runs EVERY local
    // tier — including the smoke tier, which hits live Neon + Groq via
    // tests/setup.ts — so a coverage percentage measured through it is not a
    // meaningful or reproducible floor. The authoritative coverage gate is
    // `vitest.ci.config.ts` (run via `npm run test:coverage:ci`): deterministic
    // unit + ui tiers only, an explicit route allowlist, and the
    // PLATFORM_STANDARDS §3-4 floors (85 line / 90 fn / 85 branch / 85 stmt).
    // Run that config for the real signal; `npm run test:coverage` here reports
    // informational v8 coverage with no thresholds. (issue #156, process tier.)
  },
});
