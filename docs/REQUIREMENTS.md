# XPElevator — Requirements

> The real and true requirements this build is held accountable to. Numbered, testable, statused. Every control-issue (#12) slice references the requirement IDs it advances; every `live` flip needs verification evidence in the control-issue comment. Status ∈ `live | building | roadmap | rejected | parked`. `rejected` rows stay here with their reason — rejected scope is a guardrail.

## Functional

| ID | Requirement | Status | Verification |
|---|---|---|---|
| R-001 | CI is green on `main` | live | `gh run list` — run 28717868336 success on `6a308b9` (2026-07-04, first ever); required check `ci` on branch protection |
| R-002 | `npm run typecheck` returns zero errors on `main` | live | Phase 0 evidence in issue #12 (verified on merged main) |
| R-003 | PR #1 product routes (members, journeys, enrollments, stripe) resurrected onto `main` under `@latimer-woods-tech/*` scope, CI green | building | PR merged; CI green; routes respond on staging (401 on authed routes is a pass) — issue #12 Phase 1 |
| R-004 | `0000_initial.sql` applied to Neon `ep-bitter-night-an6r8ce2` via a GitHub-Actions migration workflow (GCP WIF pattern) | roadmap | migration run log in Actions; `\dt` shows tables (evidence pasted in issue #12) |
| R-005 | Staging worker deployed; `/health` returns 200 | roadmap | `curl https://xpelevator-staging.adrper79.workers.dev/health` → 200 (currently 404 `error code: 1042`) |
| R-006 | xpelevator registered in Factory `docs/service-registry.yml` | roadmap | PR to Latimer-Woods-Tech/Factory merged |
| R-007 | Signup/login issues a JWT; bad credentials return 401 | roadmap | `curl -X POST .../auth/signup` → 200 + JWT; bad creds → 401 (not 000/5xx) |
| R-008 | `AUTH_RATE_LIMITER` (ns 1007) enforced on auth routes | roadmap | burst of >60 req/min → 429 observed via curl |
| R-009 | Sentry initialized (+ sourcemap upload in deploy) and PostHog server events emitted: signup, enroll, milestone_complete, checkout_started | roadmap | event visible in Sentry/PostHog after a staging exercise |
| R-010 | `journey_milestones` template table exists; enrollments materialize milestones from authored templates (never fabricated from `durationDays`) | roadmap | integration test + DB row inspection |
| R-011 | Per-app CF AI Gateway exists for xpelevator and one live LLM call through `@latimer-woods-tech/llm` succeeds BEFORE guidance ships | roadmap | one verified live call logged (a ghost gateway 401s silently) |
| R-012 | 12–20 seeded journeys with per-day milestone content across all 5 categories (mindset, career, fitness, finance, relationships) | roadmap | `GET /api/journeys` returns the seeded catalog from the real DB |
| R-013 | Guidance endpoint returns a personalized next-step nudge per enrollment | roadmap | authed curl returns enrollment-specific content |
| R-014 | Stripe starter/pro/elite products/prices on the shared LWT platform account; TEST-mode checkout session completes and flips the subscription row | roadmap | test-mode checkout E2E; DB row evidence pasted in issue #12 — Phase 4 |
| R-015 | Stripe webhook lifecycle handled: created / upgraded / canceled / past_due; unmatched-customer events logged, never silently dropped | roadmap | `stripe trigger` each event; DB + log assertions |
| R-016 | Entitlement gating: free = 1 active journey; paid tiers unlock concurrent journeys + guidance | roadmap | second enroll on free tier → 402/403; paid tier → 200 |
| R-017 | Web frontend (CF Pages, this account): landing, catalog, journey detail, signup/login, my-journeys with daily check-off, billing | roadmap | signup→enroll→check-off flow works end to end in a browser — Phase 5 |
| R-018 | Legacy simulator app displaced: apex/www DNS repointed from `xpelevator.pages.dev` (foreign Pages project) to this product's frontend | roadmap | `curl https://xpelevator.com/` → 200 serving the journeys product; owner account of the old project located first |
| R-019 | `api.xpelevator.com` → Workers **Custom Domain** for the API worker (not a zone Worker Route) | roadmap | `curl https://api.xpelevator.com/health` → 200 (currently NXDOMAIN) |
| R-020 | Playwright smoke tier; `docs/SLO.md`; README per Factory APP_README_TEMPLATE | roadmap | smoke job green in CI; files present — Phase 6 |
| R-021 | Production live on the branded domain with funnel events visible in PostHog | roadmap | `curl https://api.xpelevator.com/health` → 200; PostHog funnel screenshot in issue #12 |
| R-022 | Stripe LIVE-mode flip | roadmap 🔒 | founder gate — the loop comments on issue #12 and WAITS |
| R-050 | Instructor marketplace (two-sided: instructors author + sell journeys) | parked | revisit only after R-012/R-014 are `live` and activation clears the VISION.md kill-signal floors |

## Non-functional

| ID | Requirement | Status | Verification |
|---|---|---|---|
| R-100 | `/health` returns 200 on the branded domain | roadmap | `curl https://api.xpelevator.com/health` (verified 2026-07-05: host does not resolve) |
| R-101 | Coverage ≥ floors 80% line / 85% branch / 70% function, measured on integration-shaped tests running in `@cloudflare/vitest-pool-workers` | roadmap | CI coverage gate |
| R-102 | Workers-runtime hard constraints hold: no `process.env`, no Node built-ins, no `Buffer`, no `require()`, every raw `fetch` wrapped in error handling, no secrets in source or wrangler `vars` | building | CI lint/review gates; holds on the 180-LOC main today |
| R-103 | `deploy.yml` authenticates to Cloudflare and deploys green | building | currently FAILING on main (run 28717868364, wrangler auth error code 10000) — repo-scope `CF_API_TOKEN`/`CF_ACCOUNT_ID` must be fixed in Phase 1 |
| R-104 | Neon isolation: xpelevator gets its own Neon project/branch before production traffic (currently shares `ep-bitter-night-an6r8ce2` with xico-city) | roadmap | Hyperdrive origin host differs from xico-city's |

## Rejected (do-not-build guardrails)

| ID | Requirement | Status | Reason |
|---|---|---|---|
| R-900 | Real-money instructor marketplace as the FIRST build (12-slice, two-sided) | rejected | two-sided cold start at zero users; founder decision 2026-07-04 — first-party journeys first (marketplace itself is parked as R-050, not dead) |
| R-901 | Any `*.workers.dev` URL user-facing (HTML, JS, API client, shipped env var) | rejected | PLATFORM_STANDARDS §15 domain rule; branded domain only |
| R-902 | Counting mocked-everything test suites toward coverage floors | rejected | PR #1's suite mocks all packages AND all DB queries on `environment: 'node'` — route-shape theater, not coverage; floors are measured on `@cloudflare/vitest-pool-workers` integration tests only |
| R-903 | The word "AI" in any user-facing copy, UI, or video | rejected | brand vocabulary rule (guidance/craft vocab); org-wide standing order |
