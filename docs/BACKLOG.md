# XPElevator — Product & Engineering Backlog

Last evaluated: 2026-02-27 (sprint 11 cont. — Telnyx STT payload field + DTMF-disable fixes BL-090, BL-091)  
Format: `[ID] Title — Priority | Status | Notes`

---

## Legend

| Priority | Meaning |
|----------|---------|
| 🔴 Critical | Blocks core functionality or causes errors |
| 🟠 High | Important feature gap, no workaround |
| 🟡 Medium | Notable UX gap, workaround exists |
| 🟢 Low | Nice-to-have, infrastructure, future |

| Status | Meaning |
|--------|---------|
| `open` | Not started |
| `in-progress` | Being actively built |
| `done` | Completed and merged |
| `blocked` | Waiting on external dependency |

---

## 🔴 Critical

| ID | Title | Status | Notes |
|----|-------|--------|-------|
| BL-001 | Delete stale `src/index.ts` (old Cloudflare MCP server) | `done` | Excluded via tsconfig; should be physically deleted |
| BL-002 | Set `GROQ_API_KEY` in `.env` from secrets.txt | `blocked` | User action required — copy key from secrets.txt |
| BL-003 | `groq-sdk` package install | `done` | Installed via Windows cmd.exe |
| BL-004 | Fix JSX fragment error in `simulate/page.tsx` | `done` | Missing `<>` wrapper around ternary else branch |
| BL-005 | Fix implicit `any` in `chat/route.ts` map callbacks | `done` | Added explicit type annotations |
| BL-045 | Fix `@opennextjs/cloudflare` build failure (exit code 1) | `done` | Fixed type error in `auth-api.ts` (`Headers` vs `Request` parameter); build now succeeds in 19.6s + 14.4s bundling |
| BL-046 | Add auth guards to all API routes (currently only `/admin` is protected) | `done` | Created `src/lib/auth-api.ts` with `requireAuth()`/`withAuth()` helpers; all 15 API route files now check auth; ADMIN role required for write operations on criteria/jobs/scenarios/orgs |
| BL-047 | Credentials provider grants admin access to any non-empty username | `done` | `auth.ts` now uses email-based DB lookup to verify actual `User.role`; dev mode auto-creates MEMBER users; middleware expanded to protect `/api/*`, `/simulate/*`, `/sessions/*`, `/analytics/*` |
| BL-078 | Missing `gen_random_uuid()` in 4 POST INSERT routes | `done` | `POST /api/criteria`, `POST /api/jobs`, `POST /api/scenarios`, `POST /api/jobs/[id]/criteria` all missing `id` value in INSERT; caused 500 on every create. Fixed in commit `bb6c8a2` |

---

## 🟠 High Priority

### Admin — Missing Management Features
| ID | Title | Status | Notes |
|----|-------|--------|-------|
| BL-010 | Admin: Job Title management (list, create, edit, delete) | `done` | Tab 2 in new tabbed admin page |
| BL-011 | Admin: Scenario management (list, create, edit, delete) | `done` | Tab 3 with job title filter |
| BL-012 | Admin: Scenario script editor (persona, objective, difficulty) | `done` | JSON textarea with parse validation |
| BL-013 | Admin: Job-Criteria assignment UI | `done` | Tab 4 — toggle links per job title |

### Missing API Routes
| ID | Title | Status | Notes |
|----|-------|--------|-------|
| BL-014 | `PUT /api/jobs/[id]` and `DELETE /api/jobs/[id]` | `done` | Created `src/app/api/jobs/[id]/route.ts` |
| BL-015 | `GET /api/scenarios`, `POST /api/scenarios` | `done` | Created `src/app/api/scenarios/route.ts` |
| BL-016 | `PUT /api/scenarios/[id]`, `DELETE /api/scenarios/[id]` | `done` | Created `src/app/api/scenarios/[id]/route.ts` |
| BL-017 | `POST /api/jobs/[id]/criteria` and `DELETE /api/jobs/[id]/criteria/[criteriaId]` | `done` | Created `src/app/api/jobs/[id]/criteria/route.ts` |

