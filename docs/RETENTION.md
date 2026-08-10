# Data Retention & DSR Policy — XPElevator

> ⚠️ **STATUS: DRAFT PROPOSAL — pending founder ratification. NOT in force.**
>
> This document *proposes* a retention schedule and a data-subject-request (DSR)
> process for founder review. **It enforces nothing.** No pruning job is wired,
> no duration below is applied by code, and today transcripts, scores, and user
> rows are still **retained indefinitely** (see `docs/PII_INVENTORY.md`). Setting
> the actual retention periods and the DSR-deletion SLA is a **founder business /
> legal policy decision** — the autonomous loop drafts the artifact for review;
> it does not ratify or enforce it. Every duration below is marked *(proposed)*.
>
> Conformance: `PLATFORM_STANDARDS §10` (data handling). Closes the artifact half
> of the `RETENTION.md` gate tracked in issue
> [#157](https://github.com/Latimer-Woods-Tech/xpelevator/issues/157) §10 →
> "retention periods … documented as the gated follow-on". Ratification + the
> enforcement job stay open until a founder signs off (see the checklist at the
> bottom).
>
> **Grounded against:** `prisma/schema.prisma` and `docs/PII_INVENTORY.md` at
> `main` on 2026-08-09. Re-verify whenever a migration adds/removes a
> personal-data-bearing column.

## Why this exists

XPElevator is a virtual-customer training simulator. Trainees run simulated
customer conversations (chat, browser voice, real phone) and are scored against
weighted per-role criteria. The personal data we therefore hold is **who the
trainee is** (identity) and **what the trainee did** (conversation transcripts +
performance scores) — see `docs/PII_INVENTORY.md` for the full inventory,
grounded in the schema.

Two §10 obligations rest on this file: a defensible **retention schedule** (we
should not keep sensitive free-text transcripts forever by default) and a
**DSR process** (a trainee's right to get a copy of, or erase, their own record).
The *access* half of DSR already ships (`GET /api/me/export`, R-081); this
document proposes the retention periods and the *deletion* process that remain
founder-gated.

## Controller / processor posture (why some DSRs route through the operator)

XPElevator is channel-first (issue [#16](https://github.com/Latimer-Woods-Tech/xpelevator/issues/16)
Phase 4): the **operator** (a training consultancy / L&D shop) owns the
end-client relationship and authors the scenarios their trainees run. For a
trainee's conversation data, the operator's client org is normally the **data
controller** and the platform is a **processor** acting on its instruction. That
matters for DSRs:

- A **trainee** can always self-serve their **own** access/export today
  (`GET /api/me/export`) — no policy decision needed, so it already ships.
- A **deletion / erasure** request may need to route through, or be authorized
  by, the controlling operator org (e.g. a client asking to purge a departed
  trainee's records) rather than being unilaterally self-served — because
  erasing a trainee's session history also erases the operator's training record
  of that seat. The exact routing (self-service vs operator-mediated) and the SLA
  are part of what the founder ratifies below.

## Proposed retention schedule *(all durations PROPOSED — not enforced)*

Retention is measured from **session completion** (`simulation_sessions.ended_at`)
for activity data, and from **last activity** for identity data. Aggregate,
de-identified analytics (counts, pooled averages) are **not** personal data and
are out of scope for purging.

| Data class | Table · column(s) | Sensitivity | Proposed retention | Rationale |
|---|---|---|---|---|
| **Conversation transcripts** | `chat_messages.content` | 🔴 Sensitive free-text (the trainee's own words + the simulated customer's replies) | **24 months** after session completion *(proposed)* | The most sensitive class — arbitrary free text. Coaching/review value decays; a 2-year window covers annual performance cycles without keeping raw transcripts indefinitely. Strong candidate for the **shortest** window. |
| **Performance scores & feedback** | `scores.score`, `scores.feedback` | 🟠 Performance data (tied to an identifiable trainee via the session) | **24 months** after session completion *(proposed)* | Kept in step with the transcript that produced them. De-identified/pooled score aggregates for manager analytics may persist beyond this (they are not personal data). |
| **Session records & telemetry** | `simulation_sessions` (+ `chat_messages` per-turn latency/token telemetry) | 🟡 Links a person to activity | **24 months** after completion *(proposed)* | Purged together with the transcript/scores they carry, so no orphan linkage rows survive the sensitive data. |
| **Trainee identity** | `users.email`, `users.name` | 🟠 Direct identifier | Retain while the seat is **active**; purge **24 months** after last activity for a trainee with no active org membership *(proposed)* | Identity must persist while the account is in use. An inactive, unaffiliated trainee row is a standing liability with no purpose. Operator-initiated seat removal is a separate, immediate path. |
| **Governance audit trail** | `audit_log` (incl. `actor_email` snapshot) | 🟠 Accountability record with a direct identifier | **Longer — 7 years** *(proposed; founder to confirm)* | Accountability logs are normally retained **longer** than operational data and deliberately **outlive** the org/user they describe (the table is FK-free + append-only by design, R-078). A shorter window than operational data would defeat its purpose; the founder confirms the exact figure against any applicable regime. |
| **Operator / org business data** | `organizations` (`name`, `slug`, branding) | ⚪ Business data, **not** personal | Tenant lifetime *(no personal-data purge)* | Listed for boundary clarity only — deleted through tenant offboarding, not a DSR/retention job. |

> **Not stored, so nothing to retain:** passwords/credential secrets (no password
> column), and durable phone numbers (transient in Telnyx call setup only) — per
> `docs/PII_INVENTORY.md`. If a future slice persists either, it must be added to
> both that inventory and this schedule.

## Proposed DSR process & SLA *(proposed — SLA figures founder-gated)*

| Right | Status | Mechanism | Proposed SLA |
|---|---|---|---|
| **Access / portability** | ✅ **Live** (R-081) | Self-service `GET /api/me/export` — an authenticated trainee downloads a JSON copy of their own identity, own org context, and every session (transcript, telemetry, weighted scores), strictly self-scoped; hidden scenario mechanics are never included | **Immediate** (self-service) |
| **Rectification** | Partial | Identity (`name`) flows from the GitHub OAuth profile; correcting it there re-syncs on next sign-in. A dedicated edit surface is future work | — |
| **Erasure / deletion** | ⛔ **Gated** — not built | *Proposed:* an authenticated self-service erase of the caller's own trainee record (sessions + transcripts + scores + user row), **or** an operator-mediated purge of a client trainee, with the deletion recorded in the append-only `audit_log` (the audit row survives by design). Requires a policy decision on routing + SLA before it is built | *Proposed:* acknowledge ≤ **72 h**, complete ≤ **30 days** |

Notes on the deletion design (proposed, for review — **not implemented**):

- **Scope.** Erasure removes the caller's `chat_messages`, `scores`,
  `simulation_sessions`, and — where the trainee has no remaining active org
  membership — their `users` row. The `audit_log` accountability record of the
  deletion itself is **retained** (FK-free + append-only, R-078).
- **Tenancy.** Self-service erasure is strictly self-scoped (the caller's own
  `user_id`), exactly like the export path — no id accepted from the request, so
  no cross-tenant deletion surface.
- **Irreversibility.** Deletion is destructive and therefore a 🔒 founder gate
  under the #16 standing rules; it will not be shipped autonomously ahead of
  ratification, and its first live exercise runs against the production Neon DB
  (`aged-butterfly-52244878`) with a backup-first discipline (`§6`).

## What the founder ratifies (the gate)

This document is a proposal. To move #157 §10 forward, a founder decides:

- [ ] 🔒 **Retention periods** — confirm or adjust each *(proposed)* duration in
  the schedule above (transcripts, scores, sessions, inactive identity, audit
  log). These become the enforced numbers.
- [ ] 🔒 **DSR-deletion routing** — self-service (trainee erases own record) vs
  operator-mediated (client authorizes a purge), given the processor/controller
  posture above.
- [ ] 🔒 **DSR-deletion SLA** — confirm or adjust the proposed *acknowledge ≤ 72 h /
  complete ≤ 30 days*.
- [ ] 🔒 **Operator-configurability** — whether operators may set a **shorter**
  retention than the platform default for their own client orgs (they cannot set
  a longer one than policy/law allows).

## Implementation work unblocked once ratified (not before)

Tracked so the path is visible, not silently missing:

- [ ] **Retention/pruning job** — a scheduled purge (GitHub Actions cron, mirroring
  `uptime-monitor.yml`, against the Neon DB) that deletes activity data past the
  ratified window, with **proof-of-rejection** (a row inside the window is never
  purged; a row past it is) per Standing Law 1, and a backup-first migration
  discipline (`docs/PLATFORM_STANDARDS §6`).
- [ ] **`DELETE /api/me` (erasure)** — the self-service deletion endpoint, or its
  operator-mediated equivalent, with the same self-scoping discipline as
  `GET /api/me/export`, an `audit_log` erasure record, and an anon-401 deploy gate.
- [ ] **Retention surfaced to trainees** — a short retention statement on the
  operator/consumer surface once the numbers are ratified.

## References

- `docs/PII_INVENTORY.md` — the inventory this policy governs (data classes,
  processors, current DSR state).
- Issue [#157](https://github.com/Latimer-Woods-Tech/xpelevator/issues/157) §10 —
  the residuals list this closes the artifact half of.
- `docs/REQUIREMENTS.md` — R-081 (DSR access/export, live), R-082 (this
  retention + DSR-deletion policy, roadmap).
- `PLATFORM_STANDARDS §10` (data handling) · `§6` (schema/migration discipline).
