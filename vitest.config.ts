import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['./tsconfig.test.json'] })],
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
      ['tests/integration/ui/**', 'happy-dom'],
    ],
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: ['tests/e2e/**', 'tests/voice/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/app/layout.tsx',
        'src/app/providers.tsx',
        'src/app/error.tsx',
        'src/app/not-found.tsx',
      ],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 50,
        statements: 60,
      },
    },
  },
});
