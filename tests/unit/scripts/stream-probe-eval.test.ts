import { describe, it, expect } from 'vitest';
// The uptime monitor (scripts/uptime-check.mjs → checkGroqCompletion) imports this
// exact module to decide whether the realism-model streaming probe is a core-loop
// outage. Testing it here is the proof-of-rejection (Standing Law 1) for that
// loosened gate: the same verdict function the monitor trusts is exercised below
// with a PERSISTENT empty stream to prove the bounded retry absorbs a transient
// blip (#304 / #315) WITHOUT masking a sustained outage.
import {
  MAX_REALISM_STREAM_ATTEMPTS,
  isTransientEmptyStream,
  evaluateRealismStreamProbe,
} from '../../../scripts/lib/stream-probe-eval.mjs';

// Shapes mirror scripts/uptime-check.mjs probeGroqStream() return values.
const emptyOk = { status: 200, contentOk: false, usageOk: false }; // connected, no content
const contentOk = { status: 200, contentOk: true, usageOk: true }; // healthy turn + usage
const contentNoUsage = { status: 200, contentOk: true, usageOk: false }; // R-132 regression
const hard403 = { status: 403, contentOk: false, usageOk: false, errBody: 'org blocked' };
const unreachable = { status: 0, contentOk: false, usageOk: false, errBody: 'timeout' };

describe('isTransientEmptyStream — the retryable empty-200 flap only', () => {
  it('is true for HTTP 200 with no streamed content', () => {
    expect(isTransientEmptyStream(emptyOk)).toBe(true);
  });

  it('is false when content streamed (nothing to retry)', () => {
    expect(isTransientEmptyStream(contentOk)).toBe(false);
    expect(isTransientEmptyStream(contentNoUsage)).toBe(false);
  });

  it('is false for a hard non-200 — production does not absorb these via retry', () => {
    expect(isTransientEmptyStream(hard403)).toBe(false);
    expect(isTransientEmptyStream(unreachable)).toBe(false);
  });

  it('is false for nullish / malformed input (defensive)', () => {
    // @ts-expect-error — intentionally wrong type
    expect(isTransientEmptyStream(null)).toBe(false);
    // @ts-expect-error — intentionally wrong type
    expect(isTransientEmptyStream(undefined)).toBe(false);
  });
});

describe('evaluateRealismStreamProbe — monitor verdict mirrors production retry', () => {
  it('passes a transient empty-200 that RECOVERS on the reopened attempt', () => {
    // attempt 1 empty-200 (the flap), attempt 2 streamed content → NOT down.
    const v = evaluateRealismStreamProbe([emptyOk, contentOk]);
    expect(v.down).toBe(false);
    expect(v.usageMissing).toBe(false);
    expect(v.attempts).toBe(2);
    expect(v.final).toBe(contentOk);
  });

  it('passes a healthy single-attempt stream (no retry needed)', () => {
    const v = evaluateRealismStreamProbe([contentOk]);
    expect(v.down).toBe(false);
    expect(v.attempts).toBe(1);
  });

  // PROOF-OF-REJECTION #1: the retry must ABSORB a blip but NEVER mask a sustained
  // outage. A realism stream that stays empty across BOTH bounded attempts is the
  // real #304-class core-loop outage — the monitor MUST still go red.
  it('REJECTS a persistent empty stream across both bounded attempts (sustained outage)', () => {
    const v = evaluateRealismStreamProbe([emptyOk, emptyOk]);
    expect(v.down).toBe(true);
    expect(v.attempts).toBe(2);
  });

  // PROOF-OF-REJECTION #2: a hard non-200 is decided on the first attempt (the
  // monitor loop breaks without reopening) and MUST fail — swapping/retrying can't
  // fix an org-block or expired credential.
  it('REJECTS a hard non-200 on the first (only) attempt', () => {
    expect(evaluateRealismStreamProbe([hard403]).down).toBe(true);
    expect(evaluateRealismStreamProbe([unreachable]).down).toBe(true);
  });

  it('flags usage-missing (not down) when content streamed without a token-usage block', () => {
    const v = evaluateRealismStreamProbe([contentNoUsage]);
    expect(v.down).toBe(false);
    expect(v.usageMissing).toBe(true);
  });

  it('bases the verdict on the FINAL attempt (content after a blip is healthy)', () => {
    // Even if an earlier attempt lacked usage, the decisive last attempt is healthy.
    const v = evaluateRealismStreamProbe([emptyOk, contentOk]);
    expect(v.usageMissing).toBe(false);
    expect(v.final).toBe(contentOk);
  });

  it('treats no attempts / non-array as down (defensive — the monitor always probes)', () => {
    expect(evaluateRealismStreamProbe([]).down).toBe(true);
    // @ts-expect-error — intentionally wrong type
    expect(evaluateRealismStreamProbe(null).down).toBe(true);
    expect(evaluateRealismStreamProbe([]).final).toBeNull();
  });

  it('is bounded to production MAX_STREAM_ATTEMPTS so the probe cannot loop', () => {
    expect(MAX_REALISM_STREAM_ATTEMPTS).toBe(2);
  });
});
