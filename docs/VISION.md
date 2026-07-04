# XPElevator — Vision

> One page. Changes rarely. Founder-voice: build loops may propose edits via PR but never merge thesis changes silently.

## Who it's for
People who want to level up a specific area of life or work — mindset, career, fitness, finance, relationships — and who stall without structure. They don't want another content library; they want a day-numbered path with a clear "do this today" and visible progress.

## The problem
Self-improvement intent dies from formlessness. Courses are passive, habit apps are generic, and coaching is expensive. Nobody tells the motivated-but-unstructured person exactly what Day 7 of "rebuild your finances" looks like, checks it off with them, and nudges them to Day 8. The gap is guided progression: authored day-by-day journeys with per-day milestones and personalized next-step guidance.

## What winning looks like
Within 18 months: a seeded catalog of high-quality journeys across the 5 categories, a self-serve funnel (visit → signup → enroll → daily check-off) running on xpelevator.com, and a paying subscriber base whose retention is driven by in-journey streaks. Concretely: hundreds of activated users (enrolled + ≥3 milestone completions), double-digit paid conversion of activated users, MRR from starter/pro/elite tiers that covers infra several times over and trends up month over month.

## Monetization thesis
B2C subscription on the shared LWT Stripe platform account (`acct_1SlCcFAW1229TZte`), test-mode first, live-mode behind a founder gate. Free tier = 1 active journey (acquisition + activation). Paid tiers (starter/pro/elite) unlock concurrent journeys and personalized guidance nudges. People pay for the guided-progression experience — the authored path plus the "what's my next step" intelligence — and keep paying because abandoning mid-journey means losing the structure that was working.

## Non-goals
- **The 12-slice instructor marketplace as the FIRST move.** A two-sided marketplace at zero users is a cold-start trap (no instructors without learners, no learners without catalog). Parked, not dead — revisit only after first-party journeys prove activation and payment. Guardrail row: R-900 in REQUIREMENTS.md.
- **Becoming a generic habit tracker.** Journeys are authored, finite, day-numbered paths — not open-ended streak counters. The authored path is the product.
- **Community/social features pre-revenue.** No forums, no leaderboards until the core loop retains.

## Kill-signals
- <10% of seeded-catalog visitors who sign up ever complete 3 milestones (activation floor) after 90 days of the catalog being live on the branded domain.
- <2% of activated users convert to any paid tier within 60 days of test→live Stripe flip.
- Journey completion rate <5% across the catalog after content iteration — the guided-progression thesis itself failing.
- Six months post-launch with MRR below infra cost (Neon + Workers + LLM spend) — the portfolio slot is better spent elsewhere.

## Portfolio position
Standalone maximization — founder decision 2026-07-04 ([ADR-0001](./adr/0001-standalone-maximization-over-selfprime-merge.md)). Overlap with SELF:PRIME's journeys surface is **known and accepted**; XPElevator does NOT fold into SELF:PRIME and must not wait on it. It shares LWT infrastructure only: `@latimer-woods-tech/*` packages, the shared Stripe platform account, the Factory supervisor loop, and (currently) a Neon endpoint with xico-city. It feeds the portfolio a second proof of the journeys/progression mechanic under a different brand and ICP; it must never cannibalize SELF:PRIME's practitioner-routing funnel (different buyer, different promise).
