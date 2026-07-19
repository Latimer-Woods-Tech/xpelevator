---
verified: 2026-07-19
verified_by: build-loop (grep of repo @ 6a885f8 + live CI evidence)
verified_against:
  - repo tree at commit 6a885f8 (this file's facts grep-checked against src/, prisma/, .github/, wrangler.toml)
  - live infra via GitHub Actions "Uptime + scoring monitor" run 29034316829 (2026-07-09, green)
supersedes: the Feb-2026 single-file architecture doc (domain catalogs relocated to DOMAIN_REFERENCE.md)
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
- **Framework:** Next.js 15 App Router (React 19), adapted for the Workers
  runtime via `@opennextjs/cloudflare` (v1.x). `pages_build_output_dir =
  .open-next/assets`.
- **Compat:** `compatibility_flags = ["nodejs_compat",
  "global_fetch_strictly_public"]`; `PRISMA_CLIENT_ENGINE_TYPE = "wasm"` var.
- **Account:** LWT Cloudflare account (`CF_ACCOUNT_ID` / `CF_API_TOKEN` repo
  secrets). The pre-migration `xpelevator.pages.dev` project lives in a
  *different, founder-owned* account and is left dark — see ADR-0001.
- **Edge middleware** (`src/middleware.ts`): gates `/admin/*` and `/api/*`;
  public allowlist = `/`, `/auth/*`, `/api/health`, `/api/telnyx/webhook`,
  `/api/auth/*`. Downstream handlers additionally enforce role + org scope.

### API surface (`src/app/api/**/route.ts`, verified by tree)
| Route | Auth | Purpose |
|---|---|---|
| `GET /api/health` | public | env-presence probe → 200 if all required vars set, else 503 |
| `GET /api/plans` | public | seat-plan catalog (Phase 4 foundation, PR #36) |
| `/api/auth/[...nextauth]` | public | NextAuth handlers |
| `/api/chat` | authed | chat turn + **SSE** stream; owner-or-same-org gate (`canAccessSession`) |
| `/api/scenarios` · `/api/scenarios/[id]` | authed | scenario CRUD; **hidden hints sanitized** for non-owners (Phase 2) |
| `/api/jobs` · `/api/jobs/[id]` · `/api/jobs/[id]/criteria` | authed | job-title admin + links |
| `/api/criteria` · `/api/criteria/[id]` | authed | scoring-criteria admin |
| `/api/simulations` | authed | create/list sessions |
| `/api/scoring` | authed | produce the /10 score for a session |
| `/api/analytics` | authed | session analytics |
| `/api/orgs` · `/api/orgs/[id]` · `/api/orgs/[id]/members` | authed (ADMIN) | platform-super-admin vs tenant-admin split enforced (R-043): list scoped to own org + owned clients, cross-tenant `[id]`/top-level-POST → 403 |
| `/api/telnyx/call` · `/api/telnyx/webhook` | call: authed / webhook: signature | phone modality |
| `/api/debug/env` · `/api/debug/groq` | authed | operational probes (leak-stripped, tip 1eb7977a) |

### Data — Neon Postgres `aged-butterfly-52244878`
- **ORM:** Prisma 6 (wasm client engine for the Workers runtime).
- **Models:** `Organization`, `User`, `JobTitle`, `Scenario`, `Criteria`,
  `JobCriteria`, `SimulationSession`, `ChatMessage`, `Score`.
- **Enums:** `SimulationType {PHONE, CHAT, VOICE}`, `SessionStatus {PENDING,
  IN_PROGRESS, COMPLETED, CANCELLED, ABANDONED}`, `MessageRole {CUSTOMER,
  AGENT}`, `UserRole {ADMIN, MEMBER}`, `OrgPlan {FREE, PRO, ENTERPRISE}`.
- **Multi-tenancy:** `orgId` on tenant rows; the API enforces owner-or-same-org
  access on session reads (Phase 2, `src/lib/session-access.ts`).

### Auth — NextAuth v5 (Auth.js)
- JWT session strategy (no DB session store). Credentials provider (username,
  dev/demo) + GitHub OAuth (only wired when `AUTH_GITHUB_ID/SECRET` set).
  Secret: `AUTH_SECRET` (rotated during Phase 0).

### LLM — Groq (direct)
- `src/lib/ai.ts` + `src/lib/groq-fetch.ts` — a fetch-based Groq client
  (Workers-compatible; no vendor SDK). Secret: `GROQ_API_KEY`.

### Telephony — Telnyx
- `src/lib/telnyx.ts` + the `/api/telnyx/*` routes. Kept behind an app-local
  seam so the planned Bandwidth swap stays cheap (VISION non-goal / Phase 5).

### CI/CD + monitoring — GitHub Actions
- **`deploy.yml`** — build OpenNext → `wrangler pages deploy` to `xpelevator-sim`
  → post-deploy live gates (health 200, Groq credential live, read-auth 401 +
  no hidden-hint leak, tenant-isolation 403, security headers). DNS-untouched,
  so safe on merge.
- **`ci.yml`** — `typecheck` + `lint` + `unit` (Vitest) + `ui` (Vitest) gates on
  every PR (the two credential-free tiers block merge).
- **`uptime-monitor.yml`** — `/api/health` + direct Groq credential probe every
  15 min; end-to-end scoring canary every 6 h; opens/updates one alert issue on
  failure.
- **Secrets:** app secrets are **Cloudflare Pages secrets** (`DATABASE_URL`,
  `GROQ_API_KEY`, `AUTH_SECRET`); deploy creds are repo secrets (`CF_API_TOKEN`,
  `CF_ACCOUNT_ID`). No secret is in source or `wrangler.toml`.

**Live-state evidence (stamp date):** monitor run 29034316829 (2026-07-09,
green) → `/api/health` 200 and Groq credential live. Auth-401, tenant-403,
hidden-hint-sanitized, and security-headers are re-asserted as post-deploy gates
on every `deploy.yml` run (last: run #121 / 28802190900) and the 6 h canary has
driven a full authenticated session to **non-null** scores (issue #16 evidence,
session `dad64d13`).

---

## Target Architecture

The aspirational L1/L2 the build loops steer toward. Every delta from *Current*
appears in the Gap table.

- **Operator hierarchy (channel-first):** the buyer is the **operator**
  (training consultancies / L&D shops). Self-serve operator onboarding → operator
  workspace with white-label branding → operator creates + manages client orgs
  beneath them (`org.plan` evolves into an operator→client hierarchy). Built on
  `@latimer-woods-tech/operator` (identity/hierarchy/white-label + vend receiver
  + entitlement checks). *(§17.2 white-label ladder; operator subdomain first.)*
- **Wholesale seat billing:** Stripe (shared platform account) — operators buy
  seats wholesale, set retail; automated metering + rev-share via Stripe Connect.
  Bound by stable price `lookup_key` (`src/lib/plans.ts`); test-mode first,
  live-mode is a 🔒 founder gate.
- **Centralized secrets:** deploy secrets move onto the org GCP Secret Manager /
  Workload-Identity pattern (the expired-Groq-key incident is what centralized
  rotation prevents).
- **LLM via the chain:** route through `@latimer-woods-tech/llm` on a per-app
  Cloudflare AI Gateway (guard against the ghost-gateway 401).
- **Voice upgrade:** Deepgram STT + ElevenLabs TTS behind a provider abstraction
  (Telnyx → Bandwidth swap stays cheap).
- **Observability:** Sentry + PostHog wired; service-registry / feature-registry
  entries; conformance CI gates (§3–4).

---

## Gap Analysis

| Gap (Current → Target) | Requirement | Closes in |
|---|---|---|
| Deploy secrets are repo/Pages secrets, not GCP SM/WIF | R-110 | Phase 1 — "Secrets into org GCP SM/WIF" (blocked on GCP-admin WIF binding) |
| No Sentry / PostHog; no service/feature-registry entry | R-111, R-112 | Phase 3 — "CI + quality gates + registry; Sentry + PostHog" |
| No operator hierarchy above `Organization` | R-040 | Phase 4 — operator model on multi-tenant scaffolding |
| Seat catalog exists (`plans.ts`) but no Stripe products/metering/gating | R-041, R-042 | Phase 4 — wholesale seat billing (test-mode → 🔒 live) |
| LLM calls Groq directly, no AI Gateway | R-120 | Phase 5 — LLM onto `@latimer-woods-tech/llm` chain |
| Browser voice via Web Speech; no Deepgram/ElevenLabs | R-121 | Phase 5 — voice upgrade behind provider seam |
| UI copy still says "AI" (org §16 banned in user-facing) | R-130 | Phase 4 — copy pass |

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
