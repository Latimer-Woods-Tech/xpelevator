import { describe, it, expect } from 'vitest';
import {
  SEAT_TIERS,
  PLAN_CATALOG_VERSION,
  PLAN_TO_TIER,
  getSeatTier,
  tierUnlocksModality,
  minimumTierForModality,
  tierForPlan,
  modalitiesForPlan,
  planUnlocksModality,
  getPublicPlanCatalog,
  ALL_MODALITIES as EXPORTED_ALL_MODALITIES,
  type SimulationType,
} from '@/lib/plans';

// The full set of practice modalities the product supports. MUST equal the
// Prisma `SimulationType` enum values (prisma/schema.prisma). If the enum grows,
// this array and the catalog coverage assertion below must grow with it.
const ALL_MODALITIES: SimulationType[] = ['PHONE', 'CHAT', 'VOICE'];

describe('SEAT_TIERS catalog', () => {
  it('defines exactly the three founder-decided tiers, ranked chat < voice < phone', () => {
    expect(SEAT_TIERS.map((t) => t.id)).toEqual(['chat', 'voice', 'phone']);
    expect(SEAT_TIERS.map((t) => t.rank)).toEqual([1, 2, 3]);
  });

  it('is cumulative — each higher tier unlocks a strict superset of the one below', () => {
    for (let i = 1; i < SEAT_TIERS.length; i++) {
      const lower = new Set(SEAT_TIERS[i - 1].modalities);
      const higher = new Set(SEAT_TIERS[i].modalities);
      for (const m of lower) expect(higher.has(m)).toBe(true);
      expect(higher.size).toBeGreaterThan(lower.size);
    }
  });

  it('covers exactly the Prisma SimulationType set across all tiers (no gaps, no extras)', () => {
    const covered = new Set(SEAT_TIERS.flatMap((t) => t.modalities));
    expect(covered).toEqual(new Set(ALL_MODALITIES));
  });

  it('every tier bills per seat / month with a unique, stable Stripe lookup key', () => {
    const keys = SEAT_TIERS.map((t) => t.stripeLookupKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const t of SEAT_TIERS) {
      expect(t.billing).toEqual({ unit: 'seat', interval: 'month' });
      expect(t.stripeLookupKey).toMatch(/^xpelevator_seat_(chat|voice|phone)_monthly$/);
    }
  });

  it('never uses the banned word "AI" in operator-facing copy (org rule)', () => {
    for (const t of SEAT_TIERS) {
      expect(`${t.name} ${t.description}`).not.toMatch(/\bAI\b/);
    }
  });
});

describe('ALL_MODALITIES export (ungated set)', () => {
  it('equals every supported modality (the highest, cumulative tier)', () => {
    expect(new Set(EXPORTED_ALL_MODALITIES)).toEqual(new Set(ALL_MODALITIES));
    // It is exactly the top tier's set by construction.
    expect(EXPORTED_ALL_MODALITIES).toEqual(SEAT_TIERS[SEAT_TIERS.length - 1].modalities);
  });
});

describe('getSeatTier', () => {
  it('resolves a known tier and returns undefined for an unknown id', () => {
    expect(getSeatTier('voice')?.name).toBe('Voice');
    expect(getSeatTier('enterprise')).toBeUndefined();
  });
});

describe('tierUnlocksModality', () => {
  it('gates modalities by cumulative tier', () => {
    expect(tierUnlocksModality('chat', 'CHAT')).toBe(true);
    expect(tierUnlocksModality('chat', 'VOICE')).toBe(false);
    expect(tierUnlocksModality('chat', 'PHONE')).toBe(false);
    expect(tierUnlocksModality('voice', 'VOICE')).toBe(true);
    expect(tierUnlocksModality('voice', 'PHONE')).toBe(false);
    expect(tierUnlocksModality('phone', 'PHONE')).toBe(true);
  });
});

describe('minimumTierForModality', () => {
  it('returns the cheapest tier that unlocks each modality', () => {
    expect(minimumTierForModality('CHAT').id).toBe('chat');
    expect(minimumTierForModality('VOICE').id).toBe('voice');
    expect(minimumTierForModality('PHONE').id).toBe('phone');
  });
});

