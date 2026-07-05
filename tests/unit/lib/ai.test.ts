/**
 * Unit tests for src/lib/ai.ts
 *
 * Bridges tested:
 *   1. System prompt construction        — bridge 3 entrance gate
 *   2. Prompt personalises per difficulty — bridge guard checks ticket
 *   3. Fallback script when no script     — missing bridge still passable
 *   4. scoreSession parses valid JSON     — man crosses successfully
 *   6. scoreSession handles bad JSON      — bridge survives a fall, returns []
 *   7. scoreSession clamps scores 1–10   — no one falls off the edge
 *   8. scoreSession returns [] for empty criteria — no bridge, no crossing
 *   9. streamNextCustomerMessage yields tokens — foot-by-foot crossing
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Types for the mocked Groq client ─────────────────────────────────────────

type CompletionResponse = {
  choices: Array<{ message: { content: string } }>;
};

type StreamChunk = {
  choices: Array<{ delta: { content?: string } }>;
};

// ── Mock groq-sdk BEFORE importing ai.ts ─────────────────────────────────────
// vi.hoisted ensures mockCreate is defined before the vi.mock factory runs
const mockCreate = vi.hoisted(() => vi.fn());

vi.mock('groq-sdk', () => {
  // Use a real class so `new Groq(...)` doesn't throw "not a constructor"
  class MockGroq {
    chat = { completions: { create: mockCreate } };
  }
  return { default: MockGroq };
});

// ── Import ai.ts AFTER mock ───────────────────────────────────────────────────
import {
  buildSessionSystemPrompt,
  generateResponse,
  scoreSession,
  streamNextCustomerMessage,
} from '@/lib/ai';

// ─────────────────────────────────────────────────────────────────────────────

const SAMPLE_SCRIPT = {
  customerPersona: 'A frustrated elderly customer who lost their internet connection.',
  customerObjective: 'Get their internet restored before their telehealth appointment.',
  difficulty: 'hard' as const,
  hints: ['Customer has been on hold for 30 minutes.'],
};

const SAMPLE_CRITERIA = [
  { id: 'c1', name: 'Empathy', description: 'Shows empathy toward the customer', weight: 8 },
  { id: 'c2', name: 'Resolution', description: 'Resolves the issue effectively', weight: 10 },
];

describe('lib/ai — buildSessionSystemPrompt', () => {
  it('includes customer persona in the system prompt', () => {
    const prompt = buildSessionSystemPrompt('Internet Outage', SAMPLE_SCRIPT);
    expect(prompt).toContain(SAMPLE_SCRIPT.customerPersona);
  });

  it('includes customer objective in the system prompt', () => {
    const prompt = buildSessionSystemPrompt('Internet Outage', SAMPLE_SCRIPT);
    expect(prompt).toContain(SAMPLE_SCRIPT.customerObjective);
  });

  it('includes difficulty level (HARD) in uppercase', () => {
    const prompt = buildSessionSystemPrompt('Internet Outage', SAMPLE_SCRIPT);
    expect(prompt).toContain('HARD');
  });

  it('includes hard-difficulty behavioural guidance', () => {
    const prompt = buildSessionSystemPrompt('Internet Outage', SAMPLE_SCRIPT);
    expect(prompt.toLowerCase()).toContain('frustrated');
  });

  it('lists hints when provided', () => {
    const prompt = buildSessionSystemPrompt('Internet Outage', SAMPLE_SCRIPT);
    expect(prompt).toContain('on hold for 30 minutes');
  });

  it('uses fallback script when input has no customerPersona', () => {
    const prompt = buildSessionSystemPrompt('Generic Scenario', {});
    expect(prompt).toContain('A customer who needs assistance');
  });

  it('uses fallback script when input is null', () => {
    const prompt = buildSessionSystemPrompt('Generic Scenario', null);
    expect(prompt).toContain('A customer who needs assistance');
  });

  it('uses medium difficulty fallback guidance when no script', () => {
    const prompt = buildSessionSystemPrompt('Generic Scenario', null);
    expect(prompt.toLowerCase()).toContain('mildly frustrated');
  });

  it('does NOT include hints section when hints array is empty', () => {
    const scriptNoHints = { ...SAMPLE_SCRIPT, hints: [] };
    const prompt = buildSessionSystemPrompt('Test', scriptNoHints);
    expect(prompt).not.toContain('SITUATION CUES');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('lib/ai — generateResponse', () => {
  beforeEach(() => mockCreate.mockReset());

  it('returns the AI message content', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'Hello, I need help with my bill.' } }],
    });

    const result = await generateResponse([{ role: 'user', content: 'Hi' }]);
    expect(result).toBe('Hello, I need help with my bill.');
  });

  it('returns empty string when choices is empty', async () => {
    mockCreate.mockResolvedValueOnce({ choices: [] });
    const result = await generateResponse([]);
    expect(result).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('lib/ai — scoreSession', () => {
  beforeEach(() => mockCreate.mockReset());

  it('returns empty array when no criteria provided', async () => {
    const result = await scoreSession(
      [{ role: 'AGENT', content: 'How can I help?' }],
      []
    );
    expect(result).toEqual([]);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('parses valid JSON scoring response', async () => {
    const scores = [
      { criteriaIndex: 1, score: 8, justification: 'Agent showed empathy.' },
      { criteriaIndex: 2, score: 9, justification: 'Issue was fully resolved.' },
    ];
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify(scores) } }],
    });

    const transcript = [
      { role: 'CUSTOMER' as const, content: 'My internet is down.' },
      { role: 'AGENT' as const, content: "I'm sorry to hear that. Let me fix it now." },
    ];

    const result = await scoreSession(transcript, SAMPLE_CRITERIA);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ criteriaId: 'c1', score: 8 });
    expect(result[1]).toMatchObject({ criteriaId: 'c2', score: 9 });
    expect(result[0].criteriaName).toBe('Empathy');
  });

  it('handles JSON wrapped in markdown code fences', async () => {
    const raw = '```json\n[{"criteriaIndex":1,"score":7,"justification":"Good."}]\n```';
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: raw } }] });

    const result = await scoreSession(
      [{ role: 'AGENT', content: 'Hello!' }],
      [SAMPLE_CRITERIA[0]]
    );
    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(7);
  });

  it('clamps scores to 1–10 range', async () => {
    const raw = JSON.stringify([
      { criteriaIndex: 1, score: 15, justification: 'Great.' },
      { criteriaIndex: 2, score: -3, justification: 'Terrible.' },
    ]);
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: raw } }] });

    const result = await scoreSession(
      [{ role: 'AGENT', content: 'Hello!' }],
      SAMPLE_CRITERIA
    );
    expect(result[0].score).toBe(10); // clamped from 15
    expect(result[1].score).toBe(1);  // clamped from -3
  });

  it('returns [] when AI returns malformed JSON', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'NOT VALID JSON {{{' } }],
    });

    const result = await scoreSession(
      [{ role: 'AGENT', content: 'Hello!' }],
      SAMPLE_CRITERIA
    );
    expect(result).toEqual([]);
  });

  it('filters out criteria indices that are out of range', async () => {
    const raw = JSON.stringify([
      { criteriaIndex: 99, score: 8, justification: 'Out of range.' },
      { criteriaIndex: 1, score: 7, justification: 'Valid.' },
    ]);
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: raw } }] });

    const result = await scoreSession(
      [{ role: 'AGENT', content: 'Hi' }],
      [SAMPLE_CRITERIA[0]]
    );
    expect(result).toHaveLength(1); // only the valid one
    expect(result[0].criteriaIndex).toBeUndefined(); // not in output shape
    expect(result[0].criteriaId).toBe('c1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('lib/ai — streamNextCustomerMessage', () => {
  beforeEach(() => mockCreate.mockReset());

  it('yields streamed tokens from Groq', async () => {
    async function* mockStream(): AsyncGenerator<StreamChunk> {
      yield { choices: [{ delta: { content: 'My ' } }] };
      yield { choices: [{ delta: { content: 'internet ' } }] };
      yield { choices: [{ delta: { content: 'is down.' } }] };
    }

    mockCreate.mockResolvedValueOnce(mockStream());

    const systemPrompt = buildSessionSystemPrompt('Internet Outage', SAMPLE_SCRIPT);
    const tokens: string[] = [];
    for await (const token of streamNextCustomerMessage(systemPrompt, [])) {
      tokens.push(token);
    }

    expect(tokens).toEqual(['My ', 'internet ', 'is down.']);
    expect(tokens.join('')).toBe('My internet is down.');
  });

  it('skips chunks with no delta content', async () => {
    async function* mockStream(): AsyncGenerator<StreamChunk> {
      yield { choices: [{ delta: {} }] };          // no content
      yield { choices: [{ delta: { content: 'Hello!' } }] };
    }

    mockCreate.mockResolvedValueOnce(mockStream());

    const tokens: string[] = [];
    for await (const token of streamNextCustomerMessage('prompt', [])) {
      tokens.push(token);
    }
    expect(tokens).toEqual(['Hello!']);
  });
});