### User Identity
| ID | Title | Status | Notes |
|----|-------|--------|-------|
| BL-018 | MVP user identity via localStorage username prompt | `done` | Modal on /simulate, saved to localStorage |
| BL-019 | Pre-session name capture modal on /simulate | `done` | Username passed as `userId` to POST /api/simulations |
| BL-048 | Resolve dual identity model (`userId` string vs `dbUserId` FK) | `done` | `signIn` callback upserts `User` row for OAuth users; `jwt` callback caches `dbUserId`; session exposes `dbUserId`; `SimulationSession.create` now sets `dbUserId` FK |
| BL-049 | Wire `orgId` into all API routes to enforce multi-tenancy scope | `done` | `organizations` table exists; all list endpoints now filter `WHERE orgId = ? OR orgId IS NULL`; [id] routes verify ownership before PUT/DELETE; chat/scoring verify session access |
| BL-050 | Fix Groq model name in `telnyx/webhook/route.ts` | `done` | Changed to `llama-3.3-70b-versatile` (×2 in webhook); also fixed 5 related bugs — see BL-058–BL-062 |
| BL-051 | Add Telnyx webhook signature verification | `done` | `verifyTelnyxWebhook()` in `auth-api.ts` uses ED25519 signature verification; skipped in dev when `TELNYX_PUBLIC_KEY` not set, enforced in prod |
| BL-058 | Fix `@prisma/client/wasm` causing silent DB failures in dev server | `done` | `prisma.ts` imported WASM build → Node.js ESM loader threw `Unknown file extension ".wasm"` on every DB write. Changed to `@prisma/client` standard; WASM build deferred to CF Workers deploy |
| BL-059 | Fix `create+include` implicit transaction in `simulations/route.ts` | `done` | `PrismaNeonHTTP` adapter rejects implicit transactions (create+include pattern). Split into `create` then `findUnique`; same fix already applied in `scenarios/route.ts` |
| BL-060 | Fix inverted `CUSTOMER`/`AGENT` role assignments in Telnyx webhook | `done` | AI opening was saved as `AGENT`; trainee speech was saved as `CUSTOMER`. Roles swapped → scoring and transcript replay were both wrong |
| BL-061 | Fix wrong script field names in Telnyx webhook (`persona`, `objective`) | `done` | Webhook used `script.persona` and `script.objective` — both always `undefined`. Corrected to `script.customerPersona` and `script.customerObjective` |
| BL-062 | Fix Groq role mapping in Telnyx webhook (`USER` → `AGENT`) | `done` | History mapping used `m.role === 'USER'` but DB stores `AGENT`/`CUSTOMER`; all messages mapped to `assistant`, none to `user`, so AI had no conversational context |

---

## 🟡 Medium Priority

