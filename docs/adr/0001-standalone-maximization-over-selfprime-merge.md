# ADR-0001: Standalone maximization over SELF:PRIME merge; resurrect PR #1

## Status
Accepted — founder decision, 2026-07-04 (recorded in control issue #12).

## Context
XPElevator's core mechanic — structured, day-numbered journeys with milestone check-offs and guidance nudges — overlaps with the journeys surface already shipped in SELF:PRIME. Two paths were on the table: (a) fold xpelevator's scope into SELF:PRIME and retire the repo, or (b) build xpelevator as a standalone product on its own brand and domain. Separately, ~1,800 lines of real product code (routes, queries, migration, tests) have sat in PR #1 (`plan/v1-world-class`) since 2026-04-27, rotting against the dead `@adrper79-dot` npm scope, while main stayed a 180-LOC scaffold whose CI was never green until Phase 0 (PR #13, 2026-07-04).

## Decision
1. **Maximize XPElevator standalone.** The overlap with SELF:PRIME is known and accepted; do NOT fold in. Different ICP (general life/work leveling vs. practitioner-routed energetics), different brand promise, different funnel. Shared assets are infrastructure only (`@latimer-woods-tech/*` packages, the shared Stripe platform account, Factory supervision).
2. **Resurrect PR #1 rather than rewrite.** Re-apply its ~1,800 lines onto the now-green main, rename the scope to `@latimer-woods-tech/*`, resolve conflicts against the updated schema/deps, and replace its mocked-everything test suite with integration-shaped tests. The code is the fastest credible path to a deployed product; only its packaging is dead.
3. **First-party journeys before any marketplace.** The 12-slice instructor marketplace is parked (R-050), not dead; rejected as the first move (R-900).

## Consequences
- Two LWT apps ship a journeys mechanic; the portfolio accepts the duplication in exchange for a second independent shot at the progression thesis. Guardrail: xpelevator must not cannibalize SELF:PRIME's practitioner funnel.
- The build loop (issue #12, Phases 1–6) executes against this decision; changing it requires a founder-voiced PR to VISION.md, never a silent loop merge.
- Resurrecting PR #1 imports its known defects deliberately (webhook silent-drop, fabricated milestones, mock-only tests) — each is tracked as an explicit requirement row (R-010, R-015, R-101/R-902) instead of pretending a rewrite would avoid them.
- Kill-signals in VISION.md bound the standalone bet; if activation/conversion floors fail, merging into SELF:PRIME returns to the table.
