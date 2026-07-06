import { defineConfig, globalIgnores } from "eslint/config";

const eslintConfig = defineConfig([
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Test files
    "tests/**",
    "**/*.test.ts",
    "**/*.test.tsx",
    // Throwaway root-level debug/scratch scripts left over from the Phase 0/1
    // production-debugging sessions (unreferenced; use process.env + hardcoded
    // test IDs). Slated for physical removal in the Phase 3 repo-cleanup slice
    // (issue #16); ignored here so they can't block the CI lint gate.
    "test-*.js",
    "test-*.mjs",
    "check-*.js",
  ]),
]);

export default eslintConfig;
