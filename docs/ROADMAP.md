# XPElevator — Roadmap & Coherence Review

This document tracks the product roadmap, identifies gaps in the current plan, and defines what "done" looks like for each phase.

> **Last updated**: February 21, 2026 — full architectural review. New open issues tracked in [BACKLOG.md](BACKLOG.md) as BL-045 through BL-057.

---

## Current State (as of Sprint 5 complete)

| Area | Status | Notes |
|------|--------|-------|
| Architecture documented | ✅ Done | C4 + Mermaid diagrams in ARCHITECTURE.md (updated Feb 21 2026) |
| Next.js scaffolded | ✅ Done | App Router, TS, Tailwind v4, React 19 |
| Prisma schema | ✅ Done | 10 models, 4 enums; migration baseline applied |
| Neon DB tables | ✅ Done | 10 tables; seed data loaded |
| API routes (full CRUD) | ✅ Done | jobs, scenarios, criteria, simulations, scoring, analytics, orgs, telnyx, auth |
| Edge runtime | ✅ Done | All routes: `export const runtime = 'edge'`; Neon HTTP adapter |
| Admin UI | ✅ Done | 4 tabs: Criteria, Job Titles, Scenarios, Job↔Criteria |
| Simulate UI | ✅ Done | Creates session + redirects to active simulation |
| Active chat session UI | ✅ Done | SSE streaming, [RESOLVED] detection, auto-scoring |
| Active phone session UI | ✅ Done | Dial, transcript poll, hang-up, timer |
| Sessions UI | ✅ Done | List with score bars; detail page with transcript + criteria breakdown |
| Analytics dashboard | ✅ Done | Score trends, criteria heatmap, job/type breakdowns |
| AI integration (Groq) | ✅ Done | Streaming; virtual customer; auto-scoring |
| Phone simulation (Telnyx) | ✅ Done | Outbound call + full webhook flow |
| Authentication (NextAuth v5) | ✅ Done | GitHub OAuth + Credentials; JWT; /admin protected |
| Cloudflare config + CI/CD | ✅ Done | wrangler.toml, open-next.config.ts, GitHub Actions |
| CF build passing | ❌ Broken | BL-045: `@opennextjs/cloudflare` exits code 1 |
| All API routes auth-gated | ⚠️ Gap | BL-046: only /admin protected; all API data is world-readable |
| Admin role enforcement | ⚠️ Gap | BL-047: any non-empty Credentials username gets admin access |
| orgId multi-tenancy wired | ⚠️ Partial | BL-049: schema ready but no API filters by orgId yet |
| User identity model clean | ⚠️ Partial | BL-048: dual user_id / db_user_id; User table never populated |
| Telnyx webhook security | ❌ Missing | BL-051: no HMAC signature verification |
| DB FK indexes | ❌ Missing | BL-052: no indexes on session_id, user_id, org_id columns |

---

## Coherence & Cohesion Review

## Coherence & Cohesion Review

> Gaps from the original Phase 2 review are listed here with their resolution status. New gaps found in the February 21, 2026 architectural review are in the **New Gaps** section below.

### ✅ Gap 1: No User Identity — RESOLVED
NextAuth v5 added in Phase 4/Sprint 5. GitHub OAuth + Credentials provider. JWT session. `userId` from `session.user.id` passed to simulations. `/admin` protected by middleware.

**Remaining issue**: Dual identity model (`userId` string + `dbUserId` FK) and no admin-role enforcement → BL-047, BL-048.

---

### ✅ Gap 2: Simulate page didn't start a real session — RESOLVED
Scenario card now POSTs to `/api/simulations` and redirects to `/simulate/[sessionId]`.

---

### ✅ Gap 3: No active simulation UI — RESOLVED
`/simulate/[sessionId]` fully implemented with:
- Chat mode: SSE streaming, `[RESOLVED]`/`[END]` detection, auto-scoring
- Phone mode: dial screen, transcript polling, hang-up, call timer

---

### ✅ Gap 4: Job↔Criteria assignment was invisible — RESOLVED
Admin panel now has a dedicated "Job↔Criteria" tab (Tab 4) for toggling criteria per job title. `/api/jobs/[id]/criteria` handles POST/DELETE.

---

