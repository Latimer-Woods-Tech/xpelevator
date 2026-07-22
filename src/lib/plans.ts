/**
 * Seat-plan catalog — the single source of truth for XPElevator monetization.
 *
 * Founder decision (issue #16, 2026-07-08, reconciled from Factory#1952):
 * monetization = a B2B **seat-based subscription**, billed per active trainee /
 * month on the shared Stripe platform account, in three cumulative tiers:
 *
 *     chat  →  chat + voice  →  chat + voice + phone
 *
 * A "seat" is one active trainee for one month. Each tier unlocks a cumulative
 * set of practice modalities (the `SimulationType` the trainee may run); every
 * higher tier includes every modality of the tiers below it.
 *
 * This module is deliberately pure data + pure helpers — no Stripe SDK, no DB,
 * no secrets, no network. It is the contract the billing wiring (Stripe
 * test-mode products bound by `stripeLookupKey`), the operator-facing pricing /
 * signup surface, and per-seat modality gating all read from. Wholesale prices
 * are intentionally NOT encoded here: amounts are a founder input and live in
 * Stripe (resolved by lookup key at checkout), so this catalog never hard-codes
 * money.
 */

/**
 * Practice modality a trainee runs. Mirrors the Prisma `SimulationType` enum
 * (`prisma/schema.prisma`) — kept as a local union so this pure module never
 * imports the generated Prisma client. The unit test asserts the two stay in
 * lock-step (the catalog must cover exactly PHONE / CHAT / VOICE).
 */
export type SimulationType = 'PHONE' | 'CHAT' | 'VOICE';

/** Stable identifier for a seat tier — also the SKU stem and URL slug. */
export type SeatTierId = 'chat' | 'voice' | 'phone';

/** A purchasable seat tier: one active trainee for one month. */
export interface SeatTier {
  /** Stable id / SKU stem / slug. */
  id: SeatTierId;
  /** Operator-facing tier name (never the word "AI" — org copy rule). */
  name: string;
  /** One-line operator-facing summary of what the seat unlocks. */
  description: string;
  /** Ordinal rank; a higher rank unlocks strictly more (chat=1, voice=2, phone=3). */
  rank: number;
  /** Practice modalities a trainee on this seat may run (cumulative). */
  modalities: readonly SimulationType[];
  /**
   * Stable Stripe Price `lookup_key` for the per-seat / month recurring price.
   * The wholesale amount is set in Stripe (test-mode first) and resolved by
   * lookup key at checkout — never hard-coded here. Internal wiring detail; not
   * exposed on the public catalog.
   */
  stripeLookupKey: string;
  /** Billing shape — one seat = one active trainee, billed monthly. */
  billing: { unit: 'seat'; interval: 'month' };
}

/**
 * Bump when the tier set / modality mapping changes so callers (pricing page
 * cache, Stripe sync) can detect drift.
 */
export const PLAN_CATALOG_VERSION = 1 as const;

/**
 * The tiered seat catalog, ordered lowest → highest. Cumulative by construction:
 * each tier's `modalities` is a superset of the tier below it.
 */
export const SEAT_TIERS: readonly SeatTier[] = [
  {
    id: 'chat',
    name: 'Chat',
    description:
      'Text-conversation practice with simulated customers and weighted performance scoring.',
    rank: 1,
    modalities: ['CHAT'],
    stripeLookupKey: 'xpelevator_seat_chat_monthly',
    billing: { unit: 'seat', interval: 'month' },
  },
  {
    id: 'voice',
    name: 'Voice',
    description:
      'Everything in Chat, plus in-browser spoken practice with simulated customers.',
    rank: 2,
    modalities: ['CHAT', 'VOICE'],
    stripeLookupKey: 'xpelevator_seat_voice_monthly',
    billing: { unit: 'seat', interval: 'month' },
  },
  {
    id: 'phone',
    name: 'Phone',
    description:
      'Everything in Voice, plus live phone-call practice with simulated customers.',
    rank: 3,
    modalities: ['CHAT', 'VOICE', 'PHONE'],
    stripeLookupKey: 'xpelevator_seat_phone_monthly',
    billing: { unit: 'seat', interval: 'month' },
  },
] as const;

/** Look up a tier by id. Returns `undefined` for an unknown id. */
export function getSeatTier(id: string): SeatTier | undefined {
  return SEAT_TIERS.find((t) => t.id === id);
}