### UI / UX Gaps
| ID | Title | Status | Notes |
|----|-------|--------|-------|
| BL-020 | Add `error.tsx` global error boundary | `done` | `src/app/error.tsx` with retry + home links |
| BL-083 | `JobCriteriaTab` always showed "Add" — never "Linked" | `done` | `GET /api/jobs/[id]/criteria` returns `{ id, ... }` but UI read `d.criteriaId` (always `undefined`). Fixed to `d.id`. Fixed in commit `657353e` |
| BL-084 | Admin debug GROQ button called `/api/test-groq` (404) | `done` | Button called `/api/test-groq` which doesn't exist. Correct route is `/api/debug/groq`. Fixed in commit `657353e` |
| BL-085 | Session detail `/sessions/[id]` used simple mean for total score | `done` | SQL query didn't fetch `c.weight`; total score computed as `avg(score)` instead of `sum(score×weight)/sum(weight)`. Now consistent with analytics. Fixed in commit `657353e` |
| BL-086 | Admin `save()`/`remove()` silently swallow API errors | `done` | All mutation handlers now check `res.ok` and `alert()` on failure before calling `refresh()`. Fixed in commit `a0deb83` |
| BL-088 | Telnyx `gather_using_speak` with `payload: ''` silently rejected | `done` | Empty payload causes Telnyx to reject the request; error swallowed by webhook catch block; no `call.gather.ended` fires; call goes silent after opening. Fixed with SSML break payload. Fixed in commit `f44b725` |
| BL-089 | `speech_timeout_millis` not a valid Telnyx param — STT never activates | `done` | Without `speech_end_timeout`, Telnyx defaults to DTMF-only; transcript always empty; conversation loop dies after turn 1. Fixed with correct param + `speech_recognition_language`. Fixed in commit `f44b725` |
| BL-090 | `call.gather.ended` reads wrong field for STT transcript | `done` | Code read `payload.transcript` (undefined); Telnyx sends speech as `payload.speech_results.transcription` — all speech was silently discarded, triggering endless "Are you still there?" loop. Fixed in commit `fix-bl-090-091` |
| BL-091 | DTMF key-press ends gather before speech — no transcript captured | `done` | `callGather()` did not set `valid_digits: ''`; any phone key-press immediately ended the gather in DTMF mode, producing `digits` with no `speech_results`. Fixed by setting `valid_digits: ''` to disable DTMF termination. Same commit |
| BL-021 | Add `loading.tsx` for simulate and sessions routes | `done` | Skeleton loaders for both routes |
| BL-022 | Add `not-found.tsx` (404 page) | `done` | `src/app/not-found.tsx` |
| BL-023 | Session detail page `/sessions/[id]` | `done` | Full transcript + per-criteria score breakdown |
| BL-024 | Home page nav should link to expanded admin sections | `done` | Updated Sessions + Admin card descriptions |
| BL-025 | Sessions page: show score bar chart instead of grid | `done` | Horizontal bar chart in list + fixed score color thresholds in detail page |
| BL-026 | Error state when API is unavailable (Neon cold start) | `done` | simulate/page.tsx + sessions/page.tsx — retry button + error message |

### Phone Simulation
| ID | Title | Status | Notes |
|----|-------|--------|-------|
| BL-027 | Telnyx integration — outbound call initiation | `done` | `/api/telnyx/call` route; requires TELNYX_API_KEY + TELNYX_CONNECTION_ID + TELNYX_FROM_NUMBER in .env |
| BL-028 | Telnyx webhook handler (`/api/telnyx/webhook`) | `done` | Full call flow: answered → speak → gather → AI reply → loop; hangup closes session |
| BL-029 | Phone simulation UI — show transcript as call progresses | `done` | Phone call UI in `/simulate/[sessionId]` — dial screen, active call with live transcript polling (3s), hang-up button, call timer |
| BL-054 | Replace phone transcript 3-second poll with SSE | `done` | Chat uses SSE correctly; phone simulation still polls `GET /api/chat` every 3s. Causes 0–3s display delay and unnecessary DB reads during calls |

