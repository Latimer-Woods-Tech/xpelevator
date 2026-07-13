/**
 * Starter scenario-library packs — the day-one sellable inventory an operator
 * needs (issue #16, Phase 4: "Starter scenario-library packs — operators need
 * sellable inventory on day one, per-vertical packs are their SKUs").
 *
 * The buyer we build for is the **operator** (training consultancies, agencies,
 * enablement / L&D shops). An operator who signs up with an empty workspace has
 * nothing to sell; these curated per-vertical packs give them ready-made
 * inventory to stand up training on day one. Each pack is a per-vertical SKU: a
 * role (job title) plus a spread of scenarios across difficulty and modality.
 *
 * This module is deliberately **pure data + pure helpers** — no DB, no Stripe,
 * no secrets, no network, no Node built-ins. It is Worker-safe (OpenNext) and
 * mirrors the shape of `src/lib/plans.ts`. It is the single source of truth
 * that the public catalog surface (`GET /api/scenario-packs`, the `/library`
 * page) reads, and — in a later slice — the admin "import this pack into my
 * org" action will materialise into `scenarios` + `job_titles` rows.
 *
 * ── Hidden-mechanic boundary (Phase 2 security rule, R-021) ──────────────────
 * A scenario's `script` carries the **hidden mechanics** — the customer's
 * persona, their concealed objective, and context hints — that trainees must
 * never see (it is the core product mechanic). The public catalog helper
 * {@link getPublicPackCatalog} therefore returns a scenario **summary only**
 * (name, difficulty, modality, a non-revealing one-liner) and NEVER the
 * `script`. The full pack (with `script`) stays server-side and only becomes an
 * org-scoped `scenarios` row on an authenticated admin import.
 */

/**
 * Practice modality a trainee runs. Mirrors the Prisma `SimulationType` enum
 * (`prisma/schema.prisma`) and the same union in `src/lib/plans.ts` — kept
 * local so this pure module never imports the generated Prisma client. A unit
 * test asserts every pack scenario uses one of exactly these three.
 */
export type SimulationType = 'PHONE' | 'CHAT' | 'VOICE';

/**
 * A scenario's difficulty tier. Mirrors `ScenarioScript['difficulty']`
 * (`src/types/index.ts`) so an imported pack scenario is a valid script.
 */
export type ScenarioDifficulty = 'easy' | 'medium' | 'hard';

/**
 * The hidden mechanics of a scenario — the persona the simulated customer
 * plays, their concealed objective, and optional context hints. Shape-compatible
 * with `ScenarioScript` (`src/types/index.ts`) so a pack scenario materialises
 * directly into a `scenarios.script`. NEVER exposed by the public catalog.
 */
export interface PackScenarioScript {
  /** Who the simulated customer is (personality, situation, mood cues). */
  customerPersona: string;
  /** The customer's hidden goal — what a successful trainee steers them toward. */
  customerObjective: string;
  /** How hard the customer is to handle. */
  difficulty: ScenarioDifficulty;
  /** Optional context the customer knows but won't volunteer unprompted. */
  hints?: string[];
}

/** One scenario inside a pack. */
export interface PackScenario {
  /** Stable slug, unique within its pack (SKU sub-stem, import idempotency key). */
  key: string;
  /** Trainee-facing scenario name. */
  name: string;
  /**
   * Public, non-revealing one-line summary — safe to show a prospective
   * operator BEFORE purchase. Describes the *situation*, never the customer's
   * hidden objective or the hints.
   */
  summary: string;
  /** Default practice modality for this scenario. */
  type: SimulationType;
  /** Hidden mechanics — persona / objective / hints. Never in the public catalog. */
  script: PackScenarioScript;
}

/** A per-vertical starter pack — an operator's sellable SKU. */
export interface ScenarioPack {
  /** Stable id / SKU stem / URL slug. */
  id: string;
  /** The industry / vertical this pack trains for. */
  vertical: string;
  /** Operator-facing pack name. */
  name: string;
  /** Operator-facing pitch — what an operator can resell this pack as. */
  description: string;
  /** The role trained (materialises into a `job_titles` row on import). */
  jobTitle: { name: string; description: string };
  /** The scenarios in the pack (spread across difficulty + modality). */
  scenarios: PackScenario[];
}

