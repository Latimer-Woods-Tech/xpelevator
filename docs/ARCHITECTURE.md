---
verified: 2026-10-17
verified_by: build-loop (grep of repo @ 16cc56b + live monitor evidence)
verified_against:
  - repo tree at commit 16cc56b (this file's facts grep-checked against src/, prisma/, .github/, wrangler.toml)
  - live infra via GitHub Actions "uptime-monitor" run 38999138775 (2026-10-17, green — /api/health 200 + Groq credential/stream probe + 6 h non-null scoring canary)
supersedes: the Feb-2026 single-file architecture doc (domain catalogs relocated to DOMAIN_REFERENCE.md); the 2026-07-19 stamp @ 6a885f8 (pre-dated the operator hierarchy, GCP-SM secret cutover, the model-fallback/empty-stream/token-accounting resilience, and the reporting/branding/rate-limit surfaces)
---

# XPElevator — Architecture

XPElevator is a **virtual-customer training simulator**: employees run simulated
customer conversations (chat, browser voice, and real phone calls) against
admin-authored scenarios, then get scored out of 10 against weighted, per-role
criteria. Multi-tenant (org-scoped), single-player.

This file is the **grounded** system description per PLATFORM_STANDARDS §16.
Nothing in a *Current* section is written from memory — every fact below was
checked against the repo or live infra at the `verified:` stamp above. The
aspirational picture lives only under **Target Architecture**; product/domain
knowledge (role ladder, scenario catalog, scoring rubric, persona prompts,
`Scenario.script` shape) lives in [`DOMAIN_REFERENCE.md`](./DOMAIN_REFERENCE.md);
the accountable requirements live in [`REQUIREMENTS.md`](./REQUIREMENTS.md); the
north star in [`VISION.md`](./VISION.md).

---

## System Context (Current)

C4 L1 — who and what touches the system today.

- **Actors**
  - **Trainee** — an org member (`User.role = MEMBER`) who runs simulation
    sessions and receives scores.
  - **Org admin** (`User.role = ADMIN`) — authors job titles, criteria,
    scenarios, and job↔criteria links, scoped to their organization.
  - **Automation / monitors** — the scheduled GitHub Actions probes that hit
    `/api/health` and drive a scoring canary.
- **External systems**
  - **Neon Postgres** — org project `aged-butterfly-52244878`, the live app's
    system of record (reached over the serverless driver; not Hyperdrive).
  - **Groq** — the LLM provider for simulated-customer turns and session
    scoring, called directly over HTTPS (no gateway yet).
  - **Telnyx** — inbound/outbound PSTN for the phone modality (call control +
    webhook).
- **Domains**
  - **`xpelevator.com`** (+ `www`) — the branded, user-facing domain. DNS zone
    is in the LWT Cloudflare account (`a1c8a33cbe8a3c9e260480433a0dbb06`),
    CNAME'd onto the LWT Pages deployment.
  - **`xpelevator-sim.pages.dev`** — the Pages alias for the same build
    (deploy-verification target; not user-facing per §15).

---

## Containers (Current)

C4 L2 — the deployable/runtime units, with real names. Verified against
`wrangler.toml`, `.github/workflows/*.yml`, `prisma/schema.prisma`, and `src/`.

### Web + API — Cloudflare Pages project `xpelevator-sim`
- **Framework:** Next.js 16 App Router (React 19.2), adapted for the Workers
  runtime via `@opennextjs/cloudflare` (v1.20.x). `pages_build_output_dir =
  .open-next/assets`. Next is **pinned `<16.4`** (dependabot ignore, #294): 16.4
  broke this OpenNext/Workers build (CF error 1101; history #287→#292).
- **Compat:** `compatibility_flags = ["nodejs_compat",
  "global_fetch_strictly_public"]`; `PRISMA_CLIENT_ENGINE_TYPE = "wasm"` var.
- **Account:** LWT Cloudflare account (`CF_ACCOUNT_ID` / `CF_API_TOKEN` repo
  secrets). The pre-migration `xpelevator.pages.dev` project lives in a
  *different, founder-owned* account and is left dark — see ADR-0001.
- **Edge middleware** (`src/middleware.ts`): gates `/admin/*` and `/api/*`.
  Public **exact** routes = `/`, `/auth/signin`, `/auth/signout`, `/api/health`,
  `/api/plans`, `/api/scenario-packs`, `/api/telnyx/webhook`; public **prefix**
  routes = `/api/auth/*`, `/api/branding/*`. A public exact route does NOT make
  its subpaths public (so `/api/scenario-packs` is open but
  `/api/scenario-packs/import` stays ADMIN-gated). Downstream handlers
  additionally enforce role + org scope.

### API surface (`src/app/api/**/route.ts`, verified by tree)
| Route | Auth | Purpose |
|---|---|---|
| `GET /api/health` | public | env-presence probe → 200 if all required vars set, else 503 |
| `GET /api/plans` | public | seat-plan catalog (Phase 4 foundation, PR #36) |
| `GET /api/scenario-packs` | public | starter scenario-library catalog (operator inventory); hidden-mechanic-safe — `getPublicPackCatalog()` strips every scenario `script` |
| `/api/scenario-packs/import` · `/status` · `/upgrade` | authed (ADMIN) | materialise a pack into an org (idempotent), re-sync, per-pack state |
| `GET /api/branding/[slug]` · `/api/branding/by-host` | public | brand-safe white-label read (name/logo/colors only — never tenant data); host-resolved operator subdomain (R-050/R-055) |
| `/api/auth/[...nextauth]` | public | NextAuth handlers |
| `/api/chat` | authed | chat turn + **SSE** stream; owner-or-same-org gate (`canAccessSession`) |
| `/api/scenarios` · `/api/scenarios/[id]` · `/api/scenarios/[id]/duplicate` | authed | scenario CRUD; **hidden hints sanitized** for non-owners (Phase 2) |
| `/api/jobs` · `/api/jobs/[id]` · `/api/jobs/[id]/criteria` | authed | job-title admin + links |
| `/api/criteria` · `/api/criteria/[id]` | authed | scoring-criteria admin |
| `/api/simulations` | authed | create/list sessions |
| `/api/scoring` | authed | produce the /10 score for a session |
| `/api/analytics` · `/api/analytics/latency` | authed | session analytics; per-turn latency summary |
| `/api/reports/sessions` | authed (ADMIN) | manager report: completed-session CSV (default) or `?format=pdf`; `?clientOrgId=` / `?scope=clients` operator roll-up; `?since`/`?until` window |
| `/api/reports/seats` · `/spend` · `/budget` | authed (ADMIN) | seat-usage basis (metering), LLM spend, budget views |
| `/api/orgs` · `/api/orgs/[id]` · `/api/orgs/[id]/members` | authed (ADMIN) | platform-super-admin vs tenant-admin split enforced (R-043): list scoped to own org + owned clients, cross-tenant `[id]`/top-level-POST → 403 |
| `/api/orgs/[id]/clients` · `/api/orgs/[id]/branding` | authed (ADMIN) | operator creates/lists/renames/deletes CLIENT orgs beneath it; white-label branding write |
| `/api/me` · `/api/me/export` | authed | self profile; DSR self-export (`src/lib/dsr-export.ts`) |
| `/api/audit` | authed (ADMIN) | audit-log read (`AuditLog` model) |
| `/api/telnyx/call` · `/api/telnyx/webhook` | call: authed / webhook: signature | phone modality |
| `/api/debug/env` · `/api/debug/groq` | authed | operational probes (leak-stripped, tip 1eb7977a) |

### Data — Neon Postgres `aged-butterfly-52244878`
- **ORM:** Prisma 7 (wasm client engine for schema/migrations). At request time
  the Workers runtime queries Neon directly over parameterized raw SQL
  (`src/lib/db.ts`) — the Prisma client is not used on the hot path (see
  `docs/LESSONS_LEARNED.md`).
- **Models (12):** `Organization`, `User`, `JobTitle`, `Scenario`, `Criteria`,
  `JobCriteria`, `SimulationSession`, `ChatMessage`, `Score`, plus the
  infra-tracking tables `ApiRateLimit` (public-route limiter, R-025),
  `WebhookEvent` (Telnyx idempotency, `src/lib/idempotency.ts`), and `AuditLog`.
- **Enums (6):** `SimulationType {PHONE, CHAT, VOICE}`, `SessionStatus {PENDING,
  IN_PROGRESS, COMPLETED, CANCELLED, ABANDONED}`, `MessageRole {CUSTOMER,
  AGENT}`, `UserRole {ADMIN, MEMBER}`, `OrgPlan {FREE, PRO, ENTERPRISE}`, and
  `OrgKind {STANDALONE, OPERATOR, CLIENT}` (the channel hierarchy).
- **Operator hierarchy:** `Organization.parentOrgId` sets a CLIENT org's owning
  OPERATOR (`@@index([parentOrgId])`); report/admin access across the hierarchy
  is authorized by the pure `src/lib/org-hierarchy.ts`
  (`canAccessOrgReport` / `resolveOperatorRollup`).
- **Scoring/accounting columns:** `SimulationSession.scoringStatus`
  (`SCORED` | `FAILED` | `NOT_SCORABLE`) distinguishes an engine failure from a
  non-scorable session; `ChatMessage` carries per-turn `model`, `routeReason`
  (difficulty→model, R-059), and Groq token usage.
- **Multi-tenancy:** `orgId` on tenant rows; the API enforces owner-or-same-org
  access on session reads (Phase 2, `src/lib/session-access.ts`).

### Auth — NextAuth v5 (Auth.js)
- JWT session strategy (no DB session store). Credentials provider (username,
  dev/demo) + GitHub OAuth (only wired when `AUTH_GITHUB_ID/SECRET` set).
  Secret: `AUTH_SECRET` (rotated during Phase 0).

### LLM — Groq (direct)
- `src/lib/ai.ts` + `src/lib/groq-fetch.ts` — a fetch-based Groq client
  (Workers-compatible; no vendor SDK). Secret: `GROQ_API_KEY`.
- **Model routing (R-059):** `customerModelForDifficulty()` — `hard` scenarios
  use `openai/gpt-oss-120b` (realism), easy/medium use `openai/gpt-oss-20b`
  (lower time-to-first-token); scoring always uses the 120b realism model.
- **Resilience (landed 2026-10-15, closed a ~10-day scoring-canary regression):**
  - a `403 model_permission_blocked_org` (a model listed by `/v1/models` but
    disabled for the org) falls over to the configured `fallbackChain()`
    (`src/lib/model-fallback.ts`, #301) — a non-model account-level 403 is NOT
    swallowed, so a real credential alarm still fires;
  - a 200-but-empty Groq stream is retried once on the same model before the
    canned fallback line (#304/#305);
  - per-turn token usage is captured via `onUsage` and persisted on the reply
    `ChatMessage` (#297), so LLM spend is accountable per session.

### Telephony — Telnyx
- `src/lib/telnyx.ts` + the `/api/telnyx/*` routes. Kept behind an app-local
  seam so the planned Bandwidth swap stays cheap (VISION non-goal / Phase 5).

### CI/CD + monitoring — GitHub Actions
Full gate map (all pre-merge, deploy-pipeline, and monitoring gates, grep-derived
from the workflow files): [`tech/ci-gate-topology.md`](./tech/ci-gate-topology.md).
Summary:
- **`deploy.yml`** — `ci-gate` → `migrate` (backup + dry-run + `prisma migrate
  deploy` → "up to date") → `deploy`: build OpenNext → **preview → fail-closed
  smoke-gate → promote** → ~25 post-deploy live gates (health 200, G72
  build-commit drift, Groq credential live, Phase-2 read-auth/hidden-hint/tenant
  isolation/security-headers, and the Phase-4 surface + admin gates).
  DNS-untouched, so safe on merge.
- **`ci.yml`** — six required gates aggregated by the single `ci` status context:
  `quality` (typecheck + lint), prod-tree `audit`, `unit` + `ui` (Vitest,
  credential-free), `coverage` (§3–4 floors 85/85/90/85), and `build`. The `ci`
  aggregator exists because the branch ruleset requires a context named `ci` that
  no job carried until 2026-07-26 (merges had been going through admin bypass).
- **`uptime-monitor.yml`** — `/api/health` + direct Groq credential/stream probe
  every 15 min; end-to-end scoring canary every 6 h; opens/updates one alert
  issue on failure.
- **`dependabot-automerge.yml`** — auto-merges ONLY `direct:development`
  minor/patch bumps; production-dependency bumps and any major stay human-gated
  (why a CI-green production/react bump can still sit open by design).
- **Secrets:** app secrets are delivered as **Cloudflare Pages secrets**
  (`DATABASE_URL`, `GROQ_API_KEY`, `AUTH_SECRET`), but they now **source from the
  org GCP Secret Manager SM-first with a GitHub-secret no-lockout fallback**
  (Phase 1 cutover, 2026-08-18, PRs #247/#250/#251/#252 — Standing Law 3, one
  source of truth); deploy creds are repo secrets (`CF_API_TOKEN`,
  `CF_ACCOUNT_ID`). No secret is in source or `wrangler.toml`.

**Live-state evidence (stamp date):** `uptime-monitor` run 38999138775
(2026-10-17, green) → `/api/health` 200 + Groq credential/stream probe live on
`main` tip `16cc56b`, and the 6 h scoring canary is passing (non-null scores
after the 2026-10-15 fallback/empty-stream fixes cleared a ~10-day canary-red
regression, #301/#305). Auth-401, tenant-403, hidden-hint-sanitized, and
security-headers remain re-asserted as post-deploy gates on every `deploy.yml`
run. (Original Phase-1 proof: session `dad64d13`, monitor run 28765492983.)

---

## Target Architecture

The aspirational L1/L2 the build loops steer toward. Every *open* delta from
*Current* appears in the Gap table. Several items that were Target at the
2026-07-19 stamp have since shipped into *Current* and are marked ✅ below.

- **Operator hierarchy (channel-first) — ✅ shipped (Phase 4):** the buyer is the
  **operator** (training consultancies / L&D shops). Self-serve operator
  onboarding, an operator workspace (`/operator`) with white-label branding, and
  the create/list/allocate/rename/delete verb set over CLIENT orgs are live
  (`OrgKind` + `parentOrgId`; `/api/orgs/[id]/clients`). The remaining
  aspirational slice is the operator **subdomain** end-to-end (`*.xpelevator.com`
  wildcard DNS is 🔒 founder/DNS-gated; the resolver + shell wiring already land,
  R-055).
- **Wholesale seat billing — OPEN (Phase 4·2):** Stripe (shared platform account)
  — operators buy seats wholesale, set retail; automated metering + rev-share via
  Stripe Connect. The metering basis + pricing already exist (`src/lib/plans.ts`,
  `src/lib/seat-metering.ts`, `/api/reports/seats`); what remains needs a
  founder-staged **test-mode** `STRIPE_TEST_SECRET_KEY` (test-mode first; live-mode
  is a 🔒 founder gate).
- **Centralized secrets — ✅ shipped (Phase 1, 2026-08-18):** deploy/app secrets
  now source from the org GCP Secret Manager (SM-first, GitHub no-lockout
  fallback). The expired-Groq-key incident is exactly what this prevents.
- **LLM via the chain — OPEN (Phase 5):** route through `@latimer-woods-tech/llm`
  on a per-app Cloudflare AI Gateway (guard against the ghost-gateway 401).
- **Voice upgrade — OPEN (Phase 5):** Deepgram STT + ElevenLabs TTS behind a
  provider abstraction (Telnyx → Bandwidth swap stays cheap).
- **Observability — ✅ shipped (Phase 3):** Sentry error sink (`src/lib/sentry.ts`)
  + PostHog `session_scored` product events (`src/lib/posthog.ts`) wired;
  `feature-registry.yml` present; service-registry entry in Factory; §3–4
  conformance CI gates aggregated by the required `ci` context.

---

## Gap Analysis

**Open gaps (Current → Target):**

| Gap (Current → Target) | Requirement | Closes in |
|---|---|---|
| Seat catalog + metering basis exist (`plans.ts`, `seat-metering.ts`, `/api/reports/seats`) but no Stripe products/metering/gating | R-041, R-042 | Phase 4·2 — wholesale seat billing (needs test-mode `STRIPE_TEST_SECRET_KEY`; live-mode 🔒) |
| LLM calls Groq directly, no AI Gateway | R-120 | Phase 5 — LLM onto `@latimer-woods-tech/llm` chain |
| Browser voice via Web Speech; no Deepgram/ElevenLabs | R-121 | Phase 5 — voice upgrade behind provider seam |
| Operator **subdomain** end-to-end needs `*.xpelevator.com` wildcard DNS (resolver/shell already land) | R-055 | 🔒 founder/DNS gate |

**Recently closed (were open at the 2026-07-19 stamp):**

| Gap | Requirement | Closed |
|---|---|---|
| Deploy/app secrets onto org GCP SM/WIF (SM-first, GitHub fallback) | R-110 | Phase 1, 2026-08-18 (PRs #247/#250/#251/#252) |
| Sentry + PostHog wired; `feature-registry.yml` + §3–4 conformance CI gates | R-111, R-112 | Phase 3 (PRs #253/#254/#255) |
| Operator hierarchy above `Organization` (`OrgKind`/`parentOrgId`, `/operator`, client CRUD) | R-040 | Phase 4 (PRs #36/#257/#258) |
| UI copy still said "AI" (org rule: banned in user-facing) | R-130 | Phase 4, copy pass (PR #41) |

---

## Key Decisions

One-line index into [`docs/adr/`](./adr/).

- **ADR-0001** — Redeploy the simulator into the LWT Cloudflare account as a new
  Pages project (`xpelevator-sim`) rather than adopt the founder-owned account
  that hosts the old `xpelevator.pages.dev`. *(accepted, 2026-07-05)*

Additional decisions already live in the code + issue #16 and will be backfilled
as ADRs as they are touched: NextAuth-v5-JWT over Cloudflare Access; Groq-direct
until the AI-Gateway move; Prisma-wasm engine for the Workers runtime; seat
binding by Stripe `lookup_key` (never hard-coded amounts).