### AI Quality
| ID | Title | Status | Notes |
|----|-------|--------|-------|
| BL-030 | Seed scenarios with realistic `script` JSON payloads | `done` | All 6 scenarios seeded via Neon MCP with personas + hints |
| BL-079 | Criteria `weight` field ignored in AI scoring prompt | `done` | `scoreSession()` prompt listed criteria without importance; all criteria treated equally. Fixed: prompt now shows `[importance: X/10]` per criterion. Fixed in commit `45af3e8` |
| BL-080 | Analytics aggregates used simple mean instead of weighted mean | `done` | All 4 aggregates in `GET /api/analytics` (`overallAvg`, `scoreTrend`, `byJobTitle`, `byType`) rewritten to use `sum(score×weight)/sum(weight)`. Fixed in commit `45af3e8` |
| BL-081 | Phone sessions never scored on `[RESOLVED]` | `done` | Telnyx webhook `call.gather.ended` handler had a `// TODO` comment in place of actual scoring; `scoreSession()` never ran for phone calls. Fixed in commit `45af3e8` |
| BL-082 | Telnyx webhook used a local 4-line `buildSystemPrompt` stub | `done` | Webhook had its own `buildSystemPrompt` with no persona details, hints, or difficulty guidance. Now imports and calls `buildSessionSystemPrompt` from `src/lib/ai.ts`. Fixed in commit `45af3e8` |
| BL-031 | End-of-conversation detection (AI signals end naturally) | `done` | [RESOLVED] token from AI → auto-end via SSE session_ending/session_ended |
| BL-032 | Scoring: attach justification text per criterion to session view | `done` | Feedback shown in session detail page |
| BL-053 | Enforce `maxTurns` in chat route | `done` | Agent turn count checked before Groq call; session auto-ends and scores when `ScenarioScript.maxTurns` is reached |

### Database Performance
| ID | Title | Status | Notes |
|----|-------|--------|-------|
| BL-052 | Add DB indexes on foreign key columns | `done` | `@@index` added to Prisma schema for `chat_messages(session_id)`, `scores(session_id/criteria_id)`, `simulation_sessions(user_id/job_title_id/org_id)`; migration applied to Neon |

---

## 🟢 Low Priority / Infrastructure

### Done
| ID | Title | Notes |
|----|-------|-------|
| BL-033 | Create `src/types/index.ts` barrel file for shared types | Created with all shared types + SSE event payload types |
| BL-034 | Environment variable validation on startup | `src/lib/env.ts` — warns in dev, throws in prod |
| BL-035 | `prisma/seed.ts` file for repeatable seed data | Full idempotent seed: 3 job titles, 7 criteria, 6 scenarios, links |
| BL-036 | Switch from `prisma db push` to `prisma migrate dev` | Baseline migration + `prisma.config.ts` |
| BL-037 | `wrangler.toml` + `@opennextjs/cloudflare` setup | `wrangler.toml`; pages:build/preview/deploy scripts; `images.unoptimized` in next.config.ts |
| BL-038 | GitHub Actions CI/CD workflow | `.github/workflows/ci.yml` — lint, typecheck, build jobs |
| BL-039 | Edge runtime on all API routes + Neon HTTP adapter | All 10 API routes + sessions/[id] page; `@prisma/adapter-neon` |
| BL-040 | Authentication with NextAuth.js | `src/auth.ts` — GitHub + Credentials; JWT; middleware; `/auth/signin` |
| BL-041 | Analytics dashboard (score trends over time) | `/analytics` + `/api/analytics`; score trend, criteria heatmap, job/type breakdowns |
| BL-042 | Org/team model schema (Phase 6 scaffold) | `Organization` + `User` models in schema; DB tables created |
| BL-043 | Delete stale `src/index.ts` | Confirmed absent; tsconfig exclude kept as safeguard |
| BL-044 | `npm run lint` clean (0 errors) | Verified clean |
| BL-055 | Fix ARCHITECTURE.md table count (7 → 10 tables) | Corrected Feb 21 2026 architecture review |