/**
 * Bump when the pack set / scenario shape changes so callers (catalog cache,
 * import idempotency) can detect drift. A unit test pins the current value.
 */
export const PACK_CATALOG_VERSION = 1 as const;

/**
 * The starter library. Three per-vertical packs, each a role plus four
 * scenarios spanning `easy → hard` and `CHAT / VOICE / PHONE`. Copy follows the
 * org rule — the word "AI" never appears (these strings reach operator + trainee
 * surfaces). Verticals are deliberately distinct, high-training-value SKUs.
 */
export const SCENARIO_PACKS: readonly ScenarioPack[] = [
  {
    id: 'saas-support-essentials',
    vertical: 'B2B SaaS support',
    name: 'SaaS Support Essentials',
    description:
      'A ready-to-sell pack for software support teams: billing disputes, a broken integration, an angry churn-risk account, and a routine how-to. Trains de-escalation, expectation-setting, and clean handoffs.',
    jobTitle: {
      name: 'SaaS Support Specialist',
      description:
        'Front-line support for a B2B software product — handles billing, technical, and account questions over chat and phone.',
    },
    scenarios: [
      {
        key: 'password-reset-howto',
        name: 'Locked out before a deadline',
        summary:
          'A customer cannot log in and has a report due within the hour. A calm, routine how-to under mild time pressure.',
        type: 'CHAT',
        script: {
          customerPersona:
            'Dana, a mid-level operations manager. Polite but visibly stressed — a board report is due in 50 minutes and she is locked out. Not technical; describes symptoms, not causes.',
          customerObjective:
            'Regain access to the account in time to export the report. Will feel reassured if given a clear time estimate and a fallback.',
          difficulty: 'easy',
          hints: [
            'She reset her password yesterday and may be typing the old one.',
            'She has admin rights but has never used the account-recovery flow.',
          ],
        },
      },
      {
        key: 'surprise-invoice',
        name: 'The invoice doubled this month',
        summary:
          "A customer opens firm and unhappy about an unexpected charge. Trains billing-dispute handling and expectation-setting.",
        type: 'CHAT',
        script: {
          customerPersona:
            'Marcus, a small-business owner. Direct, budget-conscious, and irritated: this month’s invoice is roughly double last month’s with no warning. Reasonable if the charge is explained clearly, sharp if stonewalled.',
          customerObjective:
            'Understand exactly why the bill rose and get it corrected or credited if it was an error. Success = a clear line-item explanation and a concrete next step.',
          difficulty: 'medium',
          hints: [
            'He added five seats mid-cycle, which triggered a proration he did not notice.',
            'He will threaten to cancel if he feels the charge is being defended before it is explained.',
          ],
        },
      },
      {
        key: 'broken-integration',
        name: 'The sync stopped overnight',
        summary:
          'A technical customer reports a data integration silently failing. Trains structured troubleshooting over a live voice channel.',
        type: 'VOICE',
        script: {
          customerPersona:
            'Priya, a technical operations lead. Precise and a little terse; she has already checked the obvious things and wants a peer, not a script. Respects competence, loses patience with canned steps.',
          customerObjective:
            'Get the integration syncing again, or a credible root-cause and ETA. Success = being treated as technical and given a real diagnostic path.',
          difficulty: 'hard',
          hints: [
            'An API token rotated on her side two days ago and was never updated in the integration.',
            'She will disengage if asked to "try turning it off and on again" before her setup is acknowledged.',
          ],
        },
      },
      {
        key: 'churn-risk-escalation',
        name: 'Cancel my account today',
        summary:
          'A long-time customer calls in ready to cancel after a bad week. Trains retention, ownership, and de-escalation on the phone.',
        type: 'PHONE',
        script: {
          customerPersona:
            'Ellen, a three-year customer and team lead. Frustrated and decided — opens by demanding to cancel. Under the anger is loyalty worn thin by a recent outage and a slow prior ticket.',
          customerObjective:
            'Feel heard and see that someone owns the problem. She will stay if given genuine acknowledgement plus one concrete commitment — not a discount thrown at her to end the call.',
          difficulty: 'hard',
          hints: [
            'A discount offered too early reads as dismissive and hardens her position.',
            'She references a support ticket that sat two days without a reply.',
          ],
        },
      },
    ],
  },
  {
    id: 'retail-frontline-care',
    vertical: 'Retail & hospitality frontline',
    name: 'Retail Frontline Care',
    description:
      'For operators training frontline retail and hospitality staff: a returns dispute, an upset guest, an upsell moment, and a policy edge case. Trains warmth under pressure and policy delivered with a human touch.',
    jobTitle: {
      name: 'Frontline Retail Associate',
      description:
        'Customer-facing retail / hospitality associate handling returns, complaints, and in-the-moment service recovery.',
    },
    scenarios: [
      {
        key: 'gift-recommendation',
        name: 'Help me pick a gift',
        summary:
          'A friendly customer wants a recommendation and is open to spending a little more. A warm, low-stakes upsell moment.',
        type: 'CHAT',
        script: {
          customerPersona:
            'Sam, cheerful and a bit indecisive, shopping for a birthday gift with a rough budget in mind. Enjoys being guided; responds well to a couple of thoughtful questions.',
          customerObjective:
            'Leave with a gift they feel good about. Happy to trade up if the reason is genuine, put off by a hard sell.',
          difficulty: 'easy',
          hints: [
            'The gift is for a sibling who likes the outdoors.',
            'A sincere "this one is a little more but here is why" lands; a scripted upsell does not.',
          ],
        },
      },
      {
        key: 'return-past-window',
        name: 'A return just past the window',
        summary:
          'A customer wants to return an item a few days outside policy. Trains delivering a firm policy with empathy and options.',
        type: 'CHAT',
        script: {
          customerPersona:
            'Rosa, reasonable but disappointed. The receipt is a few days past the return window and she feels the timing is unfair given she was travelling.',
          customerObjective:
            'Get her money back, or failing that, a fair alternative. Success = feeling respected even if the exact ask cannot be met.',
          difficulty: 'medium',
          hints: [
            'Store credit or an exchange is within the associate’s discretion; a cash refund is not.',
            'She escalates only if she feels the policy is being quoted at her without any flexibility.',
          ],
        },
      },
      {
        key: 'upset-guest-wait',
        name: 'A guest kept waiting too long',
        summary:
          'An in-person guest is visibly upset about a long wait. Trains real-time service recovery on a voice channel.',
        type: 'VOICE',
        script: {
          customerPersona:
            'Terrence, normally easygoing but now openly annoyed after a 40-minute wait he was not warned about. Wants acknowledgement more than compensation.',
          customerObjective:
            'A genuine apology and confidence it will not happen again. Warms quickly to sincere ownership; hardens if handed a scripted "sorry for the inconvenience".',
          difficulty: 'medium',
          hints: [
            'The delay was a staffing gap, not his fault — he will relax once that is owned honestly.',
            'A small gesture offered after the apology lands well; offered instead of one, it does not.',
          ],
        },
      },
      {
        key: 'loud-complaint-phone',
        name: 'A complaint that carries across the floor',
        summary:
          'A customer calls in loud and angry about a faulty product. Trains de-escalation and boundary-setting by phone.',
        type: 'PHONE',
        script: {
          customerPersona:
            'Gloria, angry and loud — a product failed the day after purchase and she feels cheated. Talks over interruptions; calms only when she believes she has been fully heard.',
          customerObjective:
            'A replacement or refund and an admission the product was faulty. Will not accept a solution offered before she has finished venting.',
          difficulty: 'hard',
          hints: [
            'Letting her finish her first full sentence before responding cuts the volume in half.',
            'She has the receipt and the faulty item — the resolution is straightforward once she is calm.',
          ],
        },
      },
    ],
  },
  {
    id: 'inbound-sales-discovery',
    vertical: 'Inbound sales & discovery',
    name: 'Inbound Sales & Discovery',
    description:
      'For operators training inbound sales and SDR teams: a warm inbound lead, a price objection, a "just send me info" brush-off, and a skeptical technical evaluator. Trains discovery, objection handling, and earning the next meeting.',
    jobTitle: {
      name: 'Inbound Sales Representative',
      description:
        'Handles inbound leads and discovery calls — qualifies, handles objections, and books the next step.',
    },
    scenarios: [
      {
        key: 'warm-inbound-lead',
        name: 'A warm lead who filled out the form',
        summary:
          'An engaged prospect who requested a call. A friendly discovery conversation to qualify and set a next step.',
        type: 'CHAT',
        script: {
          customerPersona:
            'Jordan, curious and genuinely interested — filled out the contact form after a colleague’s recommendation. Open, a little unsure exactly what they need.',
          customerObjective:
            'Figure out whether this is a fit and what the next step is. Responds well to good questions, drifts if pitched at before being understood.',
          difficulty: 'easy',
          hints: [
            'Their team of eight is outgrowing a spreadsheet-based process.',
            'A crisp recap of their need plus a proposed next step earns the meeting.',
          ],
        },
      },
      {
        key: 'price-objection',
        name: '"It’s more than we budgeted"',
        summary:
          'A qualified prospect stalls on price. Trains value framing and objection handling without discounting reflexively.',
        type: 'CHAT',
        script: {
          customerPersona:
            'Aisha, a pragmatic buyer who likes the product but flags the price as above budget. Not bluffing — she needs to justify the spend internally.',
          customerObjective:
            'Get to a number or a value story she can defend to her manager. Success = a reframe around outcomes, not a knee-jerk discount.',
          difficulty: 'medium',
          hints: [
            'The real blocker is proving ROI to her manager, not the sticker price itself.',
            'An immediate discount signals the price was soft and invites more pushback.',
          ],
        },
      },
      {
        key: 'send-me-info-brushoff',
        name: '"Just email me something"',
        summary:
          'A distracted prospect tries to end the call with a brush-off. Trains keeping a light, earned hold on the conversation.',
        type: 'VOICE',
        script: {
          customerPersona:
            'Kev, busy and half-checked-out — defaults to "just send me info" to get off the call. Not hostile, just protecting his time. Re-engages if given a reason that respects it.',
          customerObjective:
            'Escape the call quickly — unless the rep earns 60 more seconds with one sharp, relevant question. Success = a real next step, not a PDF into the void.',
          difficulty: 'hard',
          hints: [
            'One specific question about his current process cuts through the brush-off; a generic pitch does not.',
            'He will agree to a short follow-up if it is framed around his time, not the rep’s pipeline.',
          ],
        },
      },
      {
        key: 'skeptical-evaluator',
        name: 'A skeptical technical evaluator',
        summary:
          'A detail-oriented evaluator probes for weaknesses on a call. Trains honesty, precision, and handling "we already use a competitor".',
        type: 'PHONE',
        script: {
          customerPersona:
            'Dr. Okonkwo, a technical evaluator comparing options. Sharp, unhurried, and unimpressed by hype; already uses a competitor and expects the rep to know it. Rewards a straight answer, penalises a dodge.',
          customerObjective:
            'Decide whether this is worth a deeper evaluation. Success = honest, specific answers — including where the product is not the best fit — that earn a technical follow-up.',
          difficulty: 'hard',
          hints: [
            'He will test a weak point on purpose; admitting a real limitation builds more trust than deflecting.',
            'He respects a rep who knows the competitor honestly and does not trash it.',
          ],
        },
      },
    ],
  },
];