### ✅ Gap 5: Scenario `script` JSONB had no defined shape — RESOLVED
`ScenarioScript` interface defined in `src/types/index.ts`. `buildSessionSystemPrompt()` in `src/lib/ai.ts` parses and validates it at runtime with a safe fallback.

---

### ✅ Gap 6: Scoring was not triggered automatically — RESOLVED
Auto-scoring implemented: when a session ends (via `[RESOLVED]`, `[END]`, or Telnyx `call.hangup`), `scoreSession()` calls Groq with the full transcript + criteria list and inserts `Score` records with feedback text.

---

### ✅ Gap 7: No `.env.example` — RESOLVED
`.env.example` created and kept up to date.

---

### ✅ Gap 8: No loading/error states — RESOLVED
`error.tsx`, `not-found.tsx`, `loading.tsx` (×2) added. Retry buttons and error messages on simulate + sessions pages.

---

## New Gaps (February 21, 2026 Review)

These are tracked as backlog items BL-045 through BL-057. See [BACKLOG.md](BACKLOG.md) for full detail and sprint assignments.

| Gap | BL ID | Severity | Description |
|-----|-------|----------|-------------|
| CF build broken | BL-045 | 🔴 Critical | `@opennextjs/cloudflare` build exits code 1 — nothing can deploy |
| API routes unprotected | BL-046 | 🔴 Critical | Only `/admin` is auth-gated; all API data is world-readable |
| Any string = admin | BL-047 | 🔴 Critical | Credentials provider grants admin to any non-empty username |
| Dual identity model | BL-048 | 🟠 High | `userId` string + `dbUserId` FK both exist; User table never populated |
| orgId not wired | BL-049 | 🟠 High | Multi-tenant schema but single-tenant app; cross-org data leakage risk |
| Wrong Groq model in webhook | BL-050 | 🟠 High | Telnyx webhook uses deprecated `llama3-70b-8192`; phone AI likely broken |
| No Telnyx webhook auth | BL-051 | 🟠 High | Fabricated webhook events can corrupt session data |
| Missing DB indexes | BL-052 | 🟡 Medium | No FK column indexes; queries will sequential-scan at volume |
| maxTurns not enforced | BL-053 | 🟡 Medium | Conversations can run unbounded; Groq API cost risk |
| Phone transcript polling | BL-054 | 🟡 Medium | 3s poll delay; extra DB reads; SSE would be cleaner |
| `job_titles.name` global unique | BL-056 | 🟢 Low | Breaks multi-tenancy when two orgs share a job title name |
| No cascade deletes | BL-057 | 🟢 Low | Direct SQL deletes leave orphaned chat_messages and scores |



## Phase Roadmap

### Phase 3 — Core Interaction Loop ✅ Complete

**Goal**: A user can select a job title + scenario, have a real chat conversation with an AI virtual customer, and see their score.

**Delivered**:
- [x] `src/lib/ai.ts` — Groq client (lazy dynamic import for CF Workers compat), streaming virtual customer, auto-scoring
- [x] `POST /api/chat` — SSE streaming + [RESOLVED]/[END] detection + auto end-session
- [x] `/simulate/[sessionId]/page.tsx` — Chat UI with streaming, optimistic messages
- [x] Simulate page creates session + redirects to `/simulate/[sessionId]`
- [x] Sessions list + detail page with transcript and per-criteria score breakdown
- [x] Admin panel expanded: 4 tabs (Criteria, Job Titles, Scenarios, Job↔Criteria)
- [x] All missing CRUD API routes (scenarios, job-criteria)
- [x] Error/loading states, 404 page, global error boundary
- [x] Username modal (MVP identity via localStorage)

---

### Phase 4 — Quality & Multi-mode ✅ Complete

**Goal**: Phone simulation, scenario authoring, real auth, full scoring view.

**Delivered**:
- [x] Phone simulation via Telnyx (outbound call, full webhook flow: answered→speak→gather→AI→loop→hangup)
- [x] Phone simulation UI (dial screen, transcript polling, call timer, hang-up)
- [x] Scenario script editor in Admin UI (JSONB with parse validation)
- [x] Job-Criteria assignment UI in Admin
- [x] NextAuth.js v5 (GitHub OAuth + Credentials, JWT, /admin middleware guard)
- [x] Per-session score breakdown (criteria-by-criteria with feedback text)
- [x] Score bar chart on sessions list