/** Whether a seat tier unlocks a given practice modality. */
export function tierUnlocksModality(
  tierId: SeatTierId,
  modality: SimulationType
): boolean {
  const tier = getSeatTier(tierId);
  return tier ? tier.modalities.includes(modality) : false;
}

/**
 * The lowest-rank tier that unlocks a given modality — i.e. the cheapest seat a
 * trainee needs to run that modality. Every modality is covered by construction,
 * so this always returns a tier.
 */
export function minimumTierForModality(modality: SimulationType): SeatTier {
  const tier = [...SEAT_TIERS]
    .sort((a, b) => a.rank - b.rank)
    .find((t) => t.modalities.includes(modality));
  if (!tier) {
    // Unreachable given the catalog covers every SimulationType; guarded so a
    // future enum addition fails loudly instead of silently returning nothing.
    throw new Error(`No seat tier unlocks modality: ${modality}`);
  }
  return tier;
}

/**
 * The persisted `OrgPlan` enum values (`prisma/schema.prisma`). Kept as a local
 * union so this pure module never imports the generated Prisma client — the
 * unit test asserts it stays in lock-step with the schema enum.
 */
export type OrgPlan = 'FREE' | 'PRO' | 'ENTERPRISE';

/**
 * The single documented bridge between the persisted billing plan and the seat
 * catalog. The founder-decided monetization is a cumulative three-tier seat
 * model (chat → +voice → +phone, issue #16 2026-07-08); the `OrgPlan` enum
 * predates that catalog, so this maps each plan to the tier its trainees are
 * entitled to:
 *
 *     FREE       → chat  (text practice only — the floor every org gets)
 *     PRO        → voice (text + in-browser voice)
 *     ENTERPRISE → phone (text + voice + live phone)
 *
 * An unknown / absent plan resolves to the most-restrictive `chat` tier, so a
 * missing or malformed value can never over-grant a modality.
 */
export const PLAN_TO_TIER: Record<OrgPlan, SeatTierId> = {
  FREE: 'chat',
  PRO: 'voice',
  ENTERPRISE: 'phone',
};

/** The seat tier a stored plan string entitles trainees to; unknown → `chat`. */
export function tierForPlan(plan: string | null | undefined): SeatTierId {
  if (plan === 'PRO' || plan === 'ENTERPRISE') return PLAN_TO_TIER[plan];
  return 'chat';
}

/**
 * The practice modalities an org on `plan` may run (cumulative). Falls back to
 * the `chat` floor for an unknown/absent plan, so gating can never over-grant.
 */
export function modalitiesForPlan(
  plan: string | null | undefined
): readonly SimulationType[] {
  const tier = getSeatTier(tierForPlan(plan));
  // `tierForPlan` always returns a valid catalog id, so `tier` is defined; the
  // guard keeps the type honest without a non-null assertion.
  return tier ? tier.modalities : SEAT_TIERS[0].modalities;
}

/** Whether an org on `plan` may run a given practice `modality`. */
export function planUnlocksModality(
  plan: string | null | undefined,
  modality: SimulationType
): boolean {
  return tierUnlocksModality(tierForPlan(plan), modality);
}

/** The public, serialisable catalog shape returned by `GET /api/plans`. */
export interface PublicPlanCatalog {
  version: number;
  /** Wholesale amounts are a founder input (set in Stripe); null until priced. */
  currency: null;
  billing: {
    model: 'seat-based-subscription';
    unit: 'seat';
    interval: 'month';
    note: string;
  };
  tiers: Array<{
    id: SeatTierId;
    name: string;
    description: string;
    rank: number;
    modalities: readonly SimulationType[];
  }>;
}

/**
 * Build the public catalog for the operator-facing pricing / signup surface.
 * Intentionally omits `stripeLookupKey` (internal wiring) and any price
 * (wholesale amounts are a founder input, resolved server-side at checkout).
 */
export function getPublicPlanCatalog(): PublicPlanCatalog {
  return {
    version: PLAN_CATALOG_VERSION,
    currency: null,
    billing: {
      model: 'seat-based-subscription',
      unit: 'seat',
      interval: 'month',
      note: 'One seat is one active trainee for one month.',
    },
    tiers: SEAT_TIERS.map(({ id, name, description, rank, modalities }) => ({
      id,
      name,
      description,
      rank,
      modalities,
    })),
  };
}
