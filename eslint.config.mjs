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
    // toolchain — eslint-config-next 15 enforced neither).
    //
    // `react-hooks/immutability` is enforced as `error`: the two firings it had
    // (use-before-declaration of the mount-effect helpers in
    // `src/app/simulate/page.tsx`) were fixed by reordering those `const`
    // declarations above the effect — a pure, zero-runtime-behavior change — so
    // this class of use-before-declaration bug is now blocked going forward
    // (xpelevator#16 Phase 5 effect-hygiene, slice 1).
    //
    // `react-hooks/set-state-in-effect` stays `warn` for now: its 14 firings
    // are synchronous setState calls inside effects across the live
    // chat/voice/phone client components. Fixing them properly is a runtime
    // refactor of real-time UX that is not verifiable from the egress-blocked
    // CI sandbox, so it is deferred to a dedicated follow-up rather than
    // bundled here. Left as `warn` (not disabled) so it stays visible — same
    // call as `no-explicit-any` above.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "error",
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
