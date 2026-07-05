import { describe, it, expect } from 'vitest';
import {
  sanitizeScenarioScript,
  sanitizeSessionScenario,
} from '@/lib/scenario-safety';

const FULL_SCRIPT = {
  customerPersona: 'Marcus, a furious enterprise customer',
  customerObjective: 'Get a full refund without admitting fault',
  difficulty: 'hard',
  hints: ['Acknowledge the frustration', 'Order #4821 was double-charged'],
  maxTurns: 12,
  ttsVoiceName: 'Google UK English Male',
};

describe('sanitizeScenarioScript', () => {
  it('returns the full script unchanged for admins', () => {
    expect(sanitizeScenarioScript(FULL_SCRIPT, true)).toEqual(FULL_SCRIPT);
  });

  it('strips hidden mechanics (persona / objective / hints) for non-admins', () => {
    const safe = sanitizeScenarioScript(FULL_SCRIPT, false);
    expect(safe).not.toBeNull();
    expect(safe).not.toHaveProperty('customerPersona');
    expect(safe).not.toHaveProperty('customerObjective');
    expect(safe).not.toHaveProperty('hints');
    expect(safe).not.toHaveProperty('difficulty');
    expect(safe).not.toHaveProperty('maxTurns');
  });

  it('preserves the presentational ttsVoiceName for non-admins', () => {
    expect(sanitizeScenarioScript(FULL_SCRIPT, false)).toEqual({
      ttsVoiceName: 'Google UK English Male',
    });
  });

  it('returns null for a non-admin when no safe fields remain', () => {
    expect(
      sanitizeScenarioScript({ hints: ['secret'] }, false)
    ).toBeNull();
  });

  it('handles null / non-object scripts gracefully', () => {
    expect(sanitizeScenarioScript(null, false)).toBeNull();
    expect(sanitizeScenarioScript(undefined, false)).toBeNull();
    expect(sanitizeScenarioScript('not-an-object', false)).toBeNull();
    expect(sanitizeScenarioScript(null, true)).toBeNull();
  });
});

describe('sanitizeSessionScenario', () => {
  it('strips hidden mechanics from a nested session scenario for non-admins', () => {
    const session = {
      id: 'sess-1',
      scenario: { id: 'sc-1', name: 'Bill dispute', script: { ...FULL_SCRIPT } },
    };
    const out = sanitizeSessionScenario(session, false);
    expect(out.scenario.script).toEqual({ ttsVoiceName: 'Google UK English Male' });
    // Same object mutated in place and returned.
    expect(out).toBe(session);
  });

  it('leaves the full script for admins', () => {
    const session = {
      scenario: { script: { ...FULL_SCRIPT } },
    };
    expect(sanitizeSessionScenario(session, true).scenario.script).toEqual(FULL_SCRIPT);
  });

  it('is a no-op when there is no scenario/script', () => {
    expect(sanitizeSessionScenario({ id: 'x' }, false)).toEqual({ id: 'x' });
    expect(
      sanitizeSessionScenario({ scenario: { name: 'no script' } }, false)
    ).toEqual({ scenario: { name: 'no script' } });
  });
});
