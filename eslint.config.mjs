import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  // Next.js core-web-vitals + TypeScript rules. Previously eslint-config-next
  // was installed but never wired in, so `npm run lint` enforced nothing.
  ...compat.extends("next/core-web-vitals", "next/typescript"),

  {
    // Build output, generated files, and Node CommonJS build tooling.
    // scripts/** are .js/.cjs Node build helpers that legitimately use
    // require() and are not part of the app's TS surface.
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      ".open-next/**",
      "next-env.d.ts",
      "scripts/**",
    ],
  },

  {
    // `any` is downgraded to a warning rather than fixed in this pass: the
    // ~45 occurrences are the deliberate raw-SQL row pattern (`const row: any
    // = rows[0]`). Typing them properly belongs with the data-layer decision
    // (P2-4), not this "wire up the linter" change — so they stay visible as
    // warnings without a large, risky sweep through the query paths.
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },

  {
    // Tests are linted too (they were previously blanket-ignored), but test
    // code legitimately uses non-null assertions on captured config.
    files: ["tests/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
];

export default eslintConfig;