/** Look up a single pack by its stable id. Returns `undefined` if unknown. */
export function getScenarioPack(id: string): ScenarioPack | undefined {
  return SCENARIO_PACKS.find((pack) => pack.id === id);
}

// ── Import plan (admin "import pack → org") ──────────────────────────────────
//
// The admin import materialises a pack into org-scoped `job_titles` + `scenarios`
// rows. This is the pure, DB-free half — it derives the exact rows to write from
// a pack + an orgId, so the route stays a thin executor and the shaping logic is
// unit-testable without a live database. The write itself is idempotent on the
// pack/scenario `key` (see the route + `20260712120000_add_pack_provenance`),
// so re-importing a pack never duplicates and never clobbers an operator's
// later edits — the "freeze a pack for a client even if the public pack later
// improves" property the founder called for. `packVersion` is stamped on every
// row so drift from an improved public pack is detectable in a later slice.

/** The `job_titles` row an import materialises (org-scoped, pack-provenanced). */
export interface JobTitleImportRow {
  orgId: string;
  name: string;
  description: string;
  sourcePackId: string;
  packVersion: number;
}

/** A `scenarios` row an import materialises (org-scoped, pack-provenanced). */
export interface ScenarioImportRow {
  orgId: string;
  name: string;
  description: string;
  type: SimulationType;
  /** Full hidden-mechanic script — persona / objective / hints. Server-side only. */
  script: PackScenarioScript;
  sourcePackId: string;
  /** Stable per-scenario key — the idempotency key for re-import. */
  sourceScenarioKey: string;
  packVersion: number;
}

