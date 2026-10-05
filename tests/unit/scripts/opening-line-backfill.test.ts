/**
 * Planner for the openingLine data backfill (plan W2.8 · G804). The script that
 * writes production rows only ever executes these decisions, so these tests are
 * the proof that it fills exactly the rows it should: matched by stable
 * identity, never overwriting, never touching an operator-edited scenario.
 */
import { describe, it, expect } from 'vitest';
import {
  planOpeningLineBackfill,
  summarizeBackfill,
  type StoredScenarioRow,
  type SeedCatalogEntry,
  type PackCatalogEntry,
} from '../../../scripts/lib/opening-line-backfill';
import { SEED_SCENARIOS } from '../../../prisma/seed-scenarios';
import { SCENARIO_PACKS } from '@/lib/scenario-packs';

const SEED: SeedCatalogEntry[] = [
  {
    jobTitleName: 'IT Help Desk Agent',
    name: 'Password Reset',
    script: { customerPersona: 'Jamie', customerObjective: 'unlock', difficulty: 'easy', openingLine: 'Hi, I am locked out.' },
  },
];
const PACKS: PackCatalogEntry[] = [
  {
    id: 'saas',
    scenarios: [
      { key: 'churn', script: { customerPersona: 'Ellen', customerObjective: 'feel heard', difficulty: 'hard', openingLine: 'Cancel my account.' } },
      { key: 'noline', script: { customerPersona: 'Nora', customerObjective: 'x', difficulty: 'easy' } },
    ],
  },
];

function row(overrides: Partial<StoredScenarioRow>): StoredScenarioRow {
  return {
    id: 'r1',
    orgId: null,
    name: 'Password Reset',
    jobTitleName: 'IT Help Desk Agent',
    jobTitleOrgId: null,
    sourcePackId: null,
    sourceScenarioKey: null,
    script: { customerPersona: 'Jamie', customerObjective: 'unlock', difficulty: 'easy' },
    ...overrides,
  };
}
const packRow = (overrides: Partial<StoredScenarioRow> = {}) =>
  row({
    id: 'p1',
    orgId: 'org-1',
    name: 'Cancel my account today',
    jobTitleName: 'SaaS Support Specialist',
    jobTitleOrgId: 'org-1',
    sourcePackId: 'saas',
    sourceScenarioKey: 'churn',
    script: { customerPersona: 'Ellen', customerObjective: 'feel heard', difficulty: 'hard', hints: ['h'] },
    ...overrides,
  });

describe('planOpeningLineBackfill', () => {
  it('fills an unedited global seed row matched by (job title, name)', () => {
    const [d] = planOpeningLineBackfill([row({})], SEED, PACKS);
    expect(d).toMatchObject({ id: 'r1', action: 'fill', openingLine: 'Hi, I am locked out.', expectedPersona: 'Jamie' });
    expect(d.ref).toBe('seed:IT Help Desk Agent/Password Reset');
  });

  it('fills an unedited pack row matched by (source_pack_id, source_scenario_key) in any org', () => {
    const decisions = planOpeningLineBackfill(
      [packRow(), packRow({ id: 'p2', orgId: 'org-2', jobTitleOrgId: 'org-2', name: 'Renamed by operator' })],
      SEED,
      PACKS,
    );
    expect(decisions.map((d) => d.action)).toEqual(['fill', 'fill']);
    expect(decisions[0].ref).toBe('pack:saas/churn');
    expect(decisions[1].openingLine).toBe('Cancel my account.');
  });

  it('never overwrites an existing non-blank openingLine', () => {
    const [d] = planOpeningLineBackfill([packRow({ script: { customerPersona: 'Ellen', customerObjective: 'feel heard', difficulty: 'hard', openingLine: 'Operator line' } })], SEED, PACKS);
    expect(d.action).toBe('already-set');
    expect(d.openingLine).toBeUndefined();
  });

  it('treats a blank openingLine as missing', () => {
    const [d] = planOpeningLineBackfill([packRow({ script: { customerPersona: 'Ellen', customerObjective: 'feel heard', difficulty: 'hard', openingLine: '  ' } })], SEED, PACKS);
    expect(d.action).toBe('fill');
  });

  it('skips a row whose persona, objective or difficulty an operator edited', () => {
    const decisions = planOpeningLineBackfill(
      [
        packRow({ id: 'a', script: { customerPersona: 'Ellen, rewritten', customerObjective: 'feel heard', difficulty: 'hard' } }),
        packRow({ id: 'b', script: { customerPersona: 'Ellen', customerObjective: 'changed', difficulty: 'hard' } }),
        packRow({ id: 'c', script: { customerPersona: 'Ellen', customerObjective: 'feel heard', difficulty: 'easy' } }),
      ],
      SEED,
      PACKS,
    );
    expect(decisions.map((d) => d.action)).toEqual(['edited', 'edited', 'edited']);
  });

  it('never matches by title alone: an org-authored row with a seed name is left alone', () => {
    const [d] = planOpeningLineBackfill([row({ orgId: 'org-1', jobTitleOrgId: 'org-1' })], SEED, PACKS);
    expect(d).toEqual({ id: 'r1', ref: null, action: 'no-catalog-match' });
  });

  it('a global row under an org-scoped job title is not a seed row', () => {
    const [d] = planOpeningLineBackfill([row({ jobTitleOrgId: 'org-1' })], SEED, PACKS);
    expect(d.action).toBe('no-catalog-match');
  });

  it('skips a seed key held by more than one global row as ambiguous', () => {
    const decisions = planOpeningLineBackfill([row({ id: 'x' }), row({ id: 'y' })], SEED, PACKS);
    expect(decisions.map((d) => d.action)).toEqual(['ambiguous', 'ambiguous']);
  });

  it('reports a pack key that left the catalog, and a catalog entry with no line', () => {
    const decisions = planOpeningLineBackfill(
      [packRow({ id: 'gone', sourceScenarioKey: 'retired' }), packRow({ id: 'nl', sourceScenarioKey: 'noline', script: { customerPersona: 'Nora', customerObjective: 'x', difficulty: 'easy' } })],
      SEED,
      PACKS,
    );
    expect(decisions.map((d) => d.action)).toEqual(['no-catalog-match', 'catalog-has-no-line']);
  });

  it('summarizes decisions by action', () => {
    const decisions = planOpeningLineBackfill([row({}), packRow(), packRow({ id: 'z', orgId: 'o', sourceScenarioKey: 'retired' })], SEED, PACKS);
    expect(summarizeBackfill(decisions)).toEqual({
      fill: 2,
      'already-set': 0,
      edited: 0,
      ambiguous: 0,
      'catalog-has-no-line': 0,
      'no-catalog-match': 1,
    });
  });

  it('against the REAL catalog: every unedited shipped scenario row would be filled', () => {
    const rows: StoredScenarioRow[] = [
      ...SEED_SCENARIOS.map((s, i) =>
        row({ id: `seed-${i}`, name: s.name, jobTitleName: s.jobTitleName, script: { ...s.script, openingLine: undefined } }),
      ),
      ...SCENARIO_PACKS.flatMap((p) =>
        p.scenarios.map((s) =>
          packRow({ id: `${p.id}-${s.key}`, sourcePackId: p.id, sourceScenarioKey: s.key, script: { ...s.script, openingLine: undefined } }),
        ),
      ),
    ];
    const decisions = planOpeningLineBackfill(rows, SEED_SCENARIOS, SCENARIO_PACKS);
    expect(decisions.every((d) => d.action === 'fill')).toBe(true);
  });
});
