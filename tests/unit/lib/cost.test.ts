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

const FAST = 'llama-3.1-8b-instant';
const REALISM = 'llama-3.3-70b-versatile';

describe('computeCostMicroUsd — pricing', () => {
  it('prices the fast 8B model exactly (input 0.05 / output 0.08 per 1M)', () => {
    // 1000·0.05 + 200·0.08 = 50 + 16 = 66 micro-USD.
    expect(computeCostMicroUsd(1000, 200, FAST)).toBe(66);
  });

  it('prices the 70B realism model exactly (input 0.59 / output 0.79 per 1M)', () => {
    // 1000·0.59 + 500·0.79 = 590 + 395 = 985 micro-USD.
    expect(computeCostMicroUsd(1000, 500, REALISM)).toBe(985);
  });

  it('rounds to an integer micro-USD (exact aggregation)', () => {
    // 1·0.05 + 1·0.08 = 0.13 → rounds to 0.
    expect(computeCostMicroUsd(1, 1, FAST)).toBe(0);
    // 7·0.59 = 4.13 → rounds to 4.
    expect(computeCostMicroUsd(7, 0, REALISM)).toBe(4);
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
    expect(isPricedModel('mystery')).toBe(false);
    expect(isPricedModel(null)).toBe(false);
    expect(isPricedModel(undefined)).toBe(false);
  });

  it('covers exactly the two models the app calls on the token-bearing paths', () => {
    expect(Object.keys(GROQ_PRICES).sort()).toEqual([FAST, REALISM].sort());
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
