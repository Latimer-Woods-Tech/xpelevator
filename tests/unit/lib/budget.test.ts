/**
 * Deterministic tests for the per-tenant monthly Groq-spend ceiling (#155).
 *
 * Pure module — no DB, no auth. Proves the ceiling table, the `ok/warn/over`
 * threshold logic (incl. the proof-of-rejection: an over-ceiling tenant is
 * flagged `over`, the state the session-start gate blocks on), the fail-safe
 * clamping of a bad spend read, and the token→cost roll-up that feeds it.
 */
import { describe, it, expect } from 'vitest';
import {
  MONTHLY_ORG_SPEND_CEILING_MICRO_USD,
  BUDGET_WARN_THRESHOLD_PCT,
  ceilingForTier,
  evaluateBudget,
  summarizeSpend,
  type MonthlySpendGroup,
} from '@/lib/budget';

describe('budget — ceiling table', () => {
  it('every seat tier has a positive micro-USD ceiling that scales with the tier', () => {
    const { chat, voice, phone } = MONTHLY_ORG_SPEND_CEILING_MICRO_USD;
    expect(chat).toBeGreaterThan(0);
    expect(voice).toBeGreaterThan(chat);
    expect(phone).toBeGreaterThan(voice);
    expect(ceilingForTier('chat')).toBe(chat);
    expect(ceilingForTier('phone')).toBe(phone);
  });

  it('ceilings are integers (micro-USD is a whole unit)', () => {
    for (const v of Object.values(MONTHLY_ORG_SPEND_CEILING_MICRO_USD)) {
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});

describe('budget — evaluateBudget thresholds', () => {
  it('well under the ceiling → ok, with correct headroom and pct', () => {
    const cap = ceilingForTier('chat');
    const b = evaluateBudget(Math.round(cap * 0.1), 'chat');
    expect(b.status).toBe('ok');
    expect(b.pctUsed).toBe(10);
    expect(b.remainingMicroUsd).toBe(cap - Math.round(cap * 0.1));
    expect(b.tier).toBe('chat');
    expect(b.warnThresholdPct).toBe(BUDGET_WARN_THRESHOLD_PCT);
  });

  it('at the warn threshold (80%) → warn, not yet blocked', () => {
    const cap = ceilingForTier('voice');
    const b = evaluateBudget(Math.round(cap * 0.8), 'voice');
    expect(b.status).toBe('warn');
    expect(b.pctUsed).toBeGreaterThanOrEqual(BUDGET_WARN_THRESHOLD_PCT);
  });

  it('just below warn → still ok', () => {
    const cap = ceilingForTier('voice');
    const b = evaluateBudget(Math.round(cap * 0.79), 'voice');
    expect(b.status).toBe('ok');
  });

  // Proof-of-rejection (Standing Law 1): the gate MUST flag an over-ceiling
  // tenant — this is the state POST /api/simulations blocks on.
  it('at exactly the ceiling → over (boundary blocks, does not admit one more)', () => {
    const cap = ceilingForTier('phone');
    const b = evaluateBudget(cap, 'phone');
    expect(b.status).toBe('over');
    expect(b.remainingMicroUsd).toBe(0);
    expect(b.pctUsed).toBe(100);
  });

  it('above the ceiling → over, remaining floored at 0', () => {
    const cap = ceilingForTier('chat');
    const b = evaluateBudget(cap * 3, 'chat');
    expect(b.status).toBe('over');
    expect(b.remainingMicroUsd).toBe(0);
  });

  it('a negative / NaN spend clamps to 0 (fail-safe read) → ok', () => {
    expect(evaluateBudget(-5, 'chat').status).toBe('ok');
    expect(evaluateBudget(-5, 'chat').spentMicroUsd).toBe(0);
    expect(evaluateBudget(Number.NaN, 'chat').status).toBe('ok');
    expect(evaluateBudget(Number.NaN, 'chat').spentMicroUsd).toBe(0);
  });

  it('exposes formatted $ strings for cap / spent / remaining', () => {
    const b = evaluateBudget(1_000_000, 'chat');
    expect(b.spent).toBe('$1.000000');
    expect(b.cap).toBe('$25.000000');
    expect(typeof b.remaining).toBe('string');
  });
});

describe('budget — summarizeSpend', () => {
  it('prices known models and rolls tokens up', () => {
    const groups: MonthlySpendGroup[] = [
      {
        model: 'llama-3.1-8b-instant',
        promptTokens: 1_000_000,
        completionTokens: 0,
        totalTokens: 1_000_000,
      },
      {
        model: 'llama-3.3-70b-versatile',
        promptTokens: 0,
        completionTokens: 1_000_000,
        totalTokens: 1_000_000,
      },
    ];
    const s = summarizeSpend(groups);
    // 8b input $0.05/1M + 70b output $0.79/1M = $0.84 = 840,000 micro-USD.
    expect(s.costMicroUsd).toBe(840_000);
    expect(s.totalTokens).toBe(2_000_000);
    expect(s.unpricedTokens).toBe(0);
  });

  it('an unknown/absent model contributes 0 cost but its tokens surface as unpriced', () => {
    const groups: MonthlySpendGroup[] = [
      { model: 'some-future-model', promptTokens: 3_000, completionTokens: 3_000, totalTokens: 6_000 },
      { model: null, promptTokens: 1_000, completionTokens: 0, totalTokens: 1_000 },
    ];
    const s = summarizeSpend(groups);
    expect(s.costMicroUsd).toBe(0);
    expect(s.unpricedTokens).toBe(7_000);
    expect(s.totalTokens).toBe(7_000);
  });

  it('empty input → zeroed summary', () => {
    expect(summarizeSpend([])).toEqual({
      costMicroUsd: 0,
      totalTokens: 0,
      unpricedTokens: 0,
    });
  });

  it('tolerates missing numeric fields without throwing (partial row → 0)', () => {
    const groups = [
      { model: 'llama-3.1-8b-instant' } as unknown as MonthlySpendGroup,
    ];
    const s = summarizeSpend(groups);
    expect(s.costMicroUsd).toBe(0);
    expect(s.totalTokens).toBe(0);
  });
});
