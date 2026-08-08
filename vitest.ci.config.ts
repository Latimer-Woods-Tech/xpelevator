import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * CI coverage gate — deterministic tiers only.
 *
 * The base `vitest.config.ts` runs EVERY tier (including integration/smoke,
 * which hit live Neon + Groq via `tests/setup.ts`) and can't be a required
 * gate: it flakes on credentials and drifts. This config isolates the two
 * DETERMINISTIC tiers — `tests/unit` and `tests/ui` (all deps mocked, no DB /
 * LLM / Telnyx creds) — and enforces a real coverage floor on the pure
 * business-logic surface (`src/lib/**`).
 *
 * Runtime-only glue that cannot be exercised without a live Cloudflare/Neon
 * binding is excluded from the measured surface (it belongs to the integration
 * tier, not this deterministic gate):
 *   - db.ts / prisma.ts         — client construction against a real binding
 *   - http-agent-polyfill.ts    — Node undici polyfill, no logic to assert
 *
 * API routes (`src/app/api/**`) join this gate INCREMENTALLY (issue #16, P2-7):
 * a route is added to `include` below only once it has a DETERMINISTIC test
 * under `tests/unit/api/**` (mocks `@/lib/db` + `@/lib/auth-api`, no live
 * creds — the pattern that RETIRED the credential-bound `tests/integration`
 * tier and the `DISABLE_AUTH` crutch). An explicit allowlist keeps the floor
 * honest: an untested route can't silently drag the measured percentage.
 * Routes under the gate (29): `analytics`, `analytics/latency`, `plans`, `me`,
 * `health`, `reports/sessions`, `branding/[slug]`, `branding/by-host`,
 * `orgs/[id]/branding`, `orgs/[id]/clients`, `orgs/[id]/members`,
 * `scenario-packs`, `scenario-packs/import`, `scenario-packs/status`, `scoring`,
 * `scenario-packs/upgrade`, `telnyx/call`, `simulations`, `scenarios`,
 * `scenarios/[id]`, `jobs/[id]/criteria`, `chat` (each ≥ the floors — `chat`
 * joined last: the ~635-line SSE scoring hot path (#156), covering the POST
 * guards + streamed-turn framing + `[RESOLVED]`/`[END]`/maxTurns finalize-and-
 * score + the GET transcript read + the phone live-transcript SSE poll, 90.9%
 * branch; an anon `POST /api/chat`→401 fix rode along). The prose "sweep is
 * COMPLETE" that once sat here was repeatedly overstated: the standalone
 * `criteria` (#192), `jobs`/`jobs/[id]` (#193), and `orgs`/`orgs/[id]` resources
 * were each still outside the gate when successive versions of it were written.
 * With the standalone `orgs` governance routes now covered, the `src/app/api/**`
 * deterministic-coverage sweep (P2-7) is genuinely COMPLETE — every route under
 * `src/app/api/**` (standalone + nested) now carries a deterministic test and
 * sits in this allowlist. The credential-bound `tests/integration` tier + the
 * `DISABLE_AUTH` crutch (P1-7) have since been RETIRED — the deterministic mocks
 * cover the surface.
 *
 * Thresholds sit below the currently-achieved numbers (lines ~97, branches ~91,
 * functions ~99) so ordinary edits don't flake the gate, while still catching a
 * real regression. Target per PLATFORM_STANDARDS §3-4: 80 line / 85 branch / 70
 * function — ALL THREE now met and gated: the branch floor is at the §3-4 target
 * of 85 (achieved ~91, a healthy margin), completing the "branches ratchet toward
 * 85" Phase-3 sub-slice tracked in issue #16.
 */
export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['./tsconfig.test.json'] })],
  esbuild: { jsx: 'automatic' },
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  test: {
    globals: true,
    environment: 'node',
    environmentMatchGlobs: [['tests/ui/**', 'happy-dom']],
    setupFiles: ['./tests/setup.ts'],
    include: [
      'tests/unit/**/*.test.ts',
      'tests/unit/**/*.test.tsx',
      'tests/ui/**/*.test.tsx',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: [
        'src/lib/**/*.ts',
        // API routes join the gate as they gain a deterministic test (P2-7).
        'src/app/api/analytics/route.ts',
        'src/app/api/analytics/latency/route.ts',
        'src/app/api/plans/route.ts',
        'src/app/api/me/route.ts',
        'src/app/api/health/route.ts',
        // Governance audit-trail read surface (issue #157 §10) — ADMIN-only,
        // org-scoped; the read side of the append-only log written by src/lib/audit.ts.
        'src/app/api/audit/route.ts',
        'src/app/api/reports/sessions/route.ts',
        // LLM spend ledger (#155) — ADMIN-only, org-scoped read that prices the
        // persisted per-turn token usage into per-session/tenant Groq spend. Anon
        // 401 / non-admin 403 / own-org + null-org owner-only scope /
        // clientOrgId operator→client (404/403/200) / malformed-window 400 /
        // since+until composition all deterministically covered.
        'src/app/api/reports/spend/route.ts',
        // Monthly LLM budget report (#155) — ADMIN-only, org-scoped read that
        // evaluates month-to-date Groq spend against the seat-tier ceiling the
        // POST /api/simulations gate enforces. Anon 401 / non-admin 403 /
        // own-org scope / tier-from-plan / over-ceiling status / 500 covered.
        'src/app/api/reports/budget/route.ts',
        // Operator-hierarchy + white-label + SKU surfaces (the R-043 routes that
        // had live cross-tenant bugs in runs 30/31/32) — each already ≥ floor.
        'src/app/api/branding/[slug]/route.ts',
        'src/app/api/branding/by-host/route.ts',
        'src/app/api/orgs/[id]/branding/route.ts',
        'src/app/api/orgs/[id]/clients/route.ts',
        'src/app/api/orgs/[id]/members/route.ts',
        'src/app/api/scenario-packs/route.ts',
        'src/app/api/scenario-packs/import/route.ts',
        'src/app/api/scenario-packs/status/route.ts',
        // Manual score-override write path — ADMIN-only, tenant-scoped; the
        // rows it writes feed analytics + the operator-facing manager reports.
        'src/app/api/scoring/route.ts',
        // Opt-in pack re-sync (R-047 counterpart to the frozen import) — ADMIN-only,
        // tenant + provenance scoped; every write branch (stale UPDATE, idempotent
        // INSERT, orphan-report) now deterministically covered.
        'src/app/api/scenario-packs/upgrade/route.ts',
        // Billable outbound PSTN dial — auth + ownership + per-seat modality gate
        // at the money point, plus the from-number resolution (caller / CF binding /
        // process.env) and the 500 error boundary — all branches now covered.
        'src/app/api/telnyx/call/route.ts',
        // Inbound Call Control webhook — the PHONE modality's control loop
        // (~474 lines): malformed-JSON 400, Ed25519 signature 401 (fail closed),
        // the call.answered opening + idempotency skip + speak-failure fallback,
        // call.speak.ended listen/hangup, the call.transcription turn (partials
        // ignored, noise re-listen, STT→model→speak, [RESOLVED] finalize+score),
        // and call.hangup → ABANDONED. First deterministic coverage of the
        // differentiating voice path (P2-8).
        'src/app/api/telnyx/webhook/route.ts',
        // Core session-create + list write path (the last core write route to
        // join the gate): POST guards (auth/validation/not-found/cross-tenant/
        // daily-cap/500) + per-seat modality gate, and the GET list's admin-org
        // vs own-sessions branches with hidden-script sanitization — 94% branch
        // (only the NODE_ENV==='production' detail-suppression ternaries remain).
        'src/app/api/simulations/route.ts',
        // Admin-authored scenario CRUD — the hidden-mechanic boundary (persona /
        // objective / hints live in `script`). GET list + GET-by-id now cover
        // every org-scoped query shape and the sanitizer (trainee sees only
        // ttsVoiceName; admin sees the full script); POST tenant-scope guard and
        // PUT/DELETE global-catalog protection + all auth/500 boundaries covered.
        'src/app/api/scenarios/route.ts',
        'src/app/api/scenarios/[id]/route.ts',
        // Job↔criteria link CRUD. GET/POST cross-tenant read/link IDOR guards +
        // the DELETE unlink guards (own-org admin only; global catalog protected)
        // all covered.
        'src/app/api/jobs/[id]/criteria/route.ts',
        // Standalone job-title CRUD — missed by the link-route sweep above
        // (`jobs/[id]/criteria`), the same class of gap the `criteria` resource
        // had before #192. GET org-scoped read (anon 401 / org-filter-bind vs
        // global-only branches / 500), POST ADMIN-only own-org create (INSERT
        // binds the session org), and the PUT/DELETE `canMutateResource` guard
        // protecting the GLOBAL catalog from tenant admins + blocking cross-org
        // mutation (platform admin owns global). Every auth/guard branch covered;
        // the only residue is the `NODE_ENV !== 'production'` detail-suppression
        // ternary, same as the `simulations` entry above.
        'src/app/api/jobs/route.ts',
        'src/app/api/jobs/[id]/route.ts',
        // The SSE scoring hot path (~635 lines) — the product's core loop.
        // POST guards (auth/validation/size/not-found/cross-tenant/closed/
        // throttle) + the streamed turn (chunk→done framing, CUSTOMER-reply
        // INSERT), the [RESOLVED]/[END]/maxTurns auto-end + finalize/score, and
        // the mid-stream error frame; GET transcript read (auth/tenant/sanitizer/
        // 404/500) and the phone live-transcript SSE poll (transcript/ended/
        // error). Anon POST now maps AuthError→401 (was a masked 500).
        'src/app/api/chat/route.ts',
        // Client-side session state machine + SSE message loop shared by chat
        // and voice modes (P2-8 — the remaining untested half of the voice path
        // after the src/app/api/** gate sweep). Deterministic renderHook tests
        // (mock global.fetch; a real ReadableStream drives the SSE frames; the
        // pure splitSpeechChunks runs for real) cover load (in-progress /
        // COMPLETED / CANCELLED / not-ok), the streamed chunk→done turn with
        // speech-chunk + timing emission, session_ending then session_ended
        // (re-fetch + end), the silent-signal [START] optimistic-skip, malformed-
        // line skipping, the non-streaming end body, POST-not-ok → error, the
        // empty-content guard, and endConversation → [END].
        'src/hooks/useChatSession.ts',
        // Standalone scoring-criteria CRUD — missed by the link-route sweep
        // above (`jobs/[id]/criteria`). GET org-scoped read (anon 401 / own+global
        // vs global-only branches / 500), POST ADMIN-only own-org create, and the
        // PUT/DELETE `canMutateResource` guard that protects the GLOBAL catalog
        // from tenant admins + blocks cross-org mutation — all branches covered.
        'src/app/api/criteria/route.ts',
        'src/app/api/criteria/[id]/route.ts',
        // Standalone org governance CRUD — the LAST uncovered standalone
        // resource, and the most security-loaded (the nested
        // `orgs/[id]/{branding,clients,members}` sub-routes were already gated).
        // LIST is admin-only + scoped (platform sees all; tenant/operator sees
        // own + owned clients); CREATE is PLATFORM-admin-only (a tenant admin is
        // refused a top-level mint); `[id]` GET/PUT/DELETE run the real R-043
        // guards — `canAccessOrg` (own/owned-client vs cross-tenant),
        // `canSetOrgPlan` (an org's own admin may rename but NOT self-upgrade the
        // seat tier — the billing bypass), and `canDeleteOrg` (no self-delete of a
        // provisioned workspace; session-free-only). With this the
        // `src/app/api/**` deterministic-coverage sweep (P2-7) is COMPLETE.
        'src/app/api/orgs/route.ts',
        'src/app/api/orgs/[id]/route.ts',
      ],
      exclude: [
        'src/lib/db.ts',
        'src/lib/prisma.ts',
        'src/lib/http-agent-polyfill.ts',
      ],
      thresholds: {
        lines: 85,
        functions: 90,
        branches: 85,
        statements: 85,
      },
    },
  },
});
