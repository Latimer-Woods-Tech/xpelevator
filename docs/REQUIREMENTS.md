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