---

### Phase 5 — Deployment & Operations ✅ Mostly Complete (CF build broken)

**Goal**: App running in production on Cloudflare Pages/Workers.

**Delivered**:
- [x] `wrangler.toml` + `open-next.config.ts` (`@opennextjs/cloudflare`)
- [x] Edge runtime on all API routes; Neon HTTP adapter (`@prisma/adapter-neon`)
- [x] GitHub Actions CI/CD (lint + typecheck + build on push to main)
- [x] `prisma.config.ts` Migration workflow (`prisma migrate dev/deploy`)
- [x] Analytics dashboard (`/analytics` + `/api/analytics`)
- [ ] **BL-045**: CF build currently fails (see Backlog — Sprint 6 target)
- [ ] Domain `xpelevator.com` → Cloudflare Pages custom domain (pending working build)
- [ ] Neon pooler endpoint confirmed in production env vars

---

### Phase 6 — Secure & Multi-Tenant (Current Sprint 6–7 Target)

**Goal**: API security hardened, multi-tenancy live, data integrity enforced.

**Tasks**:
- [ ] **BL-045** Fix `@opennextjs/cloudflare` build failure
- [ ] **BL-046** Auth guard on all API routes (not just /admin)
- [ ] **BL-047** Admin role: verify `User.role === ADMIN` from DB before allowing admin access
- [ ] **BL-048** Upsert `User` record on sign-in; use `dbUserId` as canonical session FK
- [ ] **BL-049** Filter all API queries by `orgId` from session context
- [ ] **BL-050** Fix Groq model name in Telnyx webhook
- [ ] **BL-051** Telnyx webhook HMAC signature verification
- [ ] **BL-052** DB indexes on FK columns (Prisma migration)
- [ ] **BL-056** Scope `job_titles.name` unique constraint to `(orgId, name)`

---

### Phase 7 — Scale & Advanced Features

**Goal**: Full multi-tenant SaaS, advanced AI coaching, LMS integration.

**Tasks**:
- [ ] Organization onboarding flow (create org, invite members)
- [ ] Trainer/supervisor role: human post-session scoring and coaching notes
- [ ] AI-generated coaching feedback (narrative summary after session ends)
- [ ] Scenario authoring wizard (guided form → JSONB script generation)
- [ ] Training progression tracking (required scenarios per role, certification gates)
- [ ] Full seed data: all 9 job titles, 34 scenarios, 25 criteria (per ARCHITECTURE.md catalog)
- [ ] LMS API for external integration (SCORM / xAPI)
- [ ] Replace phone transcript poll with SSE (BL-054)

---

## Architecture Decision Log

| Decision | Rationale | Date |
|----------|-----------|------|
| Neon Postgres over Railway/Supabase | Branching support for safe schema iteration | 2025 |
| Groq over OpenAI | 10× faster inference, free tier, llama-3 quality | 2025 |
| Next.js App Router | Server components reduce JS bundle, co-locate API | 2025 |
| Cloudflare Pages over Vercel | Edge Workers for Telnyx webhook; no WebSocket cold-start | 2025 |
| SSE over WebSocket | Stateless Workers compatible; one-way stream sufficient for AI chat | 2025 |
| Skip authentication for MVP | Reduced scope; replaced with NextAuth.js in Phase 4 | 2025 |
| `@opennextjs/cloudflare` over `@cloudflare/next-on-pages` | OpenNext CF is the recommended path; `next-on-pages` in maintenance mode | 2026 |
| `@prisma/adapter-neon` (HTTP) over TCP | Only viable Prisma transport in CF Workers (no TCP) | 2026 |
| Lazy dynamic `import('groq-sdk')` | `groq-sdk` is CJS-only; static ESM import crashes esbuild + CF Workers bundle | 2026 |
| NextAuth v5 (beta) JWT strategy | No DB session storage needed; edge-compatible; GitHub + Credentials in same config | 2026 |
| Dual `userId`/`dbUserId` (temporary) | MVP shipped quickly with string userId; `dbUserId` FK scaffolded for Phase 6 migration | 2026 |