### Open
| ID | Title | Notes |
|----|-------|-------|
| BL-056 | Scope `job_titles.name` unique to `(orgId, name)` | Global `@unique` on `name` breaks multi-tenancy — two orgs can't share a job title name |
| BL-057 | Add `onDelete: Cascade` on Session→Messages, Session→Scores, JobTitle→Scenarios | Prevents orphaned rows on direct SQL deletes |
| BL-086 | Admin UI `save()`/`remove()` silently swallow 500 errors | `done` — `res.ok` guard + `alert()` added to all 6 mutation handlers across Criteria, Jobs, Scenarios, Orgs tabs. Fixed in commit `a0deb83` |
| BL-087 | Remove `getNextCustomerMessage` dead code from `src/lib/ai.ts` | `done` — Function removed from `ai.ts`, import + test block removed from `ai.test.ts`. Fixed in commit `a0deb83` |
| BL-088 | Telnyx `gather_using_speak` with empty `payload` silently rejected — no gather fires | `done` — Fixed with SSML break payload `<speak><break time="200ms"/></speak>`. Commit `f44b725` |
| BL-089 | `speech_timeout_millis` not a valid Telnyx param; STT defaults to DTMF-only, no transcript | `done` — Renamed to `speech_end_timeout`; added `speech_recognition_language: 'en-US'` and `minimum_phrase_duration: 500`. Commit `f44b725` |
| BL-090 | `call.gather.ended` reads `payload.transcript` — field doesn't exist; Telnyx sends speech as `speech_results.transcription` | `done` — Updated TS interface + handler to use `payload.speech_results?.transcription \|\| speech_results?.results?.[0]?.transcript`. Fixed this commit |
| BL-091 | `callGather()` missing `valid_digits: ''` — DTMF key-press ends gather silently | `done` — Added `valid_digits: ''` to `gather_using_speak` body; only speech now ends the gather. Fixed this commit |
| BL-063 | Add `validate.mjs` integration diagnostic script | `done` | `node validate.mjs` from project root — tests env vars, DB connectivity, scenario scripts, Groq API (streaming + non-streaming), E2E chat with scoring, Telnyx API |
| BL-064 | Clean up 8 stuck `IN_PROGRESS` sessions with 0 messages | `done` | 8 sessions (PHONE/CHAT/VOICE) marked `ABANDONED` via SQL; no messages existed so no data loss |
| BL-065 | Suppress `outputFileTracingRoot` lockfile warning in `next.config.ts` | `done` | Added `outputFileTracingRoot: path.join(__dirname)` to next.config.ts |
| BL-066 | WebRTC voice mode — `VoiceChatInterface` component | `done` | Browser-native; uses Web Speech API (SpeechRecognition + speechSynthesis); wraps existing `/api/chat` SSE endpoint; push-to-hold mic pattern; waveform visualizer; no Telnyx/PSTN required |
| BL-067 | Add `VOICE` to `SimulationType` enum (DB + Prisma + types) | `done` | `ALTER TYPE ... ADD VALUE 'VOICE'`; `prisma generate`; `SimulationType` TS union updated; migration file added |
| BL-068 | Extract `useChatSession` hook from session page | `done` | All SSE + message state logic moved to `src/hooks/useChatSession.ts`; page is now a thin orchestrator |
| BL-069 | Extract `ChatInterface`, `PhoneInterface`, `MessageBubble` components | `done` | `src/components/` — session page went from 633 lines to ~180 lines; each interface is independently testable |
| BL-070 | Dual Chat/Voice launch buttons on simulate page | `done` | CHAT scenarios now offer both `💬 Chat` and `🎙️ Voice` launch buttons; `startSimulation()` accepts a type override |

---

## Completed Items

