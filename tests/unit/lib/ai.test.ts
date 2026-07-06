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
});
