---
verified: 2026-07-05
verified_by: design-spine session (Claude Code, control issue #12 program) — every (Current) claim checked against the repo, `gh` API, CF API, and live curl on the verified date
---

# XPElevator — Architecture

> **Grounding rule:** nothing in a `(Current)` section that wasn't verified against the repo/live infra on the `verified` date above. Aspirational content goes under Target Architecture only. C4 L1/L2 in text; no component diagrams.

## System Context (Current)

There are **zero users and no working system**. What exists today:

- **Repo `Latimer-Woods-Tech/xpelevator`** — main is a 180-LOC scaffold (`src/index.ts` 54, `src/db/schema.ts` 82, `src/env.ts` 22, `src/index.test.ts` 22). Two routes: `GET /health` and `GET /api/me` behind `jwtMiddleware` (which nothing can pass — no JWT issuer exists anywhere). `src/db/migrations/` contains only `.gitkeep` — no migration has ever been applied.
- **CI is green on main for the first time ever** (Phase 0, PR #13 → commit `6a308b9`, run 28717868336 = success, 2026-07-04). The **Deploy workflow on main FAILS**: run 28717868364 → wrangler `Authentication error [code: 10000]` on `/accounts/***/workers/services/xpelevator` — the Phase-0 caveat materialized: after removing the `environment:` gate, `CF_API_TOKEN`/`CF_ACCOUNT_ID` are absent-or-invalid at repo scope. Nothing has deployed since 2026-04-27.
- **Deployed worker `xpelevator` is an empty stub.** Verified via CF API: the live script body is literally `export default { fetch() {} }`, created 2026-04-27T17:06Z and never modified. Hence:
  - `curl https://xpelevator.adrper79.workers.dev/health` → **404, body `error code: 1042`** (verified 2026-07-05)
  - `curl https://xpelevator-staging.adrper79.workers.dev/health` → **404, body `error code: 1042`** (verified 2026-07-05)
- **The branded domain is NOT idle — it serves a different product.** `curl https://xpelevator.com/` → **200**, a live Next.js (OpenNext, `X-Opennext: 1`) app titled "XPElevator" that is a *virtual customer simulator for training employees* (phone/chat simulation, scoring, admin panel) — unrelated to the journeys product. Zone DNS: apex + `www` are proxied CNAMEs → `xpelevator.pages.dev` (also 200). **No `xpelevator` Pages project exists in the LWT account's Pages project list** (CF API, account `a1c8a33c…`), so the origin lives outside this account's visible Pages inventory — likely another CF account. `api.xpelevator.com` does not resolve (curl exit 6). The zone has no Worker routes and no Workers custom domains.
- **PR #1 (`plan/v1-world-class`, +1,802 lines, opened 2026-04-27, still OPEN)** holds the entire product: `routes/{members,journeys,enrollments,stripe}.ts`, `db/queries.ts`, `0000_initial.sql`, a 323-line test suite (which mocks all packages and all DB queries — route-shape only), written against the dead `@adrper79-dot` npm scope. Conflicting with main; needs resurrection, not merge.
- **External systems (provisioned, idle):** Neon Postgres endpoint `ep-bitter-night-an6r8ce2` reached via Hyperdrive; the shared LWT Stripe platform account (no xpelevator products/prices exist); no Sentry init, no PostHog events, no LLM gateway, no email. Not listed in Factory `docs/service-registry.yml`.

## Containers (Current)

| Container | Tech | Name / ID | Notes |
|---|---|---|---|
| API worker | CF Worker (Hono) | `xpelevator`, id `049e326a577849d690b6bbc9176e7513` | Live code = `export default { fetch() {} }` stub; created 2026-04-27, never modified; workers.dev `/health` → 404 `1042` (prod and `-staging`) |
| DB | Neon via Hyperdrive | Hyperdrive `xpelevator-db` = `5b62381d252c4c0abb0a24b2d7a27d87` → `ep-bitter-night-an6r8ce2.c-6.us-east-1.aws.neon.tech:5432/neondb` (user `neondb_owner`) | Provisioned 2026-04-27, idle; **no migrations applied**. ⚠️ `xico-city-db` shares this same Neon endpoint — isolation debt, see Known Debt |
| Rate limiter | CF rate_limiters binding | `AUTH_RATE_LIMITER`, namespace `1007` (60 req/60 s) | Bound in `wrangler.jsonc`, referenced by no code |
| DNS zone | Cloudflare zone | `xpelevator.com` = `baacd9664bd9b11f92e77bc3123c5b72`, status **active** | Apex + `www`: proxied CNAME → `xpelevator.pages.dev` (legacy simulator app, origin outside this account's Pages list); no Worker routes; `api.` subdomain unassigned |
| Frontend | — | none in this repo | The thing on the apex is the legacy simulator, not this product |
| CI/CD | GitHub Actions | `ci.yml` (green on main since `6a308b9`), `deploy.yml` (**failing**: CF auth error 10000) | Branch protection: PR-only to main, required check `ci` |

## Target Architecture

The issue-#12 end state (Phases 1–6):

- **API worker `xpelevator`** (Hono, Workers runtime only): resurrected PR #1 product routes — `members`, `journeys`, `enrollments`, `stripe` — plus a signup/login **auth issuer** minting JWTs via `@latimer-woods-tech/auth` (webcrypto only), `AUTH_RATE_LIMITER` enforced on auth routes, Sentry + PostHog server events wired. Served at `api.xpelevator.com` (Workers **Custom Domain**, not a zone Worker Route — xico cutover gotcha), staging on `xpelevator-staging.adrper79.workers.dev`.
- **DB**: `0000_initial.sql` applied to the provisioned Neon endpoint via a GitHub-Actions migration workflow (GCP WIF secrets pattern), extended with a **`journey_milestones` template table** so enrollments materialize authored per-day content instead of fabricating milestones from `durationDays`.
- **Journey content**: 12–20 seeded, human-quality journeys across the 5 categories (mindset | career | fitness | finance | relationships).
- **Guidance**: personalized next-step nudges per enrollment through `@latimer-woods-tech/llm` behind a **per-app CF AI Gateway created before first call** (a ghost gateway 401s silently — prime-self is the only gateway that exists today). Never the word "AI" in user-facing copy.
- **Payments**: starter/pro/elite subscription products on the shared LWT Stripe platform account; checkout session + webhook lifecycle (`created`/`upgraded`/`canceled`/`past_due`, unmatched-customer silent-drop fixed); entitlement gating (free = 1 active journey).
- **Frontend**: minimal web UI on **CF Pages in this account** — landing, catalog, journey detail, signup/login, my-journeys with daily check-off, billing — on `xpelevator.com`, which requires **displacing the legacy simulator app currently CNAMEd at the apex**. No `*.workers.dev` URL user-facing.
- **Operations**: registered in Factory `docs/service-registry.yml`; Playwright smoke tier; `docs/SLO.md`; coverage floors 80/85/70 on `@cloudflare/vitest-pool-workers` (integration-shaped tests, not PR #1's mock-everything suite).

## Gap Analysis

| Gap (Target − Current) | Requirement(s) | Closed by |
|---|---|---|
| Deploy workflow can't authenticate to CF (error 10000); nothing deployable | R-103 | issue #12 Phase 1 (first staging deploy repairs secrets) |
| Product routes exist only in conflicted PR #1 | R-003 | issue #12 Phase 1 |
| No migration applied; DB schema absent | R-004 | issue #12 Phase 1 |
| Staging `/health` is 404 | R-005 | issue #12 Phase 1 |
| Not in Factory service-registry | R-006 | issue #12 Phase 1 |
| No auth issuer (JWT middleware guards routes nothing can pass) | R-007, R-008 | issue #12 Phase 2 |
| No Sentry/PostHog despite Env declarations | R-009 | issue #12 Phase 2 |
| Test suite mocks everything; no real coverage | R-101, R-902 (guardrail) | issue #12 Phase 2 |
| No `journey_milestones` template table (milestones fabricated) | R-010 | issue #12 Phase 3 |
| No CF AI Gateway / no LLM call despite guidance being the differentiator | R-011, R-013 | issue #12 Phase 3 |
| Empty catalog | R-012 | issue #12 Phase 3 |
| No Stripe products; webhook silent-drop bug | R-014, R-015, R-016 | issue #12 Phase 4 |
| No frontend for THIS product; legacy simulator squats on the apex | R-017, R-018, R-019 | issue #12 Phase 5 |
| No smoke tier / SLO / README; no production on branded domain | R-020, R-021, R-100 | issue #12 Phase 6 |

## Key Decisions
- [ADR-0001](./adr/0001-standalone-maximization-over-selfprime-merge.md) — Maximize XPElevator standalone (accept SELF:PRIME journey overlap); resurrect PR #1 rather than rewrite or merge into SELF:PRIME.

## Known Debt
- **Shared Neon endpoint**: Hyperdrive `xpelevator-db` targets `ep-bitter-night-an6r8ce2`, the same endpoint as `xico-city-db`. Acceptable pre-launch; isolate (own project/branch) before production traffic. (Severity: medium, latent blast-radius.)
- **Legacy simulator on the branded domain**: apex/www CNAME → `xpelevator.pages.dev`, a Pages project not visible in this account — Phase 5 cutover must locate its owner account and repoint DNS. (Severity: high for Phase 5, invisible until then.)
- **`deploy.yml` CF credentials broken at repo scope** (auth error 10000 on main). (Severity: high, blocks all of Phase 1.)
- **Stale PRs**: #9 (STACK.md pointer), #10 (flagship D1 bindings — D1 `f03af37d…`=`flag-meter` verified to exist), #11 (docs control plane, blocks on Factory#1150), #14 (dependabot, red). All predate the CI fix; need rebase-or-close.
- **PR #1 test suite** mocks all packages and all DB queries and runs on `environment: 'node'` instead of `@cloudflare/vitest-pool-workers` (already a dep) — must not be counted toward coverage floors (R-902).
