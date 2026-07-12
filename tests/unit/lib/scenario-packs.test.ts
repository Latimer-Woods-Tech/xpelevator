import { describe, it, expect } from 'vitest';
import {
  SCENARIO_PACKS,
  PACK_CATALOG_VERSION,
  getScenarioPack,
  getPublicPackCatalog,
  buildPackImportPlan,
  packModalityProfile,
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

describe('buildPackImportPlan — admin import materialisation', () => {
  const orgId = 'org-abc-123';

  it('stamps every row with the caller org, pack id, and catalog version', () => {
    for (const pack of SCENARIO_PACKS) {
      const plan = buildPackImportPlan(pack, orgId);
      expect(plan.orgId).toBe(orgId);
      expect(plan.packId).toBe(pack.id);
      expect(plan.packVersion).toBe(PACK_CATALOG_VERSION);
      expect(plan.jobTitle.orgId).toBe(orgId);
      expect(plan.jobTitle.name).toBe(pack.jobTitle.name);
      expect(plan.jobTitle.sourcePackId).toBe(pack.id);
      expect(plan.jobTitle.packVersion).toBe(PACK_CATALOG_VERSION);
      expect(plan.scenarios.length).toBe(pack.scenarios.length);
    }
  });

  it('carries the full hidden-mechanic script through to the scenario rows', () => {
    const pack = SCENARIO_PACKS[0];
    const plan = buildPackImportPlan(pack, orgId);
    plan.scenarios.forEach((row, i) => {
      const src = pack.scenarios[i];
      expect(row.orgId).toBe(orgId);
      expect(row.name).toBe(src.name);
      // summary becomes the (trainee-visible) description; the concealed
      // mechanics ride along in `script`, written server-side only.
      expect(row.description).toBe(src.summary);
      expect(row.type).toBe(src.type);
      expect(row.script).toEqual(src.script);
      expect(row.sourcePackId).toBe(pack.id);
      expect(row.sourceScenarioKey).toBe(src.key);
      expect(row.packVersion).toBe(PACK_CATALOG_VERSION);
    });
  });

  it('produces idempotency keys unique within the plan', () => {
    for (const pack of SCENARIO_PACKS) {
      const plan = buildPackImportPlan(pack, orgId);
      const keys = plan.scenarios.map((s) => `${s.sourcePackId}:${s.sourceScenarioKey}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe('packModalityProfile — operational shape (founder cost-profile note)', () => {
  it('counts scenarios per modality and totals to the pack size', () => {
    for (const pack of SCENARIO_PACKS) {
      const p = packModalityProfile(pack);
      expect(p.totalScenarios).toBe(pack.scenarios.length);
      expect(p.byModality.CHAT + p.byModality.VOICE + p.byModality.PHONE).toBe(
        pack.scenarios.length,
      );
    }
  });

  it('flags real-time voice (VOICE/PHONE) as needing interruption handling', () => {
    for (const pack of SCENARIO_PACKS) {
      const p = packModalityProfile(pack);
      const hasRealtime = pack.scenarios.some((s) => s.type === 'VOICE' || s.type === 'PHONE');
      expect(p.needsInterruptionHandling).toBe(hasRealtime);
      if (p.byModality.PHONE > 0) expect(p.latencyRisk).toBe('high');
      else if (p.byModality.VOICE > 0) expect(p.latencyRisk).toBe('medium');
      else expect(p.latencyRisk).toBe('low');
      expect(p.estimatedTurnsTotal).toBeGreaterThan(0);
      expect(p.note.trim()).not.toBe('');
      expect(p.note).not.toMatch(/\bAI\b/);
    }
  });

  it('rates a chat-only pack low-latency with no interruption handling', () => {
    const chatOnly = {
      id: 'chat-only',
      vertical: 'x',
      name: 'x',
      description: 'x',
      jobTitle: { name: 'r', description: 'd' },
      scenarios: [
        {
          key: 'a',
          name: 'A',
          summary: 's',
          type: 'CHAT' as const,
          script: { customerPersona: 'p', customerObjective: 'o', difficulty: 'easy' as const },
        },
      ],
    };
    const p = packModalityProfile(chatOnly);
    expect(p.latencyRisk).toBe('low');
    expect(p.needsInterruptionHandling).toBe(false);
    expect(p.byModality).toEqual({ CHAT: 1, VOICE: 0, PHONE: 0 });
    expect(p.estimatedTurnsTotal).toBe(4);
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
