import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['./tsconfig.test.json'] })],
  test: {
    globals: true,
    environment: 'node',
    // ui/ tests run in jsdom so React components can render
    environmentMatchGlobs: [
      ['tests/ui/**', 'jsdom'],
      ['tests/integration/ui/**', 'jsdom'],
    ],
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
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
