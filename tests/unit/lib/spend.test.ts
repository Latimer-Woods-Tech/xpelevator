import { describe, it, expect } from 'vitest';
import { buildSpendLedger, type SpendTurnGroup } from '@/lib/spend';

// Unit tests for the pure spend-ledger aggregation (#155). Covers the fold from
// per-(session,model) token groups to per-session + tenant totals, and — the
// load-bearing case — that an UNPRICED model's tokens are surfaced as
// `unpricedTokens` and NEVER silently costed as $0 (which would overstate the
// Phase-4 margin).

const FAST = 'llama-3.1-8b-instant';
const REALISM = 'llama-3.3-70b-versatile';

function group(over: Partial<SpendTurnGroup> = {}): SpendTurnGroup {
  return {
    sessionId: 's1',
    trainee: 'a@ex.com',
    scenario: 'Refund',
    createdAt: '2026-08-08T10:00:00.000Z',
    model: FAST,
    promptTokens: 1000,
    completionTokens: 200,
    totalTokens: 1200,
    turns: 3,
    ...over,
  };
}

describe('buildSpendLedger — aggregation', () => {
  it('sums a single-model session and prices it exactly', () => {
    const ledger = buildSpendLedger([group()]);
    expect(ledger.sessions).toHaveLength(1);
    const s = ledger.sessions[0];
    expect(s.sessionId).toBe('s1');
    expect(s.date).toBe('2026-08-08');
    expect(s.trainee).toBe('a@ex.com');
    expect(s.scenario).toBe('Refund');
    expect(s.turns).toBe(3);
    expect(s.totalTokens).toBe(1200);
    // 1000·0.05 + 200·0.08 = 66 micro-USD.
    expect(s.costMicroUsd).toBe(66);
    expect(s.cost).toBe('$0.000066');
    expect(s.unpricedTokens).toBe(0);
  });

  it('folds multiple models within one session (cost adds across models)', () => {
    const ledger = buildSpendLedger([
      group({ model: FAST, promptTokens: 1000, completionTokens: 200, totalTokens: 1200, turns: 2 }),
      group({ model: REALISM, promptTokens: 1000, completionTokens: 500, totalTokens: 1500, turns: 1 }),
    ]);
    expect(ledger.sessions).toHaveLength(1);
    const s = ledger.sessions[0];
    expect(s.turns).toBe(3);
    expect(s.totalTokens).toBe(2700);
    // 66 (fast) + 985 (realism) = 1051 micro-USD.
    expect(s.costMicroUsd).toBe(1051);
    expect(s.unpricedTokens).toBe(0);
  });

  it('rolls tenant totals across distinct sessions in first-seen order', () => {
    const ledger = buildSpendLedger([
      group({ sessionId: 's2', createdAt: '2026-08-08T12:00:00.000Z' }),
      group({ sessionId: 's1', createdAt: '2026-08-08T10:00:00.000Z' }),
    ]);
    expect(ledger.sessions.map((s) => s.sessionId)).toEqual(['s2', 's1']);
    expect(ledger.totals.sessions).toBe(2);
    expect(ledger.totals.turns).toBe(6);
    expect(ledger.totals.totalTokens).toBe(2400);
    expect(ledger.totals.costMicroUsd).toBe(132);
    expect(ledger.totals.cost).toBe('$0.000132');
  });

  it('defaults a null trainee/scenario without dropping the row', () => {
    const ledger = buildSpendLedger([group({ trainee: null, scenario: null })]);
    expect(ledger.sessions[0].trainee).toBe('(unknown)');
    expect(ledger.sessions[0].scenario).toBe('');
  });

  it('normalises a Date createdAt and blanks a null/invalid one', () => {
    const withDate = buildSpendLedger([
      group({ sessionId: 'd1', createdAt: new Date('2026-08-08T10:00:00.000Z') }),
    ]);
    expect(withDate.sessions[0].date).toBe('2026-08-08');

    const withNull = buildSpendLedger([group({ sessionId: 'd2', createdAt: null })]);
    expect(withNull.sessions[0].date).toBe('');
  });

  it('echoes the pricing basis (source + asOf + all priced models)', () => {
    const ledger = buildSpendLedger([group()]);
    expect(ledger.pricing.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The pricing basis lists every priceable model: the current gpt-oss tiers
    // the app calls today plus the retained legacy tiers (still priced so
    // pre-swap history isn't silently unpriced).
    expect(ledger.pricing.models.map((m) => m.model).sort()).toEqual(
      ['openai/gpt-oss-20b', 'openai/gpt-oss-120b', FAST, REALISM].sort(),
    );
  });

  it('empty input → empty ledger with zeroed totals', () => {
    const ledger = buildSpendLedger([]);
    expect(ledger.sessions).toHaveLength(0);
    expect(ledger.totals.sessions).toBe(0);
    expect(ledger.totals.costMicroUsd).toBe(0);
    expect(ledger.totals.cost).toBe('$0.000000');
  });
});

describe('buildSpendLedger — proof-of-rejection (unpriced tokens are NOT free spend)', () => {
  it('an unknown-model group counts as unpricedTokens, not $0 cost', () => {
    const ledger = buildSpendLedger([
      group({ model: 'some-unlisted-model', promptTokens: 5000, completionTokens: 1000, totalTokens: 6000 }),
    ]);
    const s = ledger.sessions[0];
    // The whole point: cost stays 0 BUT the tokens are visibly unpriced, so the
    // ledger can never read as "6000 tokens cost nothing".
    expect(s.costMicroUsd).toBe(0);
    expect(s.unpricedTokens).toBe(6000);
    expect(ledger.totals.unpricedTokens).toBe(6000);
  });

  it('a null-model group is treated as unpriced', () => {
    const ledger = buildSpendLedger([
      group({ model: null, totalTokens: 1200 }),
    ]);
    expect(ledger.sessions[0].costMicroUsd).toBe(0);
    expect(ledger.sessions[0].unpricedTokens).toBe(1200);
  });

  it('mixes priced and unpriced within one session — costs the priced, flags the rest', () => {
    const ledger = buildSpendLedger([
      group({ model: FAST, promptTokens: 1000, completionTokens: 200, totalTokens: 1200 }),
      group({ model: 'unlisted', promptTokens: 3000, completionTokens: 0, totalTokens: 3000 }),
    ]);
    const s = ledger.sessions[0];
    expect(s.costMicroUsd).toBe(66); // only the fast group is priced
    expect(s.unpricedTokens).toBe(3000);
    expect(s.totalTokens).toBe(4200); // token sum still complete
  });
});
