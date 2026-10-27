import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  // Next.js core-web-vitals + TypeScript rules. Previously eslint-config-next
  // was installed but never wired in, so `npm run lint` enforced nothing.
  // eslint-config-next 16 ships native flat configs, so the FlatCompat /
  // @eslint/eslintrc bridge (removed from ESLint 10's dependency tree) is no
  // longer needed.
  ...nextCoreWebVitals,
  ...nextTypescript,

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
    // React Compiler rules shipped by eslint-config-next 16 (new to this
    // toolchain — eslint-config-next 15 enforced neither). They fire on
    // pre-existing, shipped-and-working client code: `set-state-in-effect`
    // (14 synchronous setState calls across chat/voice/phone + admin effects)
    // and `immutability` (functions referenced in a mount effect that is
    // lexically above their `const` declarations — safe at runtime since
    // effects run post-render). Both are perf/style advisories, not
    // correctness bugs. Downgraded to `warn` rather than disabled — same call
    // as `no-explicit-any` above — so they stay visible without bundling a
    // large, risky effects-refactor into a dev-tooling bump. The actual
    // effect-hygiene cleanup is tracked as a dedicated follow-up (xpelevator#16
    // Phase 5). Keeping them `error` would block the ESLint 10 / Next 16
    // upgrade on a refactor that touches live voice/chat UX.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
    },
  },

  {
    // P2-4 boundary: production routes must query Neon via '@/lib/db' (raw SQL),
    // never the Prisma client — it has runtime incompatibilities on the Workers
    // edge. Prisma stays schema/migrations + test-tooling only.
    files: ["src/app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/prisma",
              message:
                "Do not use the Prisma client in application code — query Neon via '@/lib/db' (raw SQL). Prisma is schema/migrations + test-tooling only (see src/lib/prisma.ts).",
            },
          ],
        },
      ],
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
