import { describe, it, expect } from 'vitest';
import {
  SCENARIO_PACKS,
  PACK_CATALOG_VERSION,
  getScenarioPack,
  getPublicPackCatalog,
} from '@/lib/scenario-packs';

// Deterministic: the pack catalog is pure data + pure helpers — no DB, no auth,
// no network. These tests lock the operator-inventory contract and, critically,
// the hidden-mechanic boundary the public catalog must never cross (R-021).

const VALID_DIFFICULTIES = ['easy', 'medium', 'hard'];
const VALID_TYPES = ['PHONE', 'CHAT', 'VOICE'];

describe('scenario-packs — starter library data', () => {
  it('pins the catalog version', () => {
    expect(PACK_CATALOG_VERSION).toBe(1);
  });

  it('ships at least three per-vertical packs with unique ids', () => {
    expect(SCENARIO_PACKS.length).toBeGreaterThanOrEqual(3);
    const ids = SCENARIO_PACKS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    // slug shape — usable as a SKU stem / URL slug
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it('every pack has a role and non-empty operator-facing copy', () => {
    for (const pack of SCENARIO_PACKS) {
      expect(pack.name.trim()).not.toBe('');
      expect(pack.vertical.trim()).not.toBe('');
      expect(pack.description.trim().length).toBeGreaterThan(20);
      expect(pack.jobTitle.name.trim()).not.toBe('');
      expect(pack.jobTitle.description.trim()).not.toBe('');
      expect(pack.scenarios.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('every scenario has a valid, importable script (persona/objective/difficulty)', () => {
    for (const pack of SCENARIO_PACKS) {
      const keys = pack.scenarios.map((s) => s.key);
      // keys unique within a pack (import idempotency)
      expect(new Set(keys).size).toBe(keys.length);
      for (const s of pack.scenarios) {
        expect(s.name.trim()).not.toBe('');
        expect(s.summary.trim()).not.toBe('');
        expect(VALID_TYPES).toContain(s.type);
        expect(VALID_DIFFICULTIES).toContain(s.script.difficulty);
        expect(s.script.customerPersona.trim().length).toBeGreaterThan(10);
        expect(s.script.customerObjective.trim().length).toBeGreaterThan(10);
        if (s.script.hints !== undefined) {
          expect(Array.isArray(s.script.hints)).toBe(true);
          for (const h of s.script.hints) expect(h.trim()).not.toBe('');
        }
      }
    }
  });

  it('each pack spans difficulty and modality (real training spread)', () => {
    for (const pack of SCENARIO_PACKS) {
      const diffs = new Set(pack.scenarios.map((s) => s.script.difficulty));
      const mods = new Set(pack.scenarios.map((s) => s.type));
      expect(diffs.size).toBeGreaterThanOrEqual(2);
      expect(mods.size).toBeGreaterThanOrEqual(2);
    }
  });

  it('user-facing copy never contains the banned word "AI" (org rule)', () => {
    // Persona/objective/hints reach the trainee simulation; names/summaries reach
    // the operator surface. None may carry the standalone token "AI".
    for (const pack of SCENARIO_PACKS) {
      const blob = [
        pack.name,
        pack.vertical,
        pack.description,
        pack.jobTitle.name,
        pack.jobTitle.description,
        ...pack.scenarios.flatMap((s) => [
          s.name,
          s.summary,
          s.script.customerPersona,
          s.script.customerObjective,
          ...(s.script.hints ?? []),
        ]),
      ].join('\n');
      expect(blob).not.toMatch(/\bAI\b/);
    }
  });

  it('getScenarioPack resolves a known id and rejects an unknown one', () => {
    const first = SCENARIO_PACKS[0];
    expect(getScenarioPack(first.id)?.name).toBe(first.name);
    expect(getScenarioPack('no-such-pack')).toBeUndefined();
  });
});

describe('getPublicPackCatalog — hidden-mechanic boundary', () => {
  it('returns the full pack set with a version and count', () => {
    const cat = getPublicPackCatalog();
    expect(cat.version).toBe(PACK_CATALOG_VERSION);
    expect(cat.packCount).toBe(SCENARIO_PACKS.length);
    expect(cat.packs.length).toBe(SCENARIO_PACKS.length);
  });

  it('NEVER exposes a scenario script (persona / objective / hints)', () => {
    const serialised = JSON.stringify(getPublicPackCatalog());
    // The concealed mechanics must not appear anywhere in the public payload.
    expect(serialised).not.toMatch(/customerPersona/);
    expect(serialised).not.toMatch(/customerObjective/);
    expect(serialised).not.toMatch(/hints/);
    expect(serialised).not.toMatch(/"script"/);
    // Spot-check an actual persona/objective string is absent.
    const sample = SCENARIO_PACKS[0].scenarios[0].script;
    expect(serialised).not.toContain(sample.customerPersona);
    expect(serialised).not.toContain(sample.customerObjective);
  });

  it('exposes a browse-safe summary per scenario', () => {
    const cat = getPublicPackCatalog();
    for (const pack of cat.packs) {
      expect(pack.role).not.toBe('');
      expect(pack.scenarioCount).toBe(pack.scenarios.length);
      expect(pack.difficulties.length).toBeGreaterThanOrEqual(1);
      expect(pack.modalities.length).toBeGreaterThanOrEqual(1);
      // difficulties always in easy → medium → hard order
      const order = ['easy', 'medium', 'hard'];
      const idxs = pack.difficulties.map((d) => order.indexOf(d));
      expect(idxs).toEqual([...idxs].sort((a, b) => a - b));
      for (const s of pack.scenarios) {
        expect(s.key).not.toBe('');
        expect(s.name).not.toBe('');
        expect(s.summary).not.toBe('');
        expect(VALID_DIFFICULTIES).toContain(s.difficulty);
        expect(VALID_TYPES).toContain(s.type);
        // no leaked script field on the public scenario shape
        expect(s).not.toHaveProperty('script');
      }
    }
  });
});
