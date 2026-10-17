# XPElevator — CLAUDE.md

Control plane: [xpelevator#16](https://github.com/Latimer-Woods-Tech/xpelevator/issues/16). Design spine: [`docs/VISION.md`](./docs/VISION.md) → [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) → [`docs/REQUIREMENTS.md`](./docs/REQUIREMENTS.md) (grounded, `verified:`-stamped per Factory `PLATFORM_STANDARDS.md` §16 — read `ARCHITECTURE.md` before assuming anything about current behavior). Domain catalogs (role ladder, scenario shape, scoring rubric): [`docs/DOMAIN_REFERENCE.md`](./docs/DOMAIN_REFERENCE.md).

## What this is

Virtual-customer training simulator. Trainees pick a job title and scenario, run a simulated customer conversation (chat, browser voice via Web Speech, or a real Telnyx phone call), and get scored out of 10 against weighted, per-role criteria. The buyer is the **operator** (a training consultancy or L&D shop) who resells practice seats to its own client orgs — this is channel-first, not direct-to-trainee retail. See `docs/VISION.md` for the full buyer/monetization model and kill-signals.

## Relationship to the Factory monorepo

This is a **standalone repo**, not a package inside `Latimer-Woods-Tech/Factory`. It does not consume `@latimer-woods-tech/*` packages except `@latimer-woods-tech/seo`, and its LLM calls go **directly to Groq** (`src/lib/groq-fetch.ts`), not through `@latimer-woods-tech/llm` — moving onto the shared LLM chain is a tracked, not-yet-done Phase 5 item on xpelevator#16. Don't assume Factory's package-dependency rules or its LLM-chain-only constraint apply here until that migration lands; do follow Factory's general hard constraints (no `process.env` outside config loading, no Node built-ins banned by the Workers runtime, no secrets in source) since this ships on Cloudflare Workers too.

**Database:** Neon Postgres (serverless HTTP driver), not OCI — this app is on Factory's "still on Neon by design" list (`Latimer-Woods-Tech/Factory/CLAUDE.md`) pending a driver rewrite off `@neondatabase/serverless`. Prisma (`prisma/schema.prisma`, 12 models / 6 enums) owns the schema and migrations, but the Workers runtime queries Neon directly with parameterized raw SQL (`src/lib/db.ts`) — the Prisma client is not used at request time; see `docs/LESSONS_LEARNED.md` for why.

## Stack

- **Frontend:** Next.js (App Router, TypeScript, React 19, Tailwind CSS v4)
- **Hosting:** Cloudflare Workers via `@opennextjs/cloudflare`, Pages project `xpelevator-sim`, served at xpelevator.com
- **Auth:** Auth.js / NextAuth v5, JWT sessions (`src/auth.ts`)
- **Simulated customers & scoring:** Groq (Llama) direct, `src/lib/ai.ts` + `src/lib/groq-fetch.ts`
- **Voice / phone:** browser Web Speech API; Telnyx Call Control for real calls (`src/lib/telnyx.ts`) — kept behind a provider abstraction per founder note on xpelevator#16 (a Bandwidth account is a planned future swap)
- **Secrets:** sourced from GCP Secret Manager first, with a GitHub-secret fallback (see xpelevator#16 Phase 1) — never hard-code in `wrangler.toml`

## Hard rules specific to this repo

- **No "AI" in any user-facing copy.** Org-wide rule (also stated in `feature-registry.yml`): use craft vocabulary — "simulated customer", "scoring engine", "the simulator" — never "AI"/"AI-generated". This was a deliberate copy pass (xpelevator#16 Phase 4); don't regress it.
- **Every `/api/*` read must be authenticated and tenant-scoped.** The product's two founding security bugs — unauthenticated reads leaking scenario hidden hints, and a cross-tenant IDOR on session reads — are both closed and covered by permanent post-deploy gates in `deploy.yml`. Any new route touching `scenarios`, `sessions`, or `chat` must go through the existing `requireAuth` / `canAccessSession` helpers, not a new ad-hoc check.
- **Never leak `Scenario.script` (persona/objective/hints) to an unauthenticated or non-admin caller.** This is the core product mechanic (an employee who can read the hidden hints can game the score) — `getPublicPackCatalog()` in `src/lib/scenario-packs.ts` is the sanctioned pattern for a public-safe view.
- **Security headers (CSP/HSTS/nosniff/X-Frame/Permissions-Policy) are set on every Worker response** and gated post-deploy — don't narrow `connect-src`/`frame-ancestors` or drop a header without checking what it protects.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint — zero errors |
| `npm run test:unit` | Deterministic unit tests (mocked) |
| `npm run test:coverage:ci` | Coverage gate over `src/lib` |
| `npm run preview` | OpenNext build + local `wrangler dev` |
| `npm run deploy` | OpenNext build + `wrangler deploy` |

CI (`.github/workflows/ci.yml`) gates typecheck/lint/tests/coverage; `deploy.yml` re-runs those, migrates the Neon DB, deploys, then self-verifies `/api/health`, auth gates, tenant isolation, and security headers against the live site — a deploy is not "done" until that self-verify step is green, matching the Factory-wide curl-with-your-own-eyes rule.

## Commit format

Conventional commits (`fix(xpelevator): …`, `feat(xpelevator): …`); this repo's automation commits as `234704346+adrper79-dot@users.noreply.github.com`.

## Where to look first

1. [xpelevator#16](https://github.com/Latimer-Woods-Tech/xpelevator/issues/16) — control plane and full phase history (Phase 0 recovery → Phase 5 differentiators); the "Standing rules" section at the bottom governs any autonomous loop working this repo.
2. `docs/ARCHITECTURE.md` — grounded current-state system description, `verified:`-stamped; re-verify facts against the repo before trusting an old stamp.
3. `docs/DOMAIN_REFERENCE.md` — role ladder, scenario shape, scoring rubric.
4. `docs/IMPROVEMENT_PLAN.md` / `docs/BACKLOG.md` — phased engineering roadmap.
5. `docs/LESSONS_LEARNED.md` — why the data layer is split (raw SQL at request time, Prisma only for schema/migrations), and other hard-won gotchas.