| ID | Title | Sprint |
|----|-------|--------|
| — | Next.js App Router scaffolding | Phase 1 |
| — | Prisma schema (10 models, 4 enums) | Phase 1 |
| — | Neon DB tables + seed data | Phase 1 |
| — | API routes: jobs, criteria, simulations, scoring | Phase 2 |
| — | UI pages: home, simulate (selector), admin (criteria), sessions | Phase 2 |
| — | `src/lib/ai.ts` Groq client with streaming + auto-scoring | Phase 3 |
| — | `POST /api/chat` SSE streaming chat endpoint | Phase 3 |
| — | `GET /api/chat` session loader | Phase 3 |
| — | `/simulate/[sessionId]` active chat + phone UI | Phase 3 |
| — | Simulate page wired to create session + redirect | Phase 3 |
| — | Sessions page with score display + Resume link | Phase 3 |
| — | Engineering docs (ENGINEERING.md) | Phase 3 |
| — | Technology reference library (docs/tech/) | Phase 3 |
| — | Roadmap + coherence review (ROADMAP.md) | Phase 3 |
| — | `.env.example` | Phase 3 |
| BL-010–013 | Admin: 4 tabs (Criteria, Job Titles, Scenarios, Job↔Criteria) | Phase 3 |
| BL-014–017 | All missing CRUD API routes (jobs, scenarios, job-criteria) | Phase 3 |
| BL-018–019 | Username modal + localStorage identity | Phase 3 |
| BL-020–022 | error.tsx, loading.tsx (×2), not-found.tsx | Phase 3 |
| BL-023 | Session detail page `/sessions/[id]` with full transcript | Phase 3 |
| BL-030 | 6 scenarios seeded with full personas, objectives, hints | Phase 3 |
| BL-024 | Home page card descriptions updated | Sprint 4 |
| BL-026 | Retry button + error messages on simulate/sessions pages | Sprint 4 |
| BL-027 | Telnyx outbound call initiation (`/api/telnyx/call`) | Sprint 4 |
| BL-028 | Telnyx webhook handler — full call flow + auto-scoring on hangup | Sprint 4 |
| BL-029 | Phone simulation UI — dial screen, live transcript poll, hang-up | Sprint 4 |
| BL-031 | AI [RESOLVED] natural end detection + SSE session_ended event | Sprint 4 |
| BL-033 | `src/types/index.ts` shared types barrel (+ SSE payloads) | Sprint 4 |
| BL-034 | `src/lib/env.ts` env var validation (warn dev / throw prod) | Sprint 4 |
| BL-025 | Sessions score bar chart + detail page threshold fix | Sprint 5 |
| BL-032 | Scoring feedback shown in session detail page | Sprint 5 |
| BL-035 | `prisma/seed.ts` — idempotent seed with 3 jobs, criteria, scenarios | Sprint 5 |
| BL-036 | Migration baseline + `prisma.config.ts` | Sprint 5 |
| BL-037 | `wrangler.toml` + `@opennextjs/cloudflare` setup | Sprint 5 |
| BL-038 | GitHub Actions CI/CD workflow | Sprint 5 |
| BL-039 | Edge runtime on all 10 API routes + Neon HTTP adapter | Sprint 5 |
| BL-040 | NextAuth.js — GitHub + Credentials, JWT, `/auth/signin`, middleware | Sprint 5 |
| BL-041 | Analytics dashboard — score trends, criteria heatmap, job/type | Sprint 5 |
| BL-042 | Org/team model schema scaffold (`organizations`, `users`) | Sprint 5 |
| BL-044 | `npm run lint` — clean pass, 0 errors | Sprint 5 |
| BL-050 | Fix Groq model in Telnyx webhook (`llama3-70b-8192` → `llama-3.3-70b-versatile`) | Sprint 6 |
| BL-058 | Fix `@prisma/client/wasm` → standard client in `prisma.ts` (silent dev-server DB failures) | Sprint 6 |
| BL-059 | Fix `create+include` implicit transaction in `simulations/route.ts` (Neon HTTP mode) | Sprint 6 |
| BL-060 | Fix inverted CUSTOMER/AGENT roles in Telnyx webhook | Sprint 6 |
| BL-061 | Fix `script.persona`/`objective` → `customerPersona`/`customerObjective` in webhook | Sprint 6 |
| BL-062 | Fix Groq history role mapping (`USER` → `AGENT`) in Telnyx webhook | Sprint 6 |
| BL-063 | Add `validate.mjs` standalone integration diagnostic | Sprint 6 |
| BL-064 | Clean up 8 stuck IN_PROGRESS sessions (0 messages) | Sprint 8 |
| BL-065 | Add `outputFileTracingRoot` to suppress lockfile warning | Sprint 7 |
| BL-066 | WebRTC voice mode — `VoiceChatInterface` + browser STT/TTS | Sprint 7 |
| BL-067 | `VOICE` SimulationType — DB migration + Prisma regeneration | Sprint 7 |
| BL-068 | Extract `useChatSession` hook | Sprint 7 |
| BL-069 | Extract `ChatInterface`, `PhoneInterface`, `MessageBubble` components | Sprint 7 |
| BL-070 | Dual Chat/Voice launch buttons on simulate page | Sprint 7 |
| BL-072 | Voice mode: Safari/Firefox fallback — text input when STT unavailable | Sprint 9 |
| BL-073 | Voice mode: configurable TTS voice per scenario + UI voice picker | Sprint 9 |
| BL-054 | Replace phone transcript 3-second poll with SSE | Sprint 9 |
| BL-048 | Resolve dual identity model — OAuth User upsert + dbUserId FK | Sprint 8 |
| BL-052 | DB indexes on FK columns | Sprint 8 |
| BL-053 | Enforce `maxTurns` in chat route | Sprint 8 |
| BL-071 | Voice hands-free auto-listen mode | Sprint 8 |
| BL-078 | Missing `gen_random_uuid()` in 4 POST INSERT routes (criteria, jobs, scenarios, job-criteria) | Sprint 11 |
| BL-079 | Criteria weight wired into AI scoring prompt + analytics weighted means | Sprint 11 |
| BL-080 | Analytics aggregates rewritten to use weighted mean | Sprint 11 |
| BL-081 | Phone sessions now scored on `[RESOLVED]` (was a TODO) | Sprint 11 |
| BL-082 | Telnyx webhook uses full `buildSessionSystemPrompt` (was local 4-line stub) | Sprint 11 |
| BL-083 | `JobCriteriaTab` `d.criteriaId` → `d.id` field name fix | Sprint 11 |
| BL-084 | Admin debug GROQ button URL fixed (`/api/test-groq` → `/api/debug/groq`) | Sprint 11 |
| BL-085 | Session detail `/sessions/[id]` weighted score + weight SQL column | Sprint 11 |

