import { describe, it, expect } from 'vitest';
import {
  scriptedOpeningLine,
  SCRIPTED_OPENING_MODEL,
  SCRIPTED_OPENING_ROUTE_REASON,
} from '@/lib/opening-line';

describe('scriptedOpeningLine (plan W2.8 · G804)', () => {
  it('returns the authored line, trimmed', () => {
    expect(scriptedOpeningLine({ openingLine: '  Hi, I need help.  ' })).toBe('Hi, I need help.');
  });

  it.each([
    ['null script', null],
    ['undefined script', undefined],
    ['non-object script', 'Hi'],
    ['no openingLine', { difficulty: 'easy' }],
    ['non-string openingLine', { openingLine: 42 }],
    ['blank openingLine', { openingLine: ' \n ' }],
  ])('returns null (use the model) for %s', (_label, script) => {
    expect(scriptedOpeningLine(script)).toBeNull();
  });

  it('telemetry tokens never collide with a real model id or difficulty route', () => {
    expect(SCRIPTED_OPENING_MODEL).toBe('scripted');
    expect(SCRIPTED_OPENING_ROUTE_REASON).toBe('scripted-opening');
    expect(SCRIPTED_OPENING_ROUTE_REASON.startsWith('difficulty=')).toBe(false);
  });
});
