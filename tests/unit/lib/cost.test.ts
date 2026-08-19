import { describe, it, expect } from 'vitest';
import {
  computeCostMicroUsd,
  isPricedModel,
  formatUsd,
  GROQ_PRICES,
} from '@/lib/cost';

// Unit tests for the Groq cost primitive (#155). The load-bearing behaviour is
// the REJECTION path: an un-priceable turn must return `null` (→ surfaced as
// unpriced tokens downstream), never `0` — a silent zero would understate Groq
// spend and overstate the Phase-4 seat margin, the exact blind spot #155 closes.

// Current tiers the app calls today (src/lib/ai.ts).
const FAST = 'openai/gpt-oss-20b';
const REALISM = 'openai/gpt-oss-120b';
// Decommissioned tiers retained only to keep pre-swap history priceable (#248).
const LEGACY_FAST = 'llama-3.1-8b-instant';
const LEGACY_REALISM = 'llama-3.3-70b-versatile';

describe('computeCostMicroUsd — pricing', () => {
  it('prices the fast gpt-oss-20b model exactly (input 0.075 / output 0.30 per 1M)', () => {
    // 1000·0.075 + 200·0.30 = 75 + 60 = 135 micro-USD.
    expect(computeCostMicroUsd(1000, 200, FAST)).toBe(135);
  });

  it('prices the realism gpt-oss-120b model exactly (input 0.15 / output 0.60 per 1M)', () => {
    // 1000·0.15 + 500·0.60 = 150 + 300 = 450 micro-USD.
    expect(computeCostMicroUsd(1000, 500, REALISM)).toBe(450);
  });

  it('still prices the retained legacy tiers (pre-swap history stays priceable)', () => {
    // 1000·0.05 + 200·0.08 = 50 + 16 = 66 micro-USD.
    expect(computeCostMicroUsd(1000, 200, LEGACY_FAST)).toBe(66);
    // 1000·0.59 + 500·0.79 = 590 + 395 = 985 micro-USD.
    expect(computeCostMicroUsd(1000, 500, LEGACY_REALISM)).toBe(985);
  });

  it('rounds to an integer micro-USD (exact aggregation)', () => {
    // 1·0.075 + 1·0.30 = 0.375 → rounds to 0.
    expect(computeCostMicroUsd(1, 1, FAST)).toBe(0);
    // 0·0.075 + 2·0.30 = 0.6 → rounds up to 1.
    expect(computeCostMicroUsd(0, 2, FAST)).toBe(1);
    // 7·0.15 = 1.05 → rounds to 1.
    expect(computeCostMicroUsd(7, 0, REALISM)).toBe(1);
  });

  it('zero tokens are priceable and cost 0 (not null)', () => {
    expect(computeCostMicroUsd(0, 0, FAST)).toBe(0);
  });
});

describe('computeCostMicroUsd — proof-of-rejection (returns null, never 0)', () => {
  it('unknown model → null', () => {
    expect(computeCostMicroUsd(1000, 200, 'gpt-something-unlisted')).toBeNull();
  });

  it('absent model (null/undefined/empty) → null', () => {
    expect(computeCostMicroUsd(1000, 200, null)).toBeNull();
    expect(computeCostMicroUsd(1000, 200, undefined)).toBeNull();
    expect(computeCostMicroUsd(1000, 200, '')).toBeNull();
  });

  it('null/undefined token counts → null', () => {
    expect(computeCostMicroUsd(null, 200, FAST)).toBeNull();
    expect(computeCostMicroUsd(1000, undefined, FAST)).toBeNull();
  });

  it('negative or NaN token counts → null', () => {
    expect(computeCostMicroUsd(-1, 200, FAST)).toBeNull();
    expect(computeCostMicroUsd(1000, Number.NaN, FAST)).toBeNull();
    expect(computeCostMicroUsd(Number.POSITIVE_INFINITY, 0, FAST)).toBeNull();
  });
});

describe('isPricedModel', () => {
  it('true only for models in the table', () => {
    expect(isPricedModel(FAST)).toBe(true);
    expect(isPricedModel(REALISM)).toBe(true);
    expect(isPricedModel(LEGACY_FAST)).toBe(true);
    expect(isPricedModel(LEGACY_REALISM)).toBe(true);
    expect(isPricedModel('mystery')).toBe(false);
    expect(isPricedModel(null)).toBe(false);
    expect(isPricedModel(undefined)).toBe(false);
  });

  it('covers the current app tiers plus the retained legacy tiers', () => {
    // Current models MUST be priced — the #248 swap left them unpriced until
    // this slice, silently understating Groq spend / overstating seat margin.
    expect(Object.keys(GROQ_PRICES).sort()).toEqual(
      [FAST, REALISM, LEGACY_FAST, LEGACY_REALISM].sort(),
    );
  });
});

describe('formatUsd', () => {
  it('renders micro-USD at 6-decimal resolution', () => {
    expect(formatUsd(66)).toBe('$0.000066');
    expect(formatUsd(1_000_000)).toBe('$1.000000');
    expect(formatUsd(0)).toBe('$0.000000');
  });

  it('renders a negative amount with a leading minus', () => {
    expect(formatUsd(-985)).toBe('-$0.000985');
  });
});
