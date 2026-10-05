/**
 * Data test (plan W2.8 · G804 · Factory#5238): every shipped scenario — the
 * reference seed set and every starter-pack scenario — carries an authored
 * `openingLine`, so a session on any of them opens with zero model calls.
 *
 * The founder ruling (2026-10-05) was "add an opening-line field to xpelevator
 * scenarios and author a line for each". This test is what makes "for each"
 * hold: a scenario added to the seed or a pack without one fails CI here.
 */
import { describe, it, expect } from 'vitest';
import { SEED_SCENARIOS } from '../../../prisma/seed-scenarios';
import { SCENARIO_PACKS } from '@/lib/scenario-packs';
import { scriptedOpeningLine } from '@/lib/opening-line';

type Row = { id: string; difficulty: string; openingLine: unknown };

const rows: Row[] = [
  ...SEED_SCENARIOS.map((s) => ({
    id: `seed:${s.jobTitleName}/${s.name}`,
    difficulty: s.script.difficulty,
    openingLine: (s.script as { openingLine?: unknown }).openingLine,
  })),
  ...SCENARIO_PACKS.flatMap((p) =>
    p.scenarios.map((s) => ({
      id: `pack:${p.id}/${s.key}`,
      difficulty: s.script.difficulty,
      openingLine: (s.script as { openingLine?: unknown }).openingLine,
    })),
  ),
];

describe('scenario opening lines — data', () => {
  it('covers the full shipped set (6 seed + every pack scenario)', () => {
    const packCount = SCENARIO_PACKS.reduce((n, p) => n + p.scenarios.length, 0);
    expect(SEED_SCENARIOS.length).toBe(6);
    expect(rows.length).toBe(6 + packCount);
  });

  it.each(rows.map((r) => [r.id, r] as const))('%s has a non-empty openingLine', (_id, row) => {
    expect(typeof row.openingLine).toBe('string');
    expect(scriptedOpeningLine({ openingLine: row.openingLine })).not.toBeNull();
  });

  it.each(rows.map((r) => [r.id, r] as const))(
    '%s openingLine is plain spoken text (no stage directions, no "AI", at most two sentences)',
    (_id, row) => {
      const line = String(row.openingLine ?? '');
      // Stage directions / control tokens would be spoken aloud by TTS.
      expect(line).not.toMatch(/[[\]*_(){}<>]/);
      // Org copy rule: the word "AI" never appears on a trainee-facing surface.
      expect(line).not.toMatch(/\bA\.?I\b/);
      // Short enough to say in one breath on a phone line.
      const sentences = line.split(/(?<=[.?!])\s+/).filter((s) => s.trim().length > 0);
      expect(sentences.length).toBeLessThanOrEqual(2);
      expect(line.length).toBeLessThanOrEqual(200);
    },
  );

  it('no two scenarios share the same opening line', () => {
    const lines = rows.map((r) => String(r.openingLine ?? ''));
    expect(new Set(lines).size).toBe(lines.length);
  });
});
