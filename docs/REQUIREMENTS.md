# XPElevator — Requirements

> The real and true requirements this build is held accountable to. Numbered,
> testable, statused. Every control-issue (#16) slice references the requirement
> IDs it advances; every `live` flip needs verification evidence in the #16
> comment. Status ∈ `live | building | roadmap | rejected | parked`. `rejected`
> rows stay here with their reason — rejected scope is a guardrail.
>
> Verification note: this repo's sandbox cannot curl the live branded domain
> directly (egress allowlist), so `curl` evidence for `live` rows is produced by
> the GitHub Actions runner — `deploy.yml` post-deploy gates and
> `uptime-monitor.yml` — which is the authoritative live check for every slice.

## Functional

| ID | Requirement | Status | Verification |
|---|---|---|---|
| R-001 | A trainee can run a **chat** simulation against an admin-authored scenario and receive a streamed customer response | live | `/api/chat` SSE; ui test `tests/ui/simulate-page`; canary session drives full chat |
| R-002 | A completed session produces a **non-null /10 score** against weighted per-role criteria | live | 6 h scoring canary (uptime-monitor.yml) → session `dad64d13` 7/7 non-null, avg 6.86 |
| R-003 | A trainee can run a **browser voice** simulation (push-to-talk + hands-free) | live | Web Speech path in `src/app/simulate`; manual |
| R-004 | A trainee can run a **real phone** simulation via Telnyx | live | `/api/telnyx/call` + `/api/telnyx/webhook`; `src/lib/telnyx.ts` |
| R-005 | An org admin can CRUD job titles, criteria, scenarios, and job↔criteria links, org-scoped | live | `/api/jobs`,`/api/criteria`,`/api/scenarios`; admin UI |
| R-006 | The platform is multi-tenant: rows are org-scoped and one org cannot read another's sessions | live | `canAccessSession` (owner-or-same-org); deploy gate: anon 401 / cross-tenant 403 / owner 200 (run 28755424092) |
| R-007 | A public seat-plan catalog is served for the operator pricing surface | live | `GET /api/plans` (PR #36); unit tests `src/lib/plans.ts` |

## Security

| ID | Requirement | Status | Verification |
|---|---|---|---|
| R-020 | Every `/api/*` read except the public allowlist requires authentication | live | deploy gate: anon `/api/{scenarios,jobs,criteria}` → 401 (run 28745544626) |
| R-021 | Scenario **hidden hints / persona / objective are never returned to non-owners** (the core product mechanic) | live | deploy gate: anon `/api/scenarios` body has no `hints`/`customerObjective`/`customerPersona` |
| R-022 | No IDOR on session reads: cross-tenant `GET /api/chat?sessionId=` is blocked | live | deploy gate: cross-org read → 403 for JSON + `?stream=true` (PR #28/#29) |
| R-023 | Security headers (CSP, HSTS, nosniff, X-Frame-Options DENY, Referrer/Permissions-Policy) on every response | live | deploy gate on live domain + pages.dev (PR #30, run 28759891246) |
| R-024 | No secrets in source or `wrangler.toml`; app secrets are CF Pages secrets | live | grep of repo; `wrangler.toml` carries placeholders only |

## Experience (Phase E — conversation realism)

Founder directive (#16, 2026-07-10): the conversation "is currently a half speed sparring session vs a real life simulation." Phase E-root #2: voice mode waited for the full model reply before speaking a single word (TTS fired only on the SSE `done` event) → multi-second dead air every turn.

| ID | Requirement | Status | Verification |
|---|---|---|---|
| R-030 | Voice mode speaks the customer reply **incrementally** — first audio starts on the first complete sentence as the stream arrives, not after the whole response | live | pure boundary logic `src/lib/speech.ts` (unit: `tests/unit/lib/speech.test.ts`, 100% lines); `useChatSession` emits `speechChunks` per sentence; `VoiceChatInterface` speaks each as it lands. Listen-test: multi-sentence reply begins audibly before the reply finishes |
| R-031 | The simulated customer's **emotional state is fixed for the whole session** (deterministic from scenario + session id), not re-rolled per turn — a "hard" customer no longer flip-flops angry↔frustrated between messages | live | the system prompt is rebuilt every turn (chat + telnyx routes), so `src/lib/ai.ts` selects the mood deterministically via `stableIndex` (replaces `Math.random()`); routes pass `sessionId` as the seed. Unit `tests/unit/lib/ai.test.ts`: mood stable across 25 rebuilt turns, `Math.random` never called, variety preserved across sessions |
| R-032 | The simulated customer has **one coherent name**, owned by the scenario persona — the prompt no longer injects a name from a fixed pool alongside the persona's own name (which produced two conflicting names in one prompt) | live | `src/lib/ai.ts` — the `CUSTOMER_NAMES` pool is removed; `buildCustomerSystemPrompt` lists only the persona under identity and instructs the customer to hold one fixed name (the persona's if named, else self-chosen) for the whole call. Unit `tests/unit/lib/ai.test.ts` (E-root #4): no retired-pool name leaks, no `- Name:` line, persona-supplied name surfaces, fixed-name directive present |
| R-033 | **Scoring never silently discards a session's scores.** A recoverable defect in the judge model's JSON (leading/trailing prose, markdown fences, a bare object, one malformed row, truncation) must still yield every well-formed score rather than an unexplained zero; a scorable session that genuinely produces no scores is surfaced to the client as `scoringFailed`, not persisted as a silent zero | live | `src/lib/ai.ts` — pure `parseScoreRows()` recovers rows via whole-parse → first balanced `[…]` substring → per-object salvage; `scoreSession` uses it and logs distinctly on total failure. `src/app/api/chat/route.ts` `endSession` returns `scoringFailed` when a scorable session yields zero scores. Unit `tests/unit/lib/ai.test.ts` (E-root #8): recovers prose-wrapped/fenced/bare-object JSON, salvages around one malformed row, drops rows missing numeric fields, `[]` only for unrecoverable garbage |
| R-035 | **A manager can tell a scoring FAILURE apart from a genuinely un-scorable session.** Each completed session records a `scoring_status` (`SCORED` / `FAILED` / `NOT_SCORABLE`) at end-of-session; the manager reporting export surfaces it as a `Scoring` column so a null/blank score is never ambiguous — the "managers don't trust the /10 scores" kill-signal | live | migration `20260711160000_add_scoring_status` (nullable, additive; applied by the `migrate` job now gating `deploy.yml`); `endSession` (`src/app/api/chat/route.ts`) persists the status; `src/lib/report.ts` `scoringLabel()` maps it to the last CSV + PDF column. Unit `tests/unit/lib/report.test.ts` (E-root #8b): `Failed` ≠ `Not scorable`, pre-instrumentation rows inferred, `Scoring` is the last column |
| R-034 | **A lightly-configured scenario still feels like a real person.** A scenario with a missing or partial `script` falls back field-by-field — a set difficulty/objective/hints is preserved, never discarded by an all-or-nothing reset — and any genuinely absent persona/objective is grounded in the scenario name, not the contentless generic "a customer who needs assistance" | live | `src/lib/ai.ts` — pure `normalizeScript()` fills each field independently with scenario-grounded defaults and always resolves a valid difficulty (guards the latent `undefined.toUpperCase()` crash on a partial script). Unit `tests/unit/lib/ai.test.ts` (E-root #6): preserves set difficulty/objective/hints when persona missing, grounds fallback persona+objective in the scenario name, invalid difficulty → medium, empty scenario name handled, full valid script unchanged |
| R-036 | **The scoring outcome is visible on-screen, not only in the export.** The in-app `/analytics` view surfaces a per-org **Scoring Health** breakdown (Scored / Failed / Not scorable / Unknown) so a manager sees a scoring-engine failure without downloading the CSV/PDF — and is warned explicitly when any session failed to score. Screen and export use the same canonical mapping so they never drift | live | `src/app/api/analytics/route.ts` selects `scoring_status` and counts each session via the shared `scoringLabel()` (`src/lib/report.ts`, widened to a narrow input) into a `scoringHealth` field; `src/app/analytics/page.tsx` renders the breakdown + a red failure warning when `failed > 0`. UI `tests/ui/analytics-page.test.tsx`: breakdown renders from the payload, warns on failures, omits the warning when none failed |

## Non-functional

| ID | Requirement | Status | Verification |
|---|---|---|---|
| R-100 | `/api/health` returns 200 on the branded domain when required env is present | live | `curl https://xpelevator.com/api/health` → 200 (uptime-monitor run 29034316829) |
| R-101 | The Groq scoring credential is valid (the Phase-0 expiry never silently recurs) | live | direct Groq `/v1/models` probe every 15 min (uptime-monitor.yml) |
| R-102 | Health probe every 15 min + scoring canary every 6 h; failure opens one alert issue | live | `uptime-monitor.yml`; run 29034316829 green |
| R-103 | CI blocks merge on typecheck + lint + unit + ui (credential-free) tiers | live | `ci.yml` gates; run 28790934684 (21 ui + 85 unit) |
| R-104 | Coverage ratchets toward 80/85/70 → 90/90/85 floors | building | Vitest coverage; not yet gated |
| R-110 | Deploy secrets managed via org GCP Secret Manager / WIF, not repo secrets | building | blocked on GCP-admin WIF pool binding for this repo (#16 2026-07-06) |
| R-111 | Sentry initialized with sourcemap upload in the deploy workflow | roadmap | Sentry event on a forced error; `docs/SLO.md` present |
| R-112 | PostHog product analytics wired; service-registry + feature-registry entries | roadmap | `feature-registry.yml` present (§11); `/platform/` dashboard reflects it |

## Aspirational (operator / billing / differentiators)

| ID | Requirement | Status | Verification |
|---|---|---|---|
| R-040 | Self-serve operator onboarding → operator workspace that creates + manages client orgs beneath it | roadmap | Phase 4; operator hierarchy on `@latimer-woods-tech/operator` |
| R-041 | Operator buys seats wholesale via Stripe; sets own retail | roadmap | Stripe test-mode products bound by `lookup_key`; then 🔒 live gate |
| R-042 | Per-seat modality gating (chat / +voice / +phone) enforced from the seat tier | roadmap | gating reads `src/lib/plans.ts`; e2e per tier |
| R-043 | Platform-super-admin vs tenant-admin split for cross-org `/api/orgs/*` governance | roadmap | Phase 4 operator hierarchy |
| R-044 | White-label operator branding (name/logo/colors) + operator subdomain | roadmap | §17.2 launch rung |
| R-045 | Manager reporting + CSV/PDF export (the artifact operators show clients) | roadmap | Phase 4 |
| R-046 | **Starter scenario-library packs — operators have sellable inventory on day one.** Curated per-vertical packs (a role + a spread of scenarios across difficulty and modality) are shipped as pure, Worker-safe data (`src/lib/scenario-packs.ts`) and served on a public, hidden-mechanic-safe catalog for operators to browse before purchase. The public catalog NEVER exposes a scenario's `script` (persona / objective / hints) — the same Phase-2 boundary as R-021 — so the concealed mechanics stay server-side until an authenticated admin import materialises a pack into org-scoped `scenarios`/`job_titles` (R-047) | live | `GET /api/scenario-packs` (public, no script leak) + `/library` operator surface; unit `tests/unit/lib/scenario-packs.test.ts` + `tests/unit/api/scenario-packs.test.ts` (no `customerPersona`/`customerObjective`/`hints` in the payload), UI `tests/ui/library-page.test.tsx`; deploy gate: anon `/api/scenario-packs` → 200 + no hidden-mechanic keys, anon `/library` → 200 + copy-clean |
| R-047 | **Admin import: a starter pack materialises into the caller's org.** An ADMIN can `POST /api/scenario-packs/import { packId }` to turn a catalog pack (R-046) into usable, org-scoped `job_titles` + `scenarios` rows — the half of "sellable inventory" that makes the catalog actionable. The write is ADMIN-only + strictly tenant-scoped (anon 401, non-admin 403, no-org 400) and **idempotent + non-clobbering**: re-importing a pack never duplicates and never overwrites an operator's later edits (a pack imported for a client stays frozen even if the public pack later improves), and every row is stamped with `source_pack_id` + `pack_version` so drift is detectable by a future "upgrade pack" slice. The import response carries a pure modality/cost **profile** (per-modality counts, latency risk, interruption-handling flag, turn estimate) so an operator sees the operational shape before committing; a `dryRun` preview writes nothing | live | `POST /api/scenario-packs/import` (`buildPackImportPlan` / `packModalityProfile` in `src/lib/scenario-packs.ts`; `ON CONFLICT DO NOTHING` on the org-scoped provenance indexes in migration `20260712120000_add_pack_provenance`); unit `tests/unit/api/scenario-packs-import.test.ts` (401/403/400/404, dry-run, fresh/re-import/partial idempotency, 500) + `tests/unit/lib/scenario-packs.test.ts` (plan + profile); middleware gate `tests/unit/middleware.test.ts` (catalog public, import subpath 401); deploy gate: anon `POST /api/scenario-packs/import` → 401 on both hosts |
| R-120 | LLM routed through `@latimer-woods-tech/llm` on a per-app CF AI Gateway | roadmap | Phase 5; ghost-gateway preflight |
| R-121 | Voice upgrade: Deepgram STT + ElevenLabs TTS behind a provider abstraction | roadmap | Phase 5 |
| R-130 | User-facing copy uses craft vocabulary, never the word "AI" | building | copy-pass (Phase 4); unit guard already blocks "AI" in plan copy |

## Rejected (do-not-build guardrails)

| ID | Requirement | Status | Reason |
|---|---|---|---|
| R-900 | Retail / consumer self-serve signup | rejected | Channel-first: we sell to operators, not individuals (founder 2026-07-05) |
| R-901 | End-customer marketing / retail pricing site | rejected | Only an operator-facing demo/wholesale surface exists |
| R-902 | Deep Telnyx-specific coupling | rejected | Bandwidth swap is planned; keep telephony behind a provider seam |
| R-903 | Multiplayer role-play / cohort analytics / adaptive difficulty now | parked | Parked until paying tenants exist — revisit, don't build |
