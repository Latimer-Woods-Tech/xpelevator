/**
 * Unit tests for the conversation abuse/cost limits (src/lib/limits.ts).
 *
 * Root cause this covers: no rate limiting existed anywhere, and /api/chat
 * accepted unbounded message bodies — a single scripted client could exhaust
 * the org-wide Groq budget. Limits are enforced against DB state (timestamps,
 * counts); these tests cover the pure decision helpers.
 */

import { describe, it, expect } from 'vitest';
import {
  MAX_AGENT_MESSAGE_CHARS,
  MAX_SESSIONS_PER_DAY,
  MIN_TURN_INTERVAL_MS,
  MAX_PAGE_SIZE,
  DEFAULT_PAGE_SIZE,
  exceedsTurnRate,
  parsePagination,
  isStartSignal,
  isEndSignal,
  isControlSignal,
  stripEndSignal,
  windowConversation,
  MAX_CONVERSATION_CONTEXT_MESSAGES,
} from '@/lib/limits';

describe('limits constants', () => {
  it('are generous enough for real trainees', () => {
    expect(MAX_AGENT_MESSAGE_CHARS).toBeGreaterThanOrEqual(1_000);
    expect(MAX_SESSIONS_PER_DAY).toBeGreaterThanOrEqual(20);
    // But strict enough to stop scripts.
    expect(MIN_TURN_INTERVAL_MS).toBeGreaterThan(0);
  });
});

describe('exceedsTurnRate', () => {
  const now = Date.parse('2026-07-12T12:00:00.000Z');

  it('allows the first turn (no prior message)', () => {
    expect(exceedsTurnRate(null, now)).toBe(false);
    expect(exceedsTurnRate(undefined, now)).toBe(false);
  });

  it('rejects a turn arriving inside the minimum interval', () => {
    const justNow = new Date(now - MIN_TURN_INTERVAL_MS + 100).toISOString();
    expect(exceedsTurnRate(justNow, now)).toBe(true);
  });

  it('allows a turn after the minimum interval', () => {
    const earlier = new Date(now - MIN_TURN_INTERVAL_MS - 100).toISOString();
    expect(exceedsTurnRate(earlier, now)).toBe(false);
  });

  it('accepts Date objects as well as ISO strings', () => {
    expect(exceedsTurnRate(new Date(now - 10), now)).toBe(true);
    expect(exceedsTurnRate(new Date(now - MIN_TURN_INTERVAL_MS - 10), now)).toBe(false);
  });

  it('fails open on an unparseable timestamp (never blocks a real trainee)', () => {
    expect(exceedsTurnRate('not-a-date', now)).toBe(false);
  });
});

describe('lifecycle control signals', () => {
  it('recognizes [START] (exact, whitespace-trimmed)', () => {
    expect(isStartSignal('[START]')).toBe(true);
    expect(isStartSignal('  [START]  ')).toBe(true);
    expect(isStartSignal('start')).toBe(false);
    expect(isStartSignal('[END]')).toBe(false);
  });

  it('recognizes [END] and the natural phrase, case-insensitively', () => {
    expect(isEndSignal('[END]')).toBe(true);
    expect(isEndSignal('[end]')).toBe(true);
    expect(isEndSignal('  End Conversation ')).toBe(true);
    expect(isEndSignal('[START]')).toBe(false);
    expect(isEndSignal('I would like to end this now')).toBe(false);
  });

  it('recognizes a trailing [END] token appended to real closing prose', () => {
    // Regression: a trainee who closes with words + the token ("Thanks [END]")
    // previously was NOT an end signal, so the session silently continued.
    expect(isEndSignal('Thanks for your patience [END]')).toBe(true);
    expect(isEndSignal('That resolves it, goodbye [end]')).toBe(true);
    expect(isEndSignal('Thanks for your patience [END]  ')).toBe(true);
    // The token must be TRAILING — a bare mention mid-sentence is not an end.
    expect(isEndSignal('Press [END] to stop, but keep going for now')).toBe(false);
    // "end conversation" stays an EXACT phrase, not a substring.
    expect(isEndSignal('I would like to end conversation soon')).toBe(false);
  });

  it('treats both signals as control signals; a normal reply is not', () => {
    expect(isControlSignal('[START]')).toBe(true);
    expect(isControlSignal('[END]')).toBe(true);
    expect(isControlSignal('end conversation')).toBe(true);
    // A real trainee turn must NOT be treated as a control signal (it stays
    // throttled) — this is the regression guard for the canary 429-on-END bug.
    expect(isControlSignal('Thanks, that resolves my issue.')).toBe(false);
    expect(isControlSignal('')).toBe(false);
  });
});

describe('stripEndSignal', () => {
  it('recovers the closing prose from a prose + [END] message', () => {
    expect(stripEndSignal('Thanks for your patience [END]')).toBe(
      'Thanks for your patience'
    );
    expect(stripEndSignal('That resolves it, goodbye [end]  ')).toBe(
      'That resolves it, goodbye'
    );
  });

  it('yields "" for a bare control token (nothing scorable to persist)', () => {
    expect(stripEndSignal('[END]')).toBe('');
    expect(stripEndSignal('  [end]  ')).toBe('');
    expect(stripEndSignal('End Conversation')).toBe('');
  });
});

