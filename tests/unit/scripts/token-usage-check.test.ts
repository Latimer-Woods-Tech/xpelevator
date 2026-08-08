import { describe, it, expect } from 'vitest';
// The scoring-canary live gate imports this exact module; testing it here is the
// proof-of-rejection (Standing Law 1) for that gate — the same predicate that
// turns the canary red is exercised below with a no-usage row set.
import {
  evaluateTokenUsage,
  rowHasTokenUsage,
} from '../../../scripts/lib/token-usage-check.mjs';

describe('canary token-usage live gate (R-132, #155)', () => {
  it('accepts a session with at least one populated total_tokens', () => {
    const r = evaluateTokenUsage([{ totalTokens: 512 }, { totalTokens: null }]);
    expect(r.ok).toBe(true);
    expect(r.withTokens).toBe(1);
    expect(r.total).toBe(512);
    expect(r.reason).toBeNull();
  });

  it('sums total_tokens across every populated CUSTOMER row', () => {
    const r = evaluateTokenUsage([{ totalTokens: 300 }, { totalTokens: 212 }]);
    expect(r.ok).toBe(true);
    expect(r.withTokens).toBe(2);
    expect(r.total).toBe(512);
  });

  // PROOF-OF-REJECTION: the gate MUST go red if token accounting stops
  // populating on the live deploy (dropped usage block / missing include_usage
  // / column rename) — otherwise it is a probe that can never fail.
  it('rejects a session whose CUSTOMER rows all carry null/undefined total_tokens', () => {
    const r = evaluateTokenUsage([{ totalTokens: null }, { totalTokens: undefined }]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/token accounting regressed/i);
    expect(r.withTokens).toBe(0);
  });

  it('rejects when no CUSTOMER reply rows persisted at all', () => {
    const r = evaluateTokenUsage([]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no CUSTOMER reply rows/i);
  });

  it('treats a non-array input as empty (defensive)', () => {
    // @ts-expect-error — intentionally wrong type to prove the guard holds
    expect(evaluateTokenUsage(null).ok).toBe(false);
  });

  it('rowHasTokenUsage rejects zero / NaN / non-number / null and accepts a positive int', () => {
    expect(rowHasTokenUsage({ totalTokens: 0 })).toBe(false);
    expect(rowHasTokenUsage({ totalTokens: Number.NaN })).toBe(false);
    expect(rowHasTokenUsage({ totalTokens: '512' })).toBe(false);
    expect(rowHasTokenUsage({ totalTokens: -1 })).toBe(false);
    expect(rowHasTokenUsage(null)).toBe(false);
    expect(rowHasTokenUsage({ totalTokens: 1 })).toBe(true);
  });
});
