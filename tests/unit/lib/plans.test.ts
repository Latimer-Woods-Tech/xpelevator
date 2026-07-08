import { describe, it, expect } from 'vitest';
import {
  SEAT_TIERS,
  PLAN_CATALOG_VERSION,
  getSeatTier,
  tierUnlocksModality,
  minimumTierForModality,
  getPublicPlanCatalog,
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
