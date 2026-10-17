# Service-Level Objectives — XPElevator

> Conformance: `PLATFORM_STANDARDS §4` (observability) + `§9` (reliability). Tracks
> issue [#154](https://github.com/Latimer-Woods-Tech/xpelevator/issues/154) ("`docs/SLO.md`
> (§4/§9) — p95 budgets, alert thresholds") and the #16 Phase-3 line. Adopts the
> org parent standard (Factory `docs/runbooks/slo.md`: 99.9% availability, error
> budget, P1–P4 tiers) for this app.
>
> This file documents the objectives and the signals that measure them **today**,
> grounded in `.github/workflows/uptime-monitor.yml`. It is deliberately honest
> about what is *not yet* measured: real request-level p95 latency SLIs need the
> observability stack (Sentry + PostHog, issue #154) that is still founder-gated —
> those rows are marked **target (not yet measured)**, not claimed as live.
>
> **Verified:** 2026-10-17, against `.github/workflows/uptime-monitor.yml` +
> `scripts/uptime-check.mjs` + `scripts/lib/stream-probe-eval.mjs` at `main`
> `22594c48`. Re-verify (and bump this stamp) whenever the monitor's probes, cadence,
> or thresholds change, or when the #154 observability stack lands and real latency
> SLIs become measurable. Since the previous stamp (`b9553fb1`, 2026-07-30) the
> monitor gained two live core-loop signals this file now documents: the scoring-
> credential probe also asserts the **required model ids are still listed** (the
> #248 decommission guard), and a new **live realism streaming-completion** SLI
> (SLI 6) hard-fails on a sustained empty/failed `/chat/completions` stream — with a
> bounded empty-200 retry (#304/#315/#316) that mirrors production so a single
> transient Groq flap no longer pages.

## Scope

XPElevator is a virtual-customer training simulator. The user-facing product is a
single Cloudflare Pages (OpenNext) deployment serving `xpelevator.com`, backed by
Neon Postgres (`aged-butterfly-52244878`), Groq (scoring + simulated-customer
replies), and Telnyx (phone modality). "The service is up" means a trainee can sign
in, hold a simulated conversation, and receive a **non-null score** — so the SLOs
below cover four capabilities, not just "the homepage returns 200":

1. **Web/API availability** — the app answers requests.
2. **Scoring/generation credential + model health** — the Groq key authenticates
   **and** the exact model ids the app calls are still offered (an expired key, or a
   model decommissioned out from under the app, nulls every score while `/api/health`
   stays 200 — this is live-issue #1 and the #248 decommission, the reasons the
   product shipped — and later regressed — with a silently-dead core loop).
3. **Database reachability** — DB-backed reads succeed (a driver regression 500s
   every read while `/api/health`, which touches no DB, stays 200).
4. **Core-loop correctness** — a full authenticated session actually produces a
   non-null score. Two signals cover this at different cost/cadence: a cheap live
   **realism streaming-completion** probe every 15 min (the scoring + fallback-floor
   model actually answers) and the heavy end-to-end **scoring canary** every 6 h.

## Availability objective

| | Target | Error budget (allowed downtime) |
|---|---|---|
| **Availability** | **99.9%** (org standard) | **~43 min / 30-day month**, ~10.1 min / week, ~1.44 min / day |

"Available" = the availability SLI below is green. The budget is the amount of
red-SLI time tolerated before the error-budget policy (bottom of this file) applies.

> **Measurement granularity caveat.** The availability signal is a synthetic probe
> on a **15-minute** cadence, so a blip shorter than one probe interval can pass
> unrecorded, and detection latency for a hard outage is up to 15 min. This is a
> real precision limit of black-box probing; per-request availability from
> first-party telemetry is gated on #154.

## Service-level indicators (measured today)

All SLIs run **runner-side** in `.github/workflows/uptime-monitor.yml` — sandbox and
prod egress to the branded domain is org-policy-blocked, so GitHub Actions is the
authoritative live signal. Every SLI is probed on **both** `xpelevator.com` and the
`xpelevator-sim.pages.dev` alias.

| # | SLI | Probe | Green when | Cadence | Source |
|---|-----|-------|-----------|---------|--------|
| 1 | **Web/API availability** | `GET /api/health` | `200` on both hosts | every 15 min | `scripts/uptime-check.mjs` |
| 2 | **Scoring/generation credential + model health** | Groq `GET /v1/models` | `200` (key authenticates) **and** both required model ids (`openai/gpt-oss-120b`, `openai/gpt-oss-20b`) are present in the list | every 15 min | `scripts/uptime-check.mjs` |
| 3 | **Database reachability** | `GET /api/branding/<nonexistent-slug>` | `404` (a DB-backed read that ran) — **not** `500` | every 15 min | `scripts/uptime-check.mjs` |
| 4 | **Phone reachability + fail-closed** | unsigned `POST /api/telnyx/webhook` | `401` — **not** `404` (route dropped), `500` (import crash), or `200` (fail-**open**) | every 15 min | `scripts/uptime-check.mjs` |
| 5 | **Core-loop correctness (end-to-end)** | full authenticated session end-to-end | a **non-null** score is written **and** the session recorded per-turn Groq token usage (R-132 / #155) | every 6h (`17 */6 * * *`) | `scripts/phase1-canary.mjs` |
| 6 | **Live realism generation** | Groq streaming `POST /v1/chat/completions` on the realism model `openai/gpt-oss-120b` (mirrors `src/lib/ai.ts` `streamResponse`) | HTTP `200` **with non-empty streamed content** — a bounded empty-200 reopen (`MAX_REALISM_STREAM_ATTEMPTS = 2`) absorbs a single transient flap; a sustained empty stream or a non-200 (auth/org-block/5xx/transport) is **down** | every 15 min | `scripts/uptime-check.mjs` → `checkGroqCompletion` + `scripts/lib/stream-probe-eval.mjs` |

SLI 3, 4, and 6 exist because SLI 1 (and even SLI 2) is blind to them: `/api/health`
only checks a var is *present*, not that it authenticates, and it touches no DB and no
phone path; and a Groq key can authenticate (SLI 2 green) while the model it names is
decommissioned or the live `/chat/completions` stream returns nothing. Four real silent
outages motivated these — **#78 (2026-07-14)** 500'd every DB read with health staying
green; **#125 (2026-07-19)** read the Telnyx signing key from `process.env` (undefined
in the Worker) and fail-closed every webhook, taking phone dark unmonitored; **#248
(2026-08-17)** decommissioned the then-current scoring models while the key stayed valid
(now caught by SLI 2's model-id assertion); and **#296/#304/#315** exposed the realism
`/chat/completions` stream returning HTTP 200 with zero content, which SLI 6 catches.

> **SLI 6 — two warn-level (non-failing) sub-signals.** Besides the hard-fail above,
> `checkGroqCompletion` emits warnings that do **not** redden the monitor: (a) the
> realism stream returned content but carried **no token-usage block** at top-level
> `usage` or `x_groq.usage` (R-132 / #155 — per-turn spend can't be recorded); and
> (b) the **fast tier** `openai/gpt-oss-20b` is blocked/empty while realism answers —
> the app's model-fallback ladder (#301) degrades those turns up to realism, so it is
> a **cost-tier** regression (the pricier model serves every easy/medium turn), not an
> outage. Both are left non-failing deliberately, so the monitor never sits
> permanently red (the alert-fatigue mode that masks the next real failure).

## Latency objectives — **target (not yet measured)**

There is no first-party request-timing instrumentation yet (that is the core of
#154). The budgets below are **targets to hold the observability work to**, not
current measurements — do not report them as SLO attainment until #154 lands and a
real p95 SLI backs each row.

| Surface | p95 target | Notes |
|---------|-----------|-------|
| `GET /api/health` and other static/edge reads | < 300 ms | Edge-served; no DB. |
| DB-backed API reads (`/api/scenarios`, `/api/branding/*`, `/api/reports/*`) | < 800 ms | Neon via Hyperdrive; dominated by query + connection. |
| `POST /api/chat` — **time to first SSE token** | < 2.5 s | Groq-bound; measure TTFB of the stream, not full completion. |
| Session scoring finalization | < 8 s | Groq scoring call over the transcript; grows with turns (O(turns²) token growth is tracked in #155). |

> When #154 ships, wire these as real SLIs (Sentry performance / PostHog timing +
> a `request_id` on every log line, per R-111/R-112) and re-verify this section.

## Alerting

Any failed probe opens **or comments on a single GitHub alert issue** via
`scripts/monitor-alert.cjs` — a red run in the Actions tab becomes an actual
notification (dedup'd to one open issue, not one-per-run). Concretely, an alert
fires when:

- **SLI 1** — `/api/health` ≠ `200` on either host → **web/API down** (P1/P2 per blast radius).
- **SLI 2** — Groq `/v1/models` ≠ `200` → **scoring credential dead** (P2); **or** the credential is live but a required model id is **missing from the list** → **scoring model decommissioned** (P2, the #248 mode); scores silently null either way (core loop degraded, product still serves).
- **SLI 3** — branding canary returns `500` (not `404`) → **DB read path down** (P1/P2).
- **SLI 4** — webhook probe returns `404`/`500`/`200` instead of `401` → **phone modality down or fail-open** (P2; fail-open is a security concern — see #157 webhook idempotency).
- **SLI 5** — the 6-hourly canary session does **not** produce a non-null score (or records no per-turn token usage, R-132 / #155) → **core-loop acceptance broken** (P1 — the product's whole purpose).
- **SLI 6** — the realism `/chat/completions` stream is empty or non-200 across both bounded attempts → **live customer-turn generation down** (P1 — every live turn serves the canned fallback and sessions can no longer degrade to a working model). A single transient empty-200 that recovers on reopen does **not** alert (mirrors production's retry). The two warn-level sub-signals (missing token-usage, fast-tier blocked) surface in the run log but open **no** alert issue.

The **absence of an open alert issue is itself the green signal** each autonomous run
reads (the sandbox cannot reach the live domain directly). There is no paging/on-call
rotation today; escalation is the GitHub issue + this repo's watchers. A customer-
facing status page and paging integration are gaps (below).

## Incident response tiers

Aligned to the org parent standard (Factory `docs/runbooks/slo.md`, P1–P4), mapped to
the failure modes the monitor actually detects:

| Tier | Meaning | XPElevator examples | Response |
|------|---------|--------------------|----------|
| **P1** | Core product unusable | `/api/health` down (SLI 1); DB read path 500s (SLI 3, cf. #78); scoring canary null (SLI 5); realism generation stream down (SLI 6, cf. #304/#315) | Immediate — restore or roll back the deploy; the DNS rollback snapshot from the Phase-1(e) cutover is the last resort. |
| **P2** | Core loop degraded, app still serves | Groq credential dead or required model decommissioned → scores null (SLI 2, cf. live-issue #1 / #248); phone dark (SLI 4, cf. #125) | Same-day — rotate the credential / update the model ids / fix the fail-closed path; the modality's users are blocked but sign-in + other modalities work. |
| **P3** | Elevated latency / partial | p95 latency breach (once #154 makes it measurable); intermittent probe flaps | Next business day — investigate, spend from error budget knowingly. |
| **P4** | Cosmetic / no user impact | Alert-issue noise; monitor false positive | Best-effort — tune the probe. |

## Error-budget policy

- The 99.9% budget (~43 min/month) is spent by any red availability-SLI window.
- While budget remains: ship normally under the standing rules (one verified slice
  per run, curl-with-your-own-eyes).
- If the month's budget is exhausted: reliability work (close the alerting/latency
  gaps below, harden the failing path) takes priority over new features until the
  budget recovers — the same posture the org standard prescribes.
- Every P1/P2 gets a one-paragraph post-incident note appended to
  `docs/LESSONS_LEARNED.md` (as #78 and #125 already are), so the SLI set keeps
  growing to cover each new silent-failure class.

## Gaps / follow-on (tracked — some founder-gated)

Documented so they are visible, not silently missing:

- [ ] **Real p95 latency SLIs** — blocked on #154 observability (Sentry DSN + PostHog
  key are founder-gated; secret-provisioning commands are in #154). Until then the
  latency table above is a target, not a measurement.
- [ ] **`request_id` / correlation IDs on every log line** — R-111/R-112, part of #154.
- [ ] **Paging / on-call + a customer-facing status page** — needed before a
  customer-facing **SLA with credits**, which is a **founder/business policy
  decision** (out of scope for the autonomous loop, same as retention periods in
  `docs/PII_INVENTORY.md`). This doc sets *internal* objectives only.
- [ ] **Sub-15-minute availability resolution** — needs first-party per-request
  availability (also #154); the current floor is the 15-min probe cadence.

See issue [#154](https://github.com/Latimer-Woods-Tech/xpelevator/issues/154) for the
observability work these SLIs will eventually rest on, and
`.github/workflows/uptime-monitor.yml` for the live probe definitions.
