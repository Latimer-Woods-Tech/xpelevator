# ADR-0001 — Redeploy the simulator into the LWT Cloudflare account as a new Pages project

- **Status:** Accepted
- **Date:** 2026-07-05
- **Deciders:** Founder (issue #16 Phase 0/1) + build loop
- **Context issue:** Latimer-Woods-Tech/xpelevator#16

## Context

The live `xpelevator.com` was serving an old build hosted on a Cloudflare Pages
project (`xpelevator.pages.dev`) that lives in a **different, founder-owned
Cloudflare account** — outside the LWT account the Factory platform operates in.
The DNS zone for `xpelevator.com`, however, *is* in the LWT account
(`a1c8a33cbe8a3c9e260480433a0dbb06`).

We needed the canonical simulator (branch `copilot/review-codebase-security`) to
run on infrastructure the platform can build, deploy, secret-manage, and monitor
autonomously. Two options:

1. **Adopt the external account** — obtain credentials/transfer for the
   founder-owned account and keep deploying the existing `xpelevator.pages.dev`
   project there.
2. **Redeploy fresh into the LWT account** — stand up a new Pages project in the
   LWT account, deploy the canonical build there, and repoint the (LWT-owned)
   `xpelevator.com` CNAME to it.

## Decision

Take option 2. Deploy a **new Pages project `xpelevator-sim` in the LWT
Cloudflare account** (`CF_API_TOKEN` / `CF_ACCOUNT_ID` staged as repo secrets),
verify on `xpelevator-sim.pages.dev`, then flip the LWT-owned `xpelevator.com`
CNAME onto it. The old founder-account project is left **dark and untouched**.

Deletion of the old project is explicitly **not** part of this decision — it is
a 🔒 destructive action in a founder-owned account and stays founder-gated.

## Consequences

- **Positive:** the platform owns the whole deploy/secret/monitor loop for the
  live app; no cross-account credential dependency; zero-downtime cutover because
  the DNS zone was already LWT-owned.
- **Positive:** clean separation lets `deploy.yml` self-verify (`/api/health`
  200 + live Groq credential + post-deploy security gates) without touching DNS,
  so auto-deploy on merge is safe.
- **Negative / debt:** a stale duplicate project remains in the founder account
  until a founder-gated cleanup; app secrets currently live as CF Pages secrets
  rather than the org GCP SM/WIF pattern (tracked as R-110, Phase 1).
- The migration and verified cutover are recorded on #16 (PRs #21–#25): branded
  domain build fingerprint `3002eded03df2412` == `xpelevator-sim.pages.dev`
  (run 28740972547).

## Related

- Requirements: R-024 (secret hygiene), R-110 (secrets → GCP SM/WIF), R-100
  (health on branded domain).
- Supersedes the implicit "keep it on the external account" status quo.