/** The complete set of rows a pack import writes into one org. */
export interface PackImportPlan {
  packId: string;
  packVersion: number;
  orgId: string;
  jobTitle: JobTitleImportRow;
  scenarios: ScenarioImportRow[];
}

/**
 * Derive the exact rows an "import this pack into my org" action must write.
 * Pure — no DB, no auth, no network. The route executes this plan with
 * `ON CONFLICT DO NOTHING` against the org-scoped provenance indexes, so the
 * result is idempotent on `(orgId, sourcePackId, sourceScenarioKey)`.
 *
 * @param pack  The starter pack to materialise.
 * @param orgId The org the rows belong to (never null — imports are tenant-scoped).
 */
export function buildPackImportPlan(pack: ScenarioPack, orgId: string): PackImportPlan {
  return {
    packId: pack.id,
    packVersion: PACK_CATALOG_VERSION,
    orgId,
    jobTitle: {
      orgId,
      name: pack.jobTitle.name,
      description: pack.jobTitle.description,
      sourcePackId: pack.id,
      packVersion: PACK_CATALOG_VERSION,
    },
    scenarios: pack.scenarios.map((s) => ({
      orgId,
      name: s.name,
      description: s.summary,
      type: s.type,
      script: s.script,
      sourcePackId: pack.id,
      sourceScenarioKey: s.key,
      packVersion: PACK_CATALOG_VERSION,
    })),
  };
}

