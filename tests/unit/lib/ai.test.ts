/**
 * Unit tests for src/lib/ai.ts
 *
 * The scoring/generation stack calls the Groq HTTP API through
 * getGroqClient() -> GroqFetchClient (raw fetch, Cloudflare-Workers safe).
 * We stub global fetch and provide a non-placeholder GROQ_API_KEY so the
 * real client code runs against controlled responses — this exercises both
 * ai.ts logic AND groq-fetch's SSE parsing (empty-delta skipping, etc.).
 *
 * Covered:
 *   1. System prompt construction        — persona/objective/difficulty/hints
 *   2. Fallback script when no script     — default customer still renders
 *   3. generateResponse returns content   — and '' when choices empty
 *   4. scoreSession parses valid JSON, strips markdown fences, clamps 1–10,
 *      tolerates malformed JSON ([]), filters out-of-range criteria indices
 *   5. streamNextCustomerMessage yields streamed tokens + skips empty deltas
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  buildSessionSystemPrompt,
  generateResponse,
  scoreSession,
  streamNextCustomerMessage,
  customerModelForDifficulty,
  resolveScenarioDifficulty,
} from '@/lib/ai';

// ── fetch response helpers ────────────────────────────────────────────────────

/** Build a non-streaming Groq chat/completions Response with the given text. */
function completionResponse(content: string) {
  return new Response(
    JSON.stringify({
      id: 'cmpl-test',
      object: 'chat.completion',
      created: 0,
      model: 'test',
      choices: [
        { index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' },
      ],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}

/** Build a Groq Response whose choices array is empty. */
function emptyChoicesResponse() {
  return new Response(JSON.stringify({ choices: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Build a streaming (SSE) Groq Response. Each entry becomes a `data:` frame;
 * `null` emits a chunk with an empty delta (no content) to exercise skipping.
 */
function streamResponse(deltas: Array<string | null>) {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const d of deltas) {
        const frame =
          d === null
            ? { choices: [{ delta: {} }] }
            : { choices: [{ delta: { content: d } }] };
        controller.enqueue(enc.encode(`data: ${JSON.stringify(frame)}\n\n`));
      }
      controller.enqueue(enc.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

// ── globals ───────────────────────────────────────────────────────────────────

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // Non-placeholder key so getGroqClient() resolves a client (not 'dummy-*').
  process.env.GROQ_API_KEY = 'gsk_test_unit_key';
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it('does NOT include a context-details section when hints array is empty', () => {
    const scriptNoHints = { ...SAMPLE_SCRIPT, hints: [] };
    const prompt = buildSessionSystemPrompt('Test', scriptNoHints);
    expect(prompt).not.toContain('CONTEXT DETAILS');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Emotional-state determinism (E-root #3, #16 — "half-speed sparring" realism).
// The system prompt is rebuilt on EVERY turn (chat + telnyx routes), so any
// randomness in it re-rolls the customer's mood mid-session. These tests lock in
// that the mood is FIXED for a session (keyed on scenario + session seed) yet
// still varies across sessions.

/** The emotional-state values by difficulty — mirror of src/lib/ai.ts. */
const EMOTIONAL_STATES: Record<string, string[]> = {
  easy: ['mildly inconvenienced', 'politely impatient', 'calm but pressed for time'],
  medium: ['noticeably frustrated', 'stressed', 'short-tempered but not rude'],
  hard: ['angry', 'extremely frustrated', 'borderline rude — demanding immediate action'],
};

/** Pull the "Emotional state right now: X" line out of a built prompt. */
function emotionalStateOf(prompt: string): string {
  const m = prompt.match(/Emotional state right now: (.+)/);
  if (!m) throw new Error('prompt has no emotional-state line');
  return m[1].trim();
}

describe('lib/ai — emotional-state determinism (E-root #3)', () => {
  it('does NOT re-roll the mood across turns: same (scenario, seed) is stable', () => {
    const first = emotionalStateOf(
      buildSessionSystemPrompt('Internet Outage', SAMPLE_SCRIPT, 'session-abc')
    );
    // The chat/telnyx routes rebuild the prompt every turn — simulate 25 turns.
    for (let turn = 0; turn < 25; turn++) {
      const again = emotionalStateOf(
        buildSessionSystemPrompt('Internet Outage', SAMPLE_SCRIPT, 'session-abc')
      );
      expect(again).toBe(first);
    }
  });

  it('never calls Math.random() when building the prompt (reroll removed)', () => {
    const spy = vi.spyOn(Math, 'random');
    buildSessionSystemPrompt('Internet Outage', SAMPLE_SCRIPT, 'session-abc');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('picks a mood from the scenario difficulty tier (hard)', () => {
    const state = emotionalStateOf(
      buildSessionSystemPrompt('Internet Outage', SAMPLE_SCRIPT, 'session-abc')
    );
    expect(EMOTIONAL_STATES.hard).toContain(state);
  });

  it('picks a mood from the medium tier when the script has no difficulty', () => {
    const state = emotionalStateOf(buildSessionSystemPrompt('Generic', null, 'session-xyz'));
    expect(EMOTIONAL_STATES.medium).toContain(state);
  });

  it('varies mood across sessions while staying deterministic per seed', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const seed = `session-${i}`;
      const a = emotionalStateOf(buildSessionSystemPrompt('Internet Outage', SAMPLE_SCRIPT, seed));
      const b = emotionalStateOf(buildSessionSystemPrompt('Internet Outage', SAMPLE_SCRIPT, seed));
      expect(b).toBe(a); // deterministic for a given seed
      seen.add(a);
    }
    // Across 30 sessions we should exercise more than one mood (variety preserved).
    expect(seen.size).toBeGreaterThan(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('lib/ai — generateResponse', () => {
  it('returns the message content', async () => {
    fetchMock.mockResolvedValueOnce(
      completionResponse('Hello, I need help with my bill.')
    );
    const result = await generateResponse([{ role: 'user', content: 'Hi' }]);
    expect(result).toBe('Hello, I need help with my bill.');
  });

  it('returns empty string when choices is empty', async () => {
    fetchMock.mockResolvedValueOnce(emptyChoicesResponse());
    const result = await generateResponse([]);
    expect(result).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('lib/ai — scoreSession', () => {
  it('returns empty array when no criteria provided (no API call)', async () => {
    const result = await scoreSession(
      [{ role: 'AGENT', content: 'How can I help?' }],
      []
    );
    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('parses valid JSON scoring response', async () => {
    const scores = [
      { criteriaIndex: 1, score: 8, justification: 'Agent showed empathy.' },
      { criteriaIndex: 2, score: 9, justification: 'Issue was fully resolved.' },
    ];
    fetchMock.mockResolvedValueOnce(completionResponse(JSON.stringify(scores)));

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
    fetchMock.mockResolvedValueOnce(completionResponse(raw));

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
    fetchMock.mockResolvedValueOnce(completionResponse(raw));

    const result = await scoreSession(
      [{ role: 'AGENT', content: 'Hello!' }],
      SAMPLE_CRITERIA
    );
    expect(result[0].score).toBe(10); // clamped from 15
    expect(result[1].score).toBe(1); // clamped from -3
  });

  it('returns [] when the model returns malformed JSON', async () => {
    fetchMock.mockResolvedValueOnce(completionResponse('NOT VALID JSON {{{'));

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
    fetchMock.mockResolvedValueOnce(completionResponse(raw));

    const result = await scoreSession(
      [{ role: 'AGENT', content: 'Hi' }],
      [SAMPLE_CRITERIA[0]]
    );
    expect(result).toHaveLength(1); // only the valid one
    expect(result[0].criteriaId).toBe('c1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('lib/ai — streamNextCustomerMessage', () => {
  it('yields streamed tokens from Groq', async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse(['My ', 'internet ', 'is down.'])
    );

    const systemPrompt = buildSessionSystemPrompt('Internet Outage', SAMPLE_SCRIPT);
    const tokens: string[] = [];
    for await (const token of streamNextCustomerMessage(systemPrompt, [])) {
      tokens.push(token);
    }

    expect(tokens).toEqual(['My ', 'internet ', 'is down.']);
    expect(tokens.join('')).toBe('My internet is down.');
  });

  it('skips chunks with no delta content', async () => {
    fetchMock.mockResolvedValueOnce(streamResponse([null, 'Hello!']));

    const tokens: string[] = [];
    for await (const token of streamNextCustomerMessage('prompt', [])) {
      tokens.push(token);
    }
    expect(tokens).toEqual(['Hello!']);
  });

  it('defaults to the realism (70B) model when no model is passed', async () => {
    fetchMock.mockResolvedValueOnce(streamResponse(['ok']));

    for await (const _ of streamNextCustomerMessage('prompt', [])) {
      /* drain */
    }

    const [, init] = fetchMock.mock.calls[0];
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent.model).toBe('llama-3.3-70b-versatile');
  });

  it('sends the model it is given to Groq (fast tier)', async () => {
    fetchMock.mockResolvedValueOnce(streamResponse(['ok']));

    for await (const _ of streamNextCustomerMessage(
      'prompt',
      [],
      'llama-3.1-8b-instant'
    )) {
      /* drain */
    }

    const [, init] = fetchMock.mock.calls[0];
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent.model).toBe('llama-3.1-8b-instant');
    expect(sent.stream).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('lib/ai — customerModelForDifficulty', () => {
  it('keeps the realism (70B) model for HARD scenarios', () => {
    expect(customerModelForDifficulty('hard')).toBe('llama-3.3-70b-versatile');
  });

  it('uses the fast (8B) model for easy and medium', () => {
    expect(customerModelForDifficulty('easy')).toBe('llama-3.1-8b-instant');
    expect(customerModelForDifficulty('medium')).toBe('llama-3.1-8b-instant');
  });

  it('falls back to the fast (8B) model for unknown/undefined difficulty', () => {
    expect(customerModelForDifficulty(undefined)).toBe('llama-3.1-8b-instant');
    expect(customerModelForDifficulty('impossible')).toBe('llama-3.1-8b-instant');
  });
});

describe('lib/ai — resolveScenarioDifficulty', () => {
  it('returns the script difficulty when valid', () => {
    expect(resolveScenarioDifficulty({ difficulty: 'hard' })).toBe('hard');
    expect(resolveScenarioDifficulty({ difficulty: 'easy' })).toBe('easy');
  });

  it('falls back to medium for missing/invalid/null scripts', () => {
    expect(resolveScenarioDifficulty(null)).toBe('medium');
    expect(resolveScenarioDifficulty({})).toBe('medium');
    expect(resolveScenarioDifficulty({ difficulty: 'nope' })).toBe('medium');
  });

  it('maps a hard scenario to realism and a medium one to the fast tier', () => {
    // End-to-end of the two helpers as the route composes them.
    expect(
      customerModelForDifficulty(resolveScenarioDifficulty({ difficulty: 'hard' }))
    ).toBe('llama-3.3-70b-versatile');
    expect(
      customerModelForDifficulty(resolveScenarioDifficulty({ difficulty: 'medium' }))
    ).toBe('llama-3.1-8b-instant');
  });
});