describe('parsePagination', () => {
  const p = (qs: string) => parsePagination(new URLSearchParams(qs));

  it('defaults when no params are given', () => {
    expect(p('')).toEqual({ limit: DEFAULT_PAGE_SIZE, offset: 0 });
  });

  it('honors valid limit/offset', () => {
    expect(p('limit=10&offset=20')).toEqual({ limit: 10, offset: 20 });
  });

  it('clamps limit to [1, MAX_PAGE_SIZE] — no unbounded scan', () => {
    expect(p('limit=99999').limit).toBe(MAX_PAGE_SIZE);
    expect(p('limit=0').limit).toBe(1);
    expect(p('limit=-5').limit).toBe(1);
  });

  it('floors offset at 0 and falls back on garbage', () => {
    expect(p('offset=-10').offset).toBe(0);
    expect(p('limit=abc&offset=xyz')).toEqual({ limit: DEFAULT_PAGE_SIZE, offset: 0 });
  });
});

describe('windowConversation (transcript context cap — #155 P3b-7)', () => {
  const msg = (i: number) => ({ role: i % 2 === 0 ? 'CUSTOMER' : 'AGENT', content: `m${i}` });
  const build = (n: number) => Array.from({ length: n }, (_, i) => msg(i));

  it('has a generous default cap (longer than a real training session)', () => {
    // The scoring canary drives ~7 messages; the cap must never bite a real
    // trainee. If this is ever lowered below a normal session, revisit.
    expect(MAX_CONVERSATION_CONTEXT_MESSAGES).toBeGreaterThanOrEqual(12);
  });

  it('returns a short conversation unchanged (typical session — zero behavior change)', () => {
    const conv = build(8);
    const out = windowConversation(conv);
    expect(out).toEqual(conv);
    expect(out.length).toBe(8);
  });

  it('returns a conversation exactly at the cap unchanged', () => {
    const conv = build(MAX_CONVERSATION_CONTEXT_MESSAGES);
    expect(windowConversation(conv)).toEqual(conv);
  });

  it('caps an over-long conversation to the window size', () => {
    const conv = build(MAX_CONVERSATION_CONTEXT_MESSAGES + 20);
    const out = windowConversation(conv);
    // PROOF-OF-REJECTION (Standing Law 1): without the cap this stays 44; the
    // cap must shrink it to exactly the window. Neutering windowConversation to
    // `return messages.slice()` fails this assertion.
    expect(out.length).toBe(MAX_CONVERSATION_CONTEXT_MESSAGES);
  });

  it('keeps the opener + the freshest turns, drops the stale middle', () => {
    const n = MAX_CONVERSATION_CONTEXT_MESSAGES + 10;
    const conv = build(n);
    const out = windowConversation(conv);
    // Opener (the anchor of what the conversation is about) is preserved.
    expect(out[0]).toBe(conv[0]);
    // The current/freshest turn is preserved (last element).
    expect(out[out.length - 1]).toBe(conv[n - 1]);
    // An early non-opener message (index 1) is dropped, not carried.
    expect(out).not.toContain(conv[1]);
    // No duplication of the opener into the tail.
    expect(out.filter((m) => m === conv[0]).length).toBe(1);
  });

  it('is role-agnostic — works on Groq-shaped {user|assistant} messages (phone path)', () => {
    const conv = Array.from({ length: MAX_CONVERSATION_CONTEXT_MESSAGES + 5 }, (_, i) => ({
      role: i % 2 === 0 ? 'assistant' : 'user',
      content: `g${i}`,
    }));
    const out = windowConversation(conv);
    expect(out.length).toBe(MAX_CONVERSATION_CONTEXT_MESSAGES);
    expect(out[0]).toBe(conv[0]);
    expect(out[out.length - 1]).toBe(conv[conv.length - 1]);
  });

  it('honors an explicit smaller window', () => {
    const conv = build(10);
    const out = windowConversation(conv, 4);
    expect(out.length).toBe(4);
    expect(out[0]).toBe(conv[0]); // opener
    expect(out.slice(1)).toEqual(conv.slice(-3)); // freshest 3
  });

  it('degrades to a plain tail for degenerate windows (< 2)', () => {
    const conv = build(5);
    expect(windowConversation(conv, 1)).toEqual([conv[4]]);
    expect(windowConversation(conv, 0)).toEqual([]);
  });

  it('handles empty and single-message transcripts', () => {
    expect(windowConversation([])).toEqual([]);
    const one = build(1);
    expect(windowConversation(one)).toEqual(one);
  });

  it('does not mutate the input array', () => {
    const conv = build(MAX_CONVERSATION_CONTEXT_MESSAGES + 3);
    const copy = conv.slice();
    windowConversation(conv);
    expect(conv).toEqual(copy);
  });
});
