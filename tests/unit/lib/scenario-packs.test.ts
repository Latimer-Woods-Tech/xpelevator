import { describe, it, expect } from 'vitest';
import {
  SCENARIO_PACKS,
  PACK_CATALOG_VERSION,
  getScenarioPack,
  getPublicPackCatalog,
  buildPackImportPlan,
  buildPackUpgradePlan,
  packModalityProfile,
  computePackStatus,
  upgradeActionLabel,
  summarizeUpgradeCounts,
  type StoredPackScenario,
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

describe('buildPackUpgradePlan — drift detection (pure)', () => {
  const PACK = SCENARIO_PACKS[0];
  const ORG = 'org-42';
  const allKeys = PACK.scenarios.map((s) => s.key);

  it('all rows already at the catalog version → clean no-op (everything unchanged)', () => {
    const stored: StoredPackScenario[] = allKeys.map((k) => ({
      sourceScenarioKey: k,
      packVersion: PACK_CATALOG_VERSION,
    }));
    const plan = buildPackUpgradePlan(PACK, stored, ORG);
    expect(plan.packId).toBe(PACK.id);
    expect(plan.targetVersion).toBe(PACK_CATALOG_VERSION);
    expect(plan.orgId).toBe(ORG);
    expect(plan.toUpdate).toHaveLength(0);
    expect(plan.toInsert).toHaveLength(0);
    expect(plan.unchangedKeys).toHaveLength(allKeys.length);
    expect(plan.orphanedKeys).toHaveLength(0);
    expect(plan.items.every((i) => i.action === 'unchanged')).toBe(true);
  });

  it('rows stamped at an older version → all flagged stale for update, content refreshed', () => {
    const stored: StoredPackScenario[] = allKeys.map((k) => ({
      sourceScenarioKey: k,
      packVersion: PACK_CATALOG_VERSION - 1,
    }));
    const plan = buildPackUpgradePlan(PACK, stored, ORG);
    expect(plan.toUpdate).toHaveLength(allKeys.length);
    expect(plan.toInsert).toHaveLength(0);
    expect(plan.unchangedKeys).toHaveLength(0);
    // each update row carries the current catalog content + bumped version + provenance
    for (const row of plan.toUpdate) {
      const src = PACK.scenarios.find((s) => s.key === row.sourceScenarioKey)!;
      expect(row.name).toBe(src.name);
      expect(row.description).toBe(src.summary);
      expect(row.type).toBe(src.type);
      expect(row.script).toEqual(src.script);
      expect(row.packVersion).toBe(PACK_CATALOG_VERSION);
      expect(row.sourcePackId).toBe(PACK.id);
      expect(row.orgId).toBe(ORG);
    }
    expect(plan.items.every((i) => i.action === 'update' && i.toVersion === PACK_CATALOG_VERSION)).toBe(true);
  });

  it('a null (pre-versioning) stored version is treated as stale', () => {
    const stored: StoredPackScenario[] = [{ sourceScenarioKey: allKeys[0], packVersion: null }];
    const plan = buildPackUpgradePlan(PACK, stored, ORG);
    const first = plan.items.find((i) => i.sourceScenarioKey === allKeys[0])!;
    expect(first.action).toBe('update');
    expect(first.fromVersion).toBeNull();
    expect(plan.toUpdate.some((r) => r.sourceScenarioKey === allKeys[0])).toBe(true);
  });

  it('a catalog scenario with no stored row → insert; a stored key not in the catalog → orphaned (never in a write list)', () => {
    // Import only the first scenario, plus a stale key that has left the catalog.
    const stored: StoredPackScenario[] = [
      { sourceScenarioKey: allKeys[0], packVersion: PACK_CATALOG_VERSION },
      { sourceScenarioKey: 'retired-scenario-key', packVersion: PACK_CATALOG_VERSION - 1 },
    ];
    const plan = buildPackUpgradePlan(PACK, stored, ORG);
    // every catalog scenario except the one already-current is an insert
    expect(plan.toInsert.map((r) => r.sourceScenarioKey).sort()).toEqual(allKeys.slice(1).sort());
    expect(plan.unchangedKeys).toEqual([allKeys[0]]);
    expect(plan.orphanedKeys).toEqual(['retired-scenario-key']);
    // orphaned is reported only — never appears in a write list
    expect(plan.toUpdate.some((r) => r.sourceScenarioKey === 'retired-scenario-key')).toBe(false);
    expect(plan.toInsert.some((r) => r.sourceScenarioKey === 'retired-scenario-key')).toBe(false);
    const orphan = plan.items.find((i) => i.sourceScenarioKey === 'retired-scenario-key')!;
    expect(orphan.action).toBe('orphaned');
  });

  it('a stored version ahead of the catalog is left unchanged (never downgraded)', () => {
    const stored: StoredPackScenario[] = [
      { sourceScenarioKey: allKeys[0], packVersion: PACK_CATALOG_VERSION + 5 },
    ];
    const plan = buildPackUpgradePlan(PACK, stored, ORG);
    expect(plan.toUpdate.some((r) => r.sourceScenarioKey === allKeys[0])).toBe(false);
    expect(plan.unchangedKeys).toContain(allKeys[0]);
  });

  it('the upgrade write rows never leak into the public-catalog shape but do carry the hidden script server-side', () => {
    const stored: StoredPackScenario[] = [{ sourceScenarioKey: allKeys[0], packVersion: null }];
    const plan = buildPackUpgradePlan(PACK, stored, ORG);
    // the update row IS the server-side materialisation — it carries the script
    expect(plan.toUpdate[0].script).toHaveProperty('customerObjective');
    // but the audit items (what a preview surfaces) never carry the hidden mechanics
    expect(JSON.stringify(plan.items)).not.toMatch(/customerPersona|customerObjective|"hints"/);
  });
});

describe('computePackStatus — per-pack import status (admin packs surface)', () => {
  const PACK = SCENARIO_PACKS[0];
  const ORG = 'org-77';
  const allKeys = PACK.scenarios.map((s) => s.key);

  it('no stored rows → not_imported, zero counts, catalog metadata carried', () => {
    const status = computePackStatus(PACK, [], ORG);
    expect(status.state).toBe('not_imported');
    expect(status.importedScenarioCount).toBe(0);
    expect(status.catalogScenarioCount).toBe(PACK.scenarios.length);
    expect(status.catalogVersion).toBe(PACK_CATALOG_VERSION);
    expect(status.packId).toBe(PACK.id);
    expect(status.packName).toBe(PACK.name);
    expect(status.vertical).toBe(PACK.vertical);
    expect(status.role).toBe(PACK.jobTitle.name);
    expect(status.drift).toEqual({ update: 0, insert: 0, unchanged: 0, orphaned: 0 });
  });

  it('every row already at the catalog version → up_to_date, no drift', () => {
    const stored: StoredPackScenario[] = allKeys.map((k) => ({
      sourceScenarioKey: k,
      packVersion: PACK_CATALOG_VERSION,
    }));
    const status = computePackStatus(PACK, stored, ORG);
    expect(status.state).toBe('up_to_date');
    expect(status.importedScenarioCount).toBe(allKeys.length);
    expect(status.drift.update).toBe(0);
    expect(status.drift.insert).toBe(0);
    expect(status.drift.unchanged).toBe(allKeys.length);
  });

  it('a stale (older-version) row → upgrade_available with a positive update count', () => {
    const stored: StoredPackScenario[] = allKeys.map((k) => ({
      sourceScenarioKey: k,
      packVersion: PACK_CATALOG_VERSION - 1,
    }));
    const status = computePackStatus(PACK, stored, ORG);
    expect(status.state).toBe('upgrade_available');
    expect(status.drift.update).toBe(allKeys.length);
  });

  it('a pre-versioning (null) row → upgrade_available (treated as stale)', () => {
    const stored: StoredPackScenario[] = [{ sourceScenarioKey: allKeys[0], packVersion: null }];
    const status = computePackStatus(PACK, stored, ORG);
    expect(status.state).toBe('upgrade_available');
    expect(status.drift.update).toBeGreaterThan(0);
  });

  it('missing catalog scenarios → upgrade_available via inserts', () => {
    // Only one of the pack's scenarios is stored, all at the current version → the
    // rest are catalog additions this org lacks, so an upgrade would insert them.
    const stored: StoredPackScenario[] = [
      { sourceScenarioKey: allKeys[0], packVersion: PACK_CATALOG_VERSION },
    ];
    const status = computePackStatus(PACK, stored, ORG);
    expect(status.state).toBe('upgrade_available');
    expect(status.drift.insert).toBe(allKeys.length - 1);
    expect(status.importedScenarioCount).toBe(1);
  });

  it('a fully-current pack whose only extra row is orphaned stays up_to_date (orphans never force an upgrade)', () => {
    const stored: StoredPackScenario[] = [
      ...allKeys.map((k) => ({ sourceScenarioKey: k, packVersion: PACK_CATALOG_VERSION })),
      { sourceScenarioKey: 'retired-key', packVersion: PACK_CATALOG_VERSION },
    ];
    const status = computePackStatus(PACK, stored, ORG);
    expect(status.state).toBe('up_to_date');
    expect(status.drift.orphaned).toBe(1);
    expect(status.drift.update).toBe(0);
    expect(status.drift.insert).toBe(0);
  });

  it('never leaks hidden mechanics — the status carries no scenario script', () => {
    const stored: StoredPackScenario[] = [{ sourceScenarioKey: allKeys[0], packVersion: null }];
    const status = computePackStatus(PACK, stored, ORG);
    expect(JSON.stringify(status)).not.toMatch(/customerPersona|customerObjective|"hints"|"script"/);
  });
});

describe('upgradeActionLabel — dry-run preview badge (R-062)', () => {
  it('maps every action to a distinct, non-empty label', () => {
    const actions = ['update', 'insert', 'unchanged', 'orphaned'] as const;
    const labels = actions.map((a) => upgradeActionLabel(a).label);
    for (const l of labels) expect(l.length).toBeGreaterThan(0);
    // Distinct labels so the operator can tell the four states apart.
    expect(new Set(labels).size).toBe(4);
  });

  it('an orphaned row reads as kept, never deleted (never-delete contract)', () => {
    expect(upgradeActionLabel('orphaned').label.toLowerCase()).toContain('kept');
  });

  it('carries a swatch class for each action', () => {
    for (const a of ['update', 'insert', 'unchanged', 'orphaned'] as const) {
      expect(upgradeActionLabel(a).cls).toMatch(/border/);
    }
  });
});

describe('summarizeUpgradeCounts — operator preview sentence (R-062)', () => {
  it('summarises a mixed upgrade and reassures authored rows are safe', () => {
    const s = summarizeUpgradeCounts({ update: 2, insert: 1, unchanged: 3, orphaned: 0 });
    expect(s).toContain('2 to update');
    expect(s).toContain('1 to add');
    expect(s).toContain('never touched');
  });

  it('reports the no-op case when nothing would change', () => {
    expect(summarizeUpgradeCounts({ update: 0, insert: 0, unchanged: 5, orphaned: 0 })).toMatch(/up to date/i);
  });

  it('notes orphaned rows are kept when there is nothing else to sync', () => {
    const s = summarizeUpgradeCounts({ update: 0, insert: 0, unchanged: 2, orphaned: 3 });
    expect(s).toContain('3 retired');
    expect(s.toLowerCase()).toContain('kept');
  });

  it('appends the orphan note to a real sync and pluralises correctly', () => {
    const one = summarizeUpgradeCounts({ update: 1, insert: 0, unchanged: 0, orphaned: 1 });
    expect(one).toContain('1 retired scenario left in place');
    const many = summarizeUpgradeCounts({ update: 1, insert: 0, unchanged: 0, orphaned: 2 });
    expect(many).toContain('2 retired scenarios left in place');
  });

  it('never emits the banned "AI" token', () => {
    const s = summarizeUpgradeCounts({ update: 1, insert: 1, unchanged: 1, orphaned: 1 });
    expect(s).not.toMatch(/\bAI\b/);
  });
});
