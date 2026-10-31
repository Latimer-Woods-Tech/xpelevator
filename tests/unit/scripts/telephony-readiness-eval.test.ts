import { describe, it, expect } from 'vitest';
// The uptime monitor (scripts/uptime-check.mjs → checkTelephonyReadiness) imports
// this exact module to decide whether the live /api/health telephony block means
// the phone modality is dark. Testing it here is the proof-of-rejection (Standing
// Law 1) for that new gate: the same verdict function the monitor trusts is
// exercised below with `publicKey:false` to prove it STILL turns the monitor red —
// the #125 phone-dark outage the unsigned 401 webhook probe cannot see.
import { evaluateTelephonyReadiness } from '../../../scripts/lib/telephony-readiness-eval.mjs';

// Shapes mirror the `telephony` block of GET /api/health (booleans only).
const allReady = {
  telephony: { publicKey: true, apiKey: true, connectionId: true, webhookUrl: true },
};
const keyDark = {
  telephony: { publicKey: false, apiKey: true, connectionId: true, webhookUrl: true },
};
const outboundDegraded = {
  telephony: { publicKey: true, apiKey: false, connectionId: false, webhookUrl: true },
};

describe('evaluateTelephonyReadiness — hard gate on the inbound signing key', () => {
  it('healthy: publicKey true → not down, available, no degradation', () => {
    const v = evaluateTelephonyReadiness(allReady);
    expect(v.down).toBe(false);
    expect(v.available).toBe(true);
    expect(v.degraded).toEqual([]);
  });

  // The load-bearing proof-of-rejection: the #125 state MUST page.
  it('REJECTS the #125 outage: publicKey false → down (monitor red)', () => {
    const v = evaluateTelephonyReadiness(keyDark);
    expect(v.down).toBe(true);
    expect(v.available).toBe(true);
  });

  it('outbound creds missing but signing key present → NOT down, reports degraded', () => {
    const v = evaluateTelephonyReadiness(outboundDegraded);
    expect(v.down).toBe(false);
    expect(v.available).toBe(true);
    expect(v.degraded).toEqual(['apiKey', 'connectionId']);
  });
});

describe('evaluateTelephonyReadiness — deploy-ordering safety (never a false page)', () => {
  // The window between merge (monitor updates at once) and promote (new health
  // build live minutes later): the live build has NO telephony block yet. That
  // must be "signal not live", never a page.
  it('absent telephony block → unavailable, never down', () => {
    expect(evaluateTelephonyReadiness({ ok: true, env: {} })).toEqual({
      down: false,
      available: false,
      degraded: [],
    });
  });

  it('publicKey not a boolean (malformed/partial body) → unavailable, never down', () => {
    expect(evaluateTelephonyReadiness({ telephony: { apiKey: true } }).available).toBe(false);
    expect(evaluateTelephonyReadiness({ telephony: null }).available).toBe(false);
  });

  it('null / non-object health (unreachable or non-JSON) → unavailable, never down', () => {
    expect(evaluateTelephonyReadiness(null)).toEqual({ down: false, available: false, degraded: [] });
    expect(evaluateTelephonyReadiness('not json')).toEqual({
      down: false,
      available: false,
      degraded: [],
    });
  });
});