// ── Upgrade plan (admin "upgrade a frozen pack → current catalog version") ────
//
// The deliberate, opt-in counterpart to the non-clobbering import. Import is
// frozen-by-default: re-importing never overwrites an operator's rows, so a pack
// materialised at version N stays at N even after the public catalog improves
// (the "freeze a pack for a client" property the founder called for). Upgrade is
// the escape hatch — an admin explicitly re-syncs an already-imported pack to
// the current catalog. This is the pure, DB-free half: given the current catalog
// pack + the org's stored provenanced scenario rows (their key + `pack_version`),
// it derives exactly which scenarios to UPDATE (stale — stored version older
// than the catalog), INSERT (added to the catalog since the import), leave
// UNCHANGED (already at the catalog version), or report as ORPHANED (removed
// from the catalog — reported, NEVER deleted, since the operator may still be
// running it). The route executes the plan; the shaping is unit-tested here.

/** One of the org's currently-stored, pack-provenanced scenario rows. */
export interface StoredPackScenario {
  sourceScenarioKey: string;
  /** The catalog version this row was last written at (`null` = pre-versioning). */
  packVersion: number | null;
}

/** What an upgrade will do to a single scenario. */
export type ScenarioUpgradeAction = 'update' | 'insert' | 'unchanged' | 'orphaned';

/** Per-scenario audit line for the upgrade preview. */
export interface ScenarioUpgradeItem {
  sourceScenarioKey: string;
  /** Trainee-facing name (from the catalog; the key itself for an orphaned row). */
  name: string;
  action: ScenarioUpgradeAction;
  /** The stored version (`null` for a fresh insert). */
  fromVersion: number | null;
  /** The version the row will be at after upgrade (unchanged for `unchanged`/`orphaned`). */
  toVersion: number | null;
}

/** The full set of writes + audit an upgrade performs for one org. */
export interface PackUpgradePlan {
  packId: string;
  /** The catalog version everything is being synced up to. */
  targetVersion: number;
  orgId: string;
  /** Stale rows to overwrite with the current content + bumped version. */
  toUpdate: ScenarioImportRow[];
  /** Catalog scenarios the org lacks — inserted (idempotent, same shape as import). */
  toInsert: ScenarioImportRow[];
  /** Keys already at the target version — no write. */
  unchangedKeys: string[];
  /** Stored keys no longer in the catalog — reported, never deleted. */
  orphanedKeys: string[];
  /** Full per-scenario audit, in catalog order then orphaned. */
  items: ScenarioUpgradeItem[];
}

