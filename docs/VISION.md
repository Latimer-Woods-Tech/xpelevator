# XPElevator — Vision

> One page. Changes rarely. Founder-voice: build loops may propose edits via PR
> but never merge thesis changes silently. Monetization + channel strategy below
> are founder decisions recorded on issue #16 (2026-07-05 / 2026-07-08).

## Who it's for

The buyer is the **operator** — a training consultancy, agency, or L&D /
enablement shop that owns end-client relationships and needs conversation
practice as sellable inventory. Operators buy seats wholesale and resell at their
own retail. The **end users** are the operators' trainees: front-line staff
(support desks, sales, account management) who practice customer conversations.
We build for the operator; the trainee surfaces exist to make the operator look
good, not to acquire retail customers directly.

## The problem

Customer-facing staff get thrown into real calls and chats with little safe
practice. Role-play with a manager doesn't scale, isn't consistent, and can't be
scored objectively. Training shops can teach the theory but have no repeatable,
measurable way to let a trainee *do the reps* against a difficult customer and
get a defensible score — so training stays subjective and hard to prove ROI on.

## What winning looks like

Operators run their whole book of trainees through XPElevator, buying seats per
active trainee/month, in cumulative modality tiers (**chat → +voice → +phone**).
Managers trust the /10 scores enough to base coaching and progression on them.
Concretely, over ~18 months: multiple paying operators, seats renewing month over
month, median ≥2 sessions/trainee/week, and score-backed reports operators show
their own clients. The platform collects automatically — the "vending machine":
operators self-serve, sell downstream, money settles via Stripe Connect.

## Monetization thesis

**B2B seat-based subscription**, per active trainee/month, on the shared LWT
Stripe platform account. Three cumulative seat tiers map to practice modalities
(chat / +voice / +phone) and are bound by stable Stripe price `lookup_key` so
wholesale amounts stay a founder input, never hard-coded. Operators buy
wholesale and set their own retail; metering + invoicing/rev-share run through
Stripe Connect. Live-mode billing is a 🔒 founder gate.

## Non-goals

- **No retail/consumer self-serve.** We sell to operators, not individuals — the
  operator owns the end-client relationship.
- **No end-customer marketing site.** Only an operator-facing demo / wholesale
  pricing surface.
- **No multiplayer / cohort role-play, adaptive difficulty, or team analytics
  until paying tenants exist** — parked, not rejected.
- **No deep telephony-vendor coupling.** Telnyx today, Bandwidth planned;
  everything stays behind a provider seam.
- **Never the word "AI" in user-facing copy** (org rule §16) — the product speaks
  in craft vocabulary: *simulated customers*, *performance scoring*.

## Kill-signals

- No test→paid org within **60 days** of billing going live.
- Median **< 2 sessions/trainee** after week 1.
- Managers don't trust the /10 scores (they override or ignore them).
- The voice-realism gap collapses the differentiator.
- CAC **> ~12 months** of seat revenue.

## Portfolio position

A standalone LWT product app (own repo, own Neon DB, own Cloudflare Pages
project). It consumes the shared **`@latimer-woods-tech/operator`** horizontal
(identity, hierarchy, white-label, vend receiver, entitlements) rather than
hand-rolling billing or a client hierarchy — one vending machine, many products.
It must not cannibalize the other apps; it distributes through the operator
channel, not the consumer community layer.
