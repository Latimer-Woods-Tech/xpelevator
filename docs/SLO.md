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
> **Verified:** 2026-07-30, against `.github/workflows/uptime-monitor.yml` at `main`
> `b9553fb1`. Re-verify (and bump this stamp) whenever the monitor's probes, cadence,
> or thresholds change, or when the #154 observability stack lands and real latency
> SLIs become measurable.

## Scope

XPElevator is a virtual-customer training simulator. The user-facing product is a
single Cloudflare Pages (OpenNext) deployment serving `xpelevator.com`, backed by
Neon Postgres (`aged-butterfly-52244878`), Groq (scoring + simulated-customer
replies), and Telnyx (phone modality). "The service is up" means a trainee can sign
in, hold a simulated conversation, and receive a **non-null score** — so the SLOs
below cover four capabilities, not just "the homepage returns 200":

1. **Web/API availability** — the app answers requests.
2. **Scoring credential health** — the Groq key authenticates (an expired key nulls
   every score while `/api/health` stays 200 — this is live-issue #1, the reason the
   product shipped with a silently-dead core loop).
3. **Database reachability** — DB-backed reads succeed (a driver regression 500s
   every read while `/api/health`, which touches no DB, stays 200).
4. **Core-loop correctness** — a full authenticated session actually produces a
   non-null score.

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
| 2 | **Scoring credential** | Groq `GET /v1/models` | `200` (key authenticates) | every 15 min | `scripts/uptime-check.mjs` |
| 3 | **Database reachability** | `GET /api/branding/<nonexistent-slug>` | `404` (a DB-backed read that ran) — **not** `500` | every 15 min | `scripts/uptime-check.mjs` |
| 4 | **Phone reachability + fail-closed** | unsigned `POST /api/telnyx/webhook` | `401` — **not** `404` (route dropped), `500` (import crash), or `200` (fail-**open**) | every 15 min | `scripts/uptime-check.mjs` |
| 5 | **Core-loop correctness** | full authenticated session end-to-end | a **non-null** score is written | every 6h (`17 */6 * * *`) | `scripts/phase1-canary.mjs` |

SLI 3 and 4 exist because SLI 1 is blind to them: `/api/health` only checks a var is
*present*, not that it authenticates, and it touches no DB and no phone path. Two real
silent outages motivated them — **#78 (2026-07-14)** 500'd every DB read with health
staying green, and **#125 (2026-07-19)** read the Telnyx signing key from `process.env`
(undefined in the Worker) and fail-closed every webhook, taking phone dark unmonitored.

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
- **SLI 2** — Groq `/v1/models` ≠ `200` → **scoring credential dead**; scores silently null (P2 — core loop degraded, product still serves).
- **SLI 3** — branding canary returns `500` (not `404`) → **DB read path down** (P1/P2).
- **SLI 4** — webhook probe returns `404`/`500`/`200` instead of `401` → **phone modality down or fail-open** (P2; fail-open is a security concern — see #157 webhook idempotency).
- **SLI 5** — the 6-hourly canary session does **not** produce a non-null score → **core-loop acceptance broken** (P1 — the product's whole purpose).

The **absence of an open alert issue is itself the green signal** each autonomous run
reads (the sandbox cannot reach the live domain directly). There is no paging/on-call
rotation today; escalation is the GitHub issue + this repo's watchers. A customer-
facing status page and paging integration are gaps (below).

## Incident response tiers

Aligned to the org parent standard (Factory `docs/runbooks/slo.md`, P1–P4), mapped to
the failure modes the monitor actually detects:

| Tier | Meaning | XPElevator examples | Response |
|------|---------|--------------------|----------|
| **P1** | Core product unusable | `/api/health` down (SLI 1); DB read path 500s (SLI 3, cf. #78); scoring canary null (SLI 5) | Immediate — restore or roll back the deploy; the DNS rollback snapshot from the Phase-1(e) cutover is the last resort. |
| **P2** | Core loop degraded, app still serves | Groq credential dead → scores null (SLI 2, cf. live-issue #1); phone dark (SLI 4, cf. #125) | Same-day — rotate the credential / fix the fail-closed path; the modality's users are blocked but sign-in + other modalities work. |
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
