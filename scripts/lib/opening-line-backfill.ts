/**
 * Pure planner for `scripts/backfill-opening-lines.ts` (plan W2.8 · G804).
 *
 * Scenarios reach production two ways, and NEITHER picks up a new script field
 * from a code deploy:
 *
 *   1. Global reference rows (`org_id IS NULL`, no pack provenance) were written
 *      once by `prisma/seed.ts`. The deploy pipeline never runs the seed.
 *   2. Starter-pack rows were copied into an org's `scenarios.script` JSONB at
 *      import time (`POST /api/scenario-packs/import`). They are frozen by
 *      design; only an operator's opt-in upgrade re-syncs them.
 *
 * So the authored `openingLine` has to be written into the existing rows. This
 * module decides, row by row, what to do — no DB, no network — and is unit
 * tested. Rules:
 *
 *   - Match by stable identity only: a pack row by `(source_pack_id,
 *     source_scenario_key)`; a seed row by the seed's own natural key (global
 *     job title name + scenario name, both global). A key shared by more than
 *     one global row is `ambiguous` and skipped. Org-authored rows have no
 *     catalog identity and are never touched.
 *   - Fill only where `openingLine` is missing or blank. Never overwrite.
 *   - Fill only where the stored persona / objective / difficulty still equal
 *     the catalog's. A row an operator has rewritten is `edited` and skipped:
 *     an opener written for the catalog persona could contradict theirs.
 */

/** The catalog fields the planner compares and copies. */
export interface CatalogScript {
  customerPersona: string;
  customerObjective: string;
  difficulty: string;
  openingLine?: string;
}

/** A seed scenario as `prisma/seed-scenarios.ts` exports it. */
export interface SeedCatalogEntry {
  jobTitleName: string;
  name: string;
  script: CatalogScript;
}

/** A starter pack as `src/lib/scenario-packs.ts` exports it. */
export interface PackCatalogEntry {
  id: string;
  scenarios: ReadonlyArray<{ key: string; script: CatalogScript }>;
}

/** One stored `scenarios` row, joined to its job title. */
export interface StoredScenarioRow {
  id: string;
  orgId: string | null;
  name: string;
  jobTitleName: string | null;
  jobTitleOrgId: string | null;
  sourcePackId: string | null;
  sourceScenarioKey: string | null;
  script: unknown;
}

export type BackfillAction =
  | 'fill'
  | 'already-set'
  | 'edited'
  | 'ambiguous'
  | 'catalog-has-no-line'
  | 'no-catalog-match';

export interface BackfillDecision {
  id: string;
  /** Catalog identity matched (`pack:<packId>/<key>` or `seed:<job>/<name>`), or null. */
  ref: string | null;
  action: BackfillAction;
  /** The line to write — set only when `action === 'fill'`. */
  openingLine?: string;
  /** The stored persona the write must still see (race guard) — set with `fill`. */
  expectedPersona?: string;
}

function seedKey(jobTitleName: string, name: string): string {
  return `${jobTitleName}\u0000${name}`;
}

function hasLine(script: unknown): boolean {
  if (!script || typeof script !== 'object') return false;
  const line = (script as { openingLine?: unknown }).openingLine;
  return typeof line === 'string' && line.trim().length > 0;
}

function sameMechanics(stored: unknown, catalog: CatalogScript): boolean {
  if (!stored || typeof stored !== 'object') return false;
  const s = stored as Record<string, unknown>;
  return (
    s.customerPersona === catalog.customerPersona &&
    s.customerObjective === catalog.customerObjective &&
    s.difficulty === catalog.difficulty
  );
}

/**
 * Decide, for every stored scenario row, whether the backfill writes an
 * `openingLine` into it. Pure: same inputs → same decisions.
 */
export function planOpeningLineBackfill(
  rows: readonly StoredScenarioRow[],
  seed: readonly SeedCatalogEntry[],
  packs: readonly PackCatalogEntry[],
): BackfillDecision[] {
  const seedByKey = new Map(seed.map((s) => [seedKey(s.jobTitleName, s.name), s]));
  const packByKey = new Map<string, CatalogScript>();
  for (const p of packs) for (const s of p.scenarios) packByKey.set(`${p.id}/${s.key}`, s.script);

  // How many global, non-pack rows share each seed key (ambiguity guard).
  const globalSeedKeyCount = new Map<string, number>();
  for (const r of rows) {
    if (r.orgId === null && r.sourcePackId === null && r.jobTitleName !== null && r.jobTitleOrgId === null) {
      const k = seedKey(r.jobTitleName, r.name);
      globalSeedKeyCount.set(k, (globalSeedKeyCount.get(k) ?? 0) + 1);
    }
  }

  return rows.map((r): BackfillDecision => {
    let ref: string | null = null;
    let catalog: CatalogScript | undefined;

    if (r.sourcePackId !== null && r.sourceScenarioKey !== null) {
      ref = `pack:${r.sourcePackId}/${r.sourceScenarioKey}`;
      catalog = packByKey.get(`${r.sourcePackId}/${r.sourceScenarioKey}`);
    } else if (
      r.orgId === null &&
      r.sourcePackId === null &&
      r.jobTitleName !== null &&
      r.jobTitleOrgId === null
    ) {
      const k = seedKey(r.jobTitleName, r.name);
      const entry = seedByKey.get(k);
      if (entry) {
        ref = `seed:${r.jobTitleName}/${r.name}`;
        if ((globalSeedKeyCount.get(k) ?? 0) > 1) return { id: r.id, ref, action: 'ambiguous' };
        catalog = entry.script;
      }
    }

    if (!catalog) return { id: r.id, ref, action: 'no-catalog-match' };
    if (hasLine(r.script)) return { id: r.id, ref, action: 'already-set' };
    const line = catalog.openingLine?.trim();
    if (!line) return { id: r.id, ref, action: 'catalog-has-no-line' };
    if (!sameMechanics(r.script, catalog)) return { id: r.id, ref, action: 'edited' };
    return { id: r.id, ref, action: 'fill', openingLine: line, expectedPersona: catalog.customerPersona };
  });
}

/** Per-action counts, for the run summary. */
export function summarizeBackfill(decisions: readonly BackfillDecision[]): Record<BackfillAction, number> {
  const counts: Record<BackfillAction, number> = {
    fill: 0,
    'already-set': 0,
    edited: 0,
    ambiguous: 0,
    'catalog-has-no-line': 0,
    'no-catalog-match': 0,
  };
  for (const d of decisions) counts[d.action] += 1;
  return counts;
}
