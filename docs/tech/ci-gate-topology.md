# CI + Deploy Gate Topology — XPElevator

The map of **every automated gate** that protects the simulator: what runs
pre-merge, what runs on deploy, and what watches production between deploys.
Consolidated here (issue #16, Phase 3 "CI + quality gates") so the gate set is
**discoverable rather than tribal** — the [`ARCHITECTURE.md`](../ARCHITECTURE.md)
CI/CD section is the one-paragraph summary; this is the full reference.

**Sources of truth** (this doc is grep-derived from them — trust them if they
drift): `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`,
`.github/workflows/uptime-monitor.yml`, `vitest.ci.config.ts`.

> **Standing Law 1 — proof-of-rejection.** Every gate below shipped **red-first**:
> the PR that introduced it also carried a test/curl that made it FAIL, linked in
> that PR. A gate with zero lifetime rejections is presumed broken. When you add a
> gate, add its failing proof in the same PR.

> **Why the runner-side curls are authoritative.** The cloud build sandbox's
> egress to `xpelevator.com` is `403`-blocked (proxy `connect_rejected`), so a
> local status-line curl from a build session is not possible. The `deploy.yml`
> post-deploy steps curl from the GitHub Actions runner (which is not blocked) —
> those step results are the authoritative "curl-with-your-own-eyes" live signal.

---

## 1. Pre-merge — `ci.yml` (required on every PR + push to `main`)

Triggers on `pull_request` and `push` to `main`; `concurrency` cancels an
in-progress run when a newer commit lands. Six parallel gate jobs, then a single
aggregator:

| Job (status name) | What it enforces |
|---|---|
| **Quality** (`quality`) | `npm run typecheck` (tsc --noEmit) **and** `npm run lint` (eslint, zero errors) |
| **Dependency audit** (`audit`) | `npm audit --omit=dev --audit-level=high` **blocks** (prod tree); a full-tree audit runs advisory (`continue-on-error`) until dev-tree advisories clear |
| **Unit tests** (`unit-tests`) | `npm run test:unit` — `vitest run tests/unit`, all deps mocked (auth / next-auth / next-navigation / fetch); no DB/LLM/Telnyx creds |
| **UI tests** (`ui-tests`) | `npm run test:ui` — `vitest run tests/ui`, React render in happy-dom |
| **Coverage gate** (`coverage`) | `npm run test:coverage:ci` — see §2 |
| **Build** (`build`) | `npm run build` (OpenNext) with dummy `DATABASE_URL` / `GROQ_API_KEY` / `AUTH_SECRET` (no build-time DB connection) |

### The `ci` aggregator context (load-bearing)
The `main`-protection ruleset requires **one** status context literally named
`ci`. Until 2026-07-26 no job carried that name, so the required check never
reported, auto-merge could never fire, and every merge went through **admin
bypass** (the G70 survey that credited this repo with a working `ci` gate was
wrong). The `ci` job now IS that context: `if: always()`,
`needs: [quality, unit-tests, ui-tests, coverage, build, audit]`, and it fails
unless **every** dependency's result is `success`. Do not rename it, and do not
add a gate job without adding it to that `needs` list — a gate absent from
`needs` cannot block a merge.

The **integration** and **smoke** tiers hit live Neon + Groq (real `.env` via
`tests/setup.ts`) and carry residual credential drift, so they are deliberately
**NOT** wired as required checks — a credential-dependent suite would flake or
block every PR. Making them deterministic is tracked Phase-3 work in #16.

---

## 2. Coverage gate — `vitest.ci.config.ts`

Runs the two **deterministic** tiers (unit + ui) with coverage over the pure
business-logic surface (`src/lib/**`, minus runtime-only DB/binding glue) plus
the API routes that have earned a deterministic `tests/unit/api/**` test (a route
joins the `include` allowlist only once such a test exists — the P2-7 line in
#16). Floors (PLATFORM_STANDARDS §3–4), set just below the achieved numbers so
ordinary edits don't flake while a real regression still trips it:

| Metric | Floor | ~Achieved |
|---|---|---|
| Statements | 85 | ~97.7 |
| Branches | 85 | ~92 |
| Functions | 90 | ~97 |
| Lines | 85 | ~98 |

The "branches ratchet toward 85" from earlier phases is complete.

---

## 3. Deploy — `deploy.yml` ("Deploy to Cloudflare Pages (LWT)")

`concurrency: deploy-lwt` (one deploy at a time). DNS is **untouched** by this
workflow (the branded-domain CNAME flip was a one-time 🔒 founder-gated action,
ADR-0001 / #16 Phase 1(e)), so a merge-triggered deploy is safe. Three
sequential jobs — **fail-closed**: infra is never touched unless the gate before
it is green.

### 3.1 `ci-gate`
Re-runs typecheck + lint + unit + ui + coverage before anything else. A red tree
never reaches the DB or a deployment.

### 3.2 `migrate` (needs `ci-gate`) — backup + migrate live Neon
The app is still on **Neon** (`aged-butterfly-52244878`), not yet cut to OCI, so
migrations run against the live DB with a backup-first discipline:
1. Recover a previously-failed migration (idempotent).
2. **Backup DB + build a dry-run baseline plan** (`scripts/db-backup-and-guard.mjs`)
   → uploaded as the `neon-backup-<run_id>` artifact.
3. Compute the **direct (non-pooled)** URL for migrations.
4. `prisma migrate status` **BEFORE** (dry-run evidence).
5. Baseline any already-present but unrecorded migrations.
6. `prisma migrate deploy`.
7. `prisma migrate status` **AFTER** — must report **"up to date"** or the job fails.

### 3.3 `deploy` (needs `migrate`) — build → preview → smoke → promote → verify
1. **Stamp build info** (commit SHA + timestamp) into `src/build-info.ts` — this
   is what the G72 drift gate later reads back off the live build.
2. Build with **OpenNext**; bundle the worker for Pages advanced mode.
3. Ensure the Pages project exists (idempotent); set Pages **project** secrets
   (production) + **preview-environment** secrets.
4. Deploy to a **PREVIEW** deployment (no promotion) + capture its URL.
5. **Smoke-gate the preview build BEFORE promoting** (`id: smoke`, fail-closed).
   If preview or smoke fails, an alert step fires and **promotion is blocked** —
   a bad build never reaches live trainees.
6. **Promote** the smoked build to production (`--branch=main`).
7. Run the post-deploy live gates (§3.4) against the promoted prod build.

### 3.4 Post-deploy live gates (curl from the runner)
Every one is a hard gate on the promoted build (and, where noted, the
`xpelevator-sim.pages.dev` alias). Grouped by concern:

**Core loop**
- `/api/health` → **200** on the pages.dev alias.
- **G72 build-commit drift gate** — the promoted build reports **this** commit
  (proves prod actually serves the merge SHA, not a stale build).
- **Groq scoring credential live** — `api.groq.com/openai/v1/models` is reachable
  and the key is not expired (the original scoring-outage class, #16 live-issue #1).

**Phase-2 security / tenant isolation**
- Read-auth **401** + **no hidden-hint leak** (anon `/api/scenarios` carries no
  `hints` / `customerObjective` / `customerPersona`).
- Tenant isolation on session reads (anon 401 / cross-tenant 403 / owner 200).
- `/api/orgs` cross-org governance isolation (R-043, platform-super-admin vs
  tenant-admin split).
- Job-criteria cross-org read isolation.
- Job-title ↔ scenario cross-org isolation.
- Scoring-criteria cross-tenant isolation.
- **Security headers** (CSP `frame-ancestors 'none'`, HSTS, `nosniff`,
  `X-Frame-Options: DENY`, Referrer-Policy, Permissions-Policy) on every response.

**Phase-4 surfaces**
- `/api/plans` anon **200** (public catalog, no internal `stripeLookupKey` wiring).
- `/pricing` anon **200** (operator surface, copy-clean).
- Scenario-library catalog + `/library` surface reachable.
- Pack **import / upgrade / status** admin-gated; operator **client-management**
  and **branding** admin-gated.
- Simulation-start auth-gated (Phase-4 modality gating).
- Client-facing brand read public + brand-safe; host-resolved brand read public +
  non-operator-safe.
- Self-context `/api/me` auth-gated; operator workspace page auth-gated; manager
  reporting export (`/api/reports/sessions`) auth-gated.
- Home page **copy-clean** — the banned word "AI" never appears (org copy rule).

**Telemetry**
- Per-turn latency telemetry persists (R-066); response-speed read surface (R-067).

---

## 4. Between deploys — `uptime-monitor.yml`

- **Health probe — every 15 min:** `/api/health` → 200 on `xpelevator.com`
  **and** the `pages.dev` alias, plus a **direct Groq `/v1/models` credential
  probe** that catches an expired key *before* scoring silently nulls.
- **Scoring canary — every 6 h:** drives a full **authenticated** session on the
  live branded domain and asserts a **NON-NULL** score end-to-end, then prunes
  old canary sessions.
- Any failure **opens or updates a single GitHub alert issue** (deduped, not a
  new issue per run).

---

## 5. Adding or changing a gate — checklist

1. Ship it **red-first** (Standing Law 1): include the failing proof in the PR.
2. A pre-merge gate must be added to the `ci` job's `needs` list, or it cannot
   block a merge.
3. A post-deploy gate is a curl step in `deploy.yml`'s `deploy` job — assert an
   exact status code, never "not 5xx".
4. Never disable a failing scheduled gate to get green (Standing Law 2); fix it,
   or mark it `liveness-exempt: <reason>` with a linked issue.
5. Keep this map and the [`ARCHITECTURE.md`](../ARCHITECTURE.md) CI/CD summary in
   step with the workflow files.