/**
 * Derive the exact writes an "upgrade this imported pack to the current catalog
 * version" action must perform, plus a per-scenario audit for the preview. Pure
 * — no DB, no auth, no network.
 *
 * A stored scenario is **stale** (→ `update`) when its `packVersion` is `null`
 * (pre-versioning) or strictly less than {@link PACK_CATALOG_VERSION}; a stored
 * row already at or beyond the catalog version is left **unchanged** (never
 * downgraded). A catalog scenario with no stored row is an **insert**; a stored
 * row whose key has left the catalog is **orphaned** and only reported.
 *
 * @param pack   The current catalog pack to sync up to.
 * @param stored The org's currently-stored provenanced rows for this pack.
 * @param orgId  The org the rows belong to (imports/upgrades are tenant-scoped).
 */
export function buildPackUpgradePlan(
  pack: ScenarioPack,
  stored: readonly StoredPackScenario[],
  orgId: string,
): PackUpgradePlan {
  const target = PACK_CATALOG_VERSION;
  const storedByKey = new Map(stored.map((s) => [s.sourceScenarioKey, s]));
  const catalogKeys = new Set(pack.scenarios.map((s) => s.key));

  const toUpdate: ScenarioImportRow[] = [];
  const toInsert: ScenarioImportRow[] = [];
  const unchangedKeys: string[] = [];
  const items: ScenarioUpgradeItem[] = [];

  for (const s of pack.scenarios) {
    const row: ScenarioImportRow = {
      orgId,
      name: s.name,
      description: s.summary,
      type: s.type,
      script: s.script,
      sourcePackId: pack.id,
      sourceScenarioKey: s.key,
      packVersion: target,
    };
    const existing = storedByKey.get(s.key);
    if (!existing) {
      toInsert.push(row);
      items.push({ sourceScenarioKey: s.key, name: s.name, action: 'insert', fromVersion: null, toVersion: target });
    } else if (existing.packVersion == null || existing.packVersion < target) {
      toUpdate.push(row);
      items.push({ sourceScenarioKey: s.key, name: s.name, action: 'update', fromVersion: existing.packVersion, toVersion: target });
    } else {
      unchangedKeys.push(s.key);
      items.push({ sourceScenarioKey: s.key, name: s.name, action: 'unchanged', fromVersion: existing.packVersion, toVersion: existing.packVersion });
    }
  }

  const orphanedKeys: string[] = [];
  for (const s of stored) {
    if (!catalogKeys.has(s.sourceScenarioKey)) {
      orphanedKeys.push(s.sourceScenarioKey);
      items.push({ sourceScenarioKey: s.sourceScenarioKey, name: s.sourceScenarioKey, action: 'orphaned', fromVersion: s.packVersion, toVersion: s.packVersion });
    }
  }

  return { packId: pack.id, targetVersion: target, orgId, toUpdate, toInsert, unchangedKeys, orphanedKeys, items };
}

// ── Modality / cost profile ──────────────────────────────────────────────────
//
// A lightweight, pure read of what a pack costs to *run* (founder note on the
// #55 import slice: "carry a lightweight modality/cost profile into the admin
// import path — expected turn count, voice/phone latency risk, whether the
// scenario needs interruption handling — so operators understand why two
// scenarios can look similar in the catalog but behave very differently in live
// training"). Surfaced on the import preview/response so an operator sees the
// operational shape before committing a pack to a client workspace.

/** Coarse latency risk of running a pack, driven by its heaviest modality. */
export type PackLatencyRisk = 'low' | 'medium' | 'high';

/** Per-difficulty rough turn estimate — a planning heuristic, not a guarantee. */
const ESTIMATED_TURNS: Record<ScenarioDifficulty, number> = { easy: 4, medium: 6, hard: 8 };

/** The operational shape of a pack — how it behaves in live training. */
export interface PackModalityProfile {
  totalScenarios: number;
  /** Scenario counts per practice modality. */
  byModality: Record<SimulationType, number>;
  /**
   * Coarse latency risk of the pack's heaviest channel: PHONE (real carrier
   * round-trip) → high, VOICE (browser speech) → medium, CHAT-only → low.
   */
  latencyRisk: PackLatencyRisk;
  /**
   * True when the pack contains a real-time voice channel (VOICE or PHONE) — the
   * trainee can talk over the customer, so the run needs interruption handling.
   */
  needsInterruptionHandling: boolean;
  /** Rough total turn count across the pack (sum of the per-difficulty estimate). */
  estimatedTurnsTotal: number;
  /** One-line operator-facing summary of the above. */
  note: string;
}