---

## Next Sprint Candidates

### Sprint 9 — Voice Quality + UX
1. **BL-072** — Voice mode: Safari/Firefox fallback (show text input if SpeechRecognition unavailable) `done`
2. **BL-073** — Voice mode: configurable TTS voice selection per scenario `done`
3. **BL-054** — Replace phone transcript poll with SSE `done`

### Sprint 10 — Security + Multi-Tenancy
1. **BL-046** — Add auth checks to all API routes
2. **BL-047** — Credentials provider: verify `User.role` before granting admin access
3. **BL-049** — Wire `orgId` filter into all API queries
4. **BL-051** — Telnyx webhook signature verification
5. **BL-056** — Fix `job_titles.name` unique constraint to `(orgId, name)` scope
6. **BL-057** — Add `onDelete: Cascade` on Session→Messages/Scores, JobTitle→Scenarios

### Sprint 11 — Admin UX + Dead-Code Cleanup + Telnyx STT
1. ~~**BL-086** — Admin `save()`/`remove()` error handling~~ ✅ done `a0deb83`
2. ~~**BL-087** — Remove `getNextCustomerMessage` dead code~~ ✅ done `a0deb83`
3. ~~**BL-088** — Telnyx gather empty payload silently rejected~~ ✅ done `f44b725`
4. ~~**BL-089** — Telnyx STT never activated (`speech_timeout_millis` → `speech_end_timeout`)~~ ✅ done `f44b725`
5. ~~**BL-090** — `call.gather.ended` reads wrong transcript field (`payload.transcript` → `speech_results.transcription`)~~ ✅ done this commit
6. ~~**BL-091** — DTMF key-press silently ends gather; add `valid_digits: ''` to disable~~ ✅ done this commit
7. **BL-056** — Scope `job_titles.name` unique to `(orgId, name)` (carry forward)
8. **BL-057** — Add cascade deletes (carry forward)