describe('getPublicPlanCatalog', () => {
  const pub = getPublicPlanCatalog();

  it('describes the seat-based subscription model without inventing prices', () => {
    expect(pub.version).toBe(PLAN_CATALOG_VERSION);
    expect(pub.currency).toBeNull();
    expect(pub.billing).toMatchObject({
      model: 'seat-based-subscription',
      unit: 'seat',
      interval: 'month',
    });
    expect(pub.tiers).toHaveLength(3);
  });

  it('does not leak the internal Stripe lookup key', () => {
    expect(JSON.stringify(pub)).not.toMatch(/stripeLookupKey|lookup_key/);
  });

  it('is JSON-serialisable and stable', () => {
    expect(() => JSON.parse(JSON.stringify(pub))).not.toThrow();
    expect(JSON.parse(JSON.stringify(pub)).tiers[0].id).toBe('chat');
  });
});

describe('plan → seat-tier → modality gating (per-seat entitlement)', () => {
  it('PLAN_TO_TIER maps every OrgPlan onto a real catalog tier, cumulatively ranked', () => {
    expect(PLAN_TO_TIER).toEqual({ FREE: 'chat', PRO: 'voice', ENTERPRISE: 'phone' });
    // Each mapped tier must exist in the catalog and rank monotonically with plan strength.
    const ranks = (['FREE', 'PRO', 'ENTERPRISE'] as const).map((p) => {
      const tier = getSeatTier(PLAN_TO_TIER[p]);
      expect(tier).toBeDefined();
      return tier?.rank;
    });
    expect(ranks).toEqual([1, 2, 3]);
  });

  it('tierForPlan resolves known plans and floors anything unknown/absent to chat', () => {
    expect(tierForPlan('FREE')).toBe('chat');
    expect(tierForPlan('PRO')).toBe('voice');
    expect(tierForPlan('ENTERPRISE')).toBe('phone');
    // Never over-grant on a bad value.
    expect(tierForPlan(null)).toBe('chat');
    expect(tierForPlan(undefined)).toBe('chat');
    expect(tierForPlan('')).toBe('chat');
    expect(tierForPlan('LEGENDARY')).toBe('chat');
    expect(tierForPlan('free')).toBe('chat'); // case-sensitive; lowercase is not the enum
  });

  it('modalitiesForPlan returns the cumulative modality set for each plan', () => {
    expect([...modalitiesForPlan('FREE')].sort()).toEqual(['CHAT']);
    expect([...modalitiesForPlan('PRO')].sort()).toEqual(['CHAT', 'VOICE']);
    expect([...modalitiesForPlan('ENTERPRISE')].sort()).toEqual(['CHAT', 'PHONE', 'VOICE']);
    expect([...modalitiesForPlan(null)].sort()).toEqual(['CHAT']);
  });

  it('planUnlocksModality enforces the founder chat → +voice → +phone ladder', () => {
    // CHAT is the floor — every plan (and an unknown one) may run it.
    for (const p of ['FREE', 'PRO', 'ENTERPRISE', null, 'nonsense']) {
      expect(planUnlocksModality(p, 'CHAT')).toBe(true);
    }
    // VOICE needs PRO+.
    expect(planUnlocksModality('FREE', 'VOICE')).toBe(false);
    expect(planUnlocksModality('PRO', 'VOICE')).toBe(true);
    expect(planUnlocksModality('ENTERPRISE', 'VOICE')).toBe(true);
    // PHONE needs ENTERPRISE.
    expect(planUnlocksModality('FREE', 'PHONE')).toBe(false);
    expect(planUnlocksModality('PRO', 'PHONE')).toBe(false);
    expect(planUnlocksModality('ENTERPRISE', 'PHONE')).toBe(true);
    // An unknown plan can never unlock a paid modality.
    expect(planUnlocksModality(null, 'VOICE')).toBe(false);
    expect(planUnlocksModality(undefined, 'PHONE')).toBe(false);
  });

  it('the required-tier upgrade hint points a locked trainee at the cheapest tier that unlocks', () => {
    const all: SimulationType[] = ['CHAT', 'VOICE', 'PHONE'];
    for (const m of all) {
      const tier = minimumTierForModality(m);
      // The hinted tier really does unlock the modality, and no lower-ranked tier does.
      expect(tier.modalities.includes(m)).toBe(true);
      for (const lower of SEAT_TIERS.filter((t) => t.rank < tier.rank)) {
        expect(lower.modalities.includes(m)).toBe(false);
      }
    }
    expect(minimumTierForModality('VOICE').id).toBe('voice');
    expect(minimumTierForModality('PHONE').id).toBe('phone');
  });
});