/**
 * Compute the pure {@link PackModalityProfile} for a pack. No DB, no network.
 */
export function packModalityProfile(pack: ScenarioPack): PackModalityProfile {
  const byModality: Record<SimulationType, number> = { CHAT: 0, VOICE: 0, PHONE: 0 };
  let estimatedTurnsTotal = 0;
  for (const s of pack.scenarios) {
    byModality[s.type] += 1;
    estimatedTurnsTotal += ESTIMATED_TURNS[s.script.difficulty];
  }
  const latencyRisk: PackLatencyRisk =
    byModality.PHONE > 0 ? 'high' : byModality.VOICE > 0 ? 'medium' : 'low';
  const needsInterruptionHandling = byModality.PHONE > 0 || byModality.VOICE > 0;
  const channels = (['CHAT', 'VOICE', 'PHONE'] as SimulationType[])
    .filter((m) => byModality[m] > 0)
    .join(' + ');
  const note = needsInterruptionHandling
    ? `${pack.scenarios.length} scenarios (${channels}); real-time voice present — expect interruption handling and ${latencyRisk} latency.`
    : `${pack.scenarios.length} scenarios (${channels}); text-only — low latency, no interruption handling.`;
  return {
    totalScenarios: pack.scenarios.length,
    byModality,
    latencyRisk,
    needsInterruptionHandling,
    estimatedTurnsTotal,
    note,
  };
}

// ── Public catalog (hidden-mechanic-safe) ────────────────────────────────────

/** A single scenario as exposed on the public catalog — never carries `script`. */
export interface PublicPackScenario {
  key: string;
  name: string;
  summary: string;
  difficulty: ScenarioDifficulty;
  type: SimulationType;
}

/** A single pack as exposed on the public catalog. */
export interface PublicScenarioPack {
  id: string;
  vertical: string;
  name: string;
  description: string;
  /** The role this pack trains (name only). */
  role: string;
  /** How many scenarios the pack contains. */
  scenarioCount: number;
  /** Distinct difficulties present, in `easy → medium → hard` order. */
  difficulties: ScenarioDifficulty[];
  /** Distinct practice modalities present. */
  modalities: SimulationType[];
  /** Per-scenario summaries — no persona, objective, or hints. */
  scenarios: PublicPackScenario[];
}

/** The serialisable payload returned by `GET /api/scenario-packs`. */
export interface PublicPackCatalog {
  version: number;
  packCount: number;
  packs: PublicScenarioPack[];
}

const DIFFICULTY_ORDER: readonly ScenarioDifficulty[] = ['easy', 'medium', 'hard'];

/**
 * Build the public, hidden-mechanic-safe catalog for the operator-facing
 * `/library` surface and `GET /api/scenario-packs`. Deliberately strips every
 * scenario `script` (persona / objective / hints) — the same hidden-mechanic
 * boundary the Phase-2 scenario sanitizer enforces (R-021). What remains is a
 * sales/browse view: pack pitch, role, difficulty + modality mix, and a
 * non-revealing per-scenario summary.
 */
export function getPublicPackCatalog(): PublicPackCatalog {
  const packs = SCENARIO_PACKS.map((pack) => {
    const difficulties = DIFFICULTY_ORDER.filter((d) =>
      pack.scenarios.some((s) => s.script.difficulty === d),
    );
    const modalities = Array.from(new Set(pack.scenarios.map((s) => s.type)));
    return {
      id: pack.id,
      vertical: pack.vertical,
      name: pack.name,
      description: pack.description,
      role: pack.jobTitle.name,
      scenarioCount: pack.scenarios.length,
      difficulties,
      modalities,
      scenarios: pack.scenarios.map((s) => ({
        key: s.key,
        name: s.name,
        summary: s.summary,
        difficulty: s.script.difficulty,
        type: s.type,
      })),
    };
  });
  return {
    version: PACK_CATALOG_VERSION,
    packCount: packs.length,
    packs,
  };
}
