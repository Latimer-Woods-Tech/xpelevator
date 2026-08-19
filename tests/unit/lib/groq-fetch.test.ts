/**
 * Unit tests for the model-fallback resilience layer in src/lib/groq-fetch.ts.
 *
 * PROOF-OF-REJECTION (Standing Law 1, #248 / #16): these tests reproduce the
 * exact ~2-day outage — a primary model returning `400 model_decommissioned` —
 * and assert the client now degrades to a live fallback model instead of
 * throwing. If the ladder regresses, `chatCompletion`/`chatCompletionStream`
 * throw again and `scoreSession` returns `[]` (a null score), failing these
 * tests on precisely the #248 condition. The 401 test guards the other
 * direction: an auth failure must NOT trigger a fallback (which would mask the
 * expired-credential alarm).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { GroqFetchClient, GroqApiError } from '@/lib/groq-fetch';
import { scoreSession } from '@/lib/ai';

// ── fetch response helpers ────────────────────────────────────────────────────

/** A non-streaming Groq completion Response echoing `content` + `model`. */
function completion(content: string, model = 'test') {
  return new Response(
    JSON.stringify({
      id: 'cmpl-test',
      object: 'chat.completion',
      created: 0,
      model,
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

/** A Groq error Response with the given status + raw body. */
function errorResponse(status: number, body: string) {
  return new Response(body, { status, headers: { 'content-type': 'application/json' } });
}

/** The #248 signature: a 400 decommissioning the requested model. */
function decommissioned() {
  return errorResponse(
    400,
    '{"error":{"code":"model_decommissioned","message":"model has been decommissioned"}}',
  );
}

/** A single-token SSE stream returning `token`. */
function streamOf(token: string) {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: token } }] })}\n\n`));
      controller.enqueue(enc.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

/** The model id sent on the Nth fetch call (parsed from the request body). */
function modelOfCall(mock: ReturnType<typeof vi.fn>, n: number): string {
  return JSON.parse(mock.mock.calls[n][1].body).model;
}

// ── globals ───────────────────────────────────────────────────────────────────

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.GROQ_API_KEY = 'gsk_test_unit_key';
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('chatCompletion — model fallback', () => {
  it('degrades a decommissioned primary to the live fallback model', async () => {
    fetchMock
      .mockResolvedValueOnce(decommissioned()) // openai/gpt-oss-120b → gone
      .mockResolvedValueOnce(completion('recovered', 'openai/gpt-oss-20b')); // fallback OK

    const client = new GroqFetchClient('gsk_test_unit_key');
    const res = await client.chatCompletion({
      model: 'openai/gpt-oss-120b',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(res.choices[0].message.content).toBe('recovered');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(modelOfCall(fetchMock, 0)).toBe('openai/gpt-oss-120b');
    expect(modelOfCall(fetchMock, 1)).toBe('openai/gpt-oss-20b'); // walked the ladder
  });

  it('makes exactly one call on the happy path (no fallback)', async () => {
    fetchMock.mockResolvedValueOnce(completion('ok'));
    const client = new GroqFetchClient('gsk_test_unit_key');
    await client.chatCompletion({
      model: 'openai/gpt-oss-120b',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT fall back on a 401 — the auth error surfaces unchanged', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(401, 'invalid_api_key'));
    const client = new GroqFetchClient('gsk_test_unit_key');

    await expect(
      client.chatCompletion({
        model: 'openai/gpt-oss-120b',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toBeInstanceOf(GroqApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1); // no second model tried
  });

  it('throws the last error when every model in the chain is unavailable', async () => {
    fetchMock
      .mockResolvedValueOnce(decommissioned())
      .mockResolvedValueOnce(decommissioned());
    const client = new GroqFetchClient('gsk_test_unit_key');

    await expect(
      client.chatCompletion({
        model: 'openai/gpt-oss-120b',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toBeInstanceOf(GroqApiError);
    expect(fetchMock).toHaveBeenCalledTimes(2); // primary + one fallback
  });
});

describe('chatCompletionStream — model fallback', () => {
  it('falls back before the first token, then streams the fallback model', async () => {
    fetchMock
      .mockResolvedValueOnce(decommissioned())
      .mockResolvedValueOnce(streamOf('hello'));

    const client = new GroqFetchClient('gsk_test_unit_key');
    const out: string[] = [];
    for await (const chunk of client.chatCompletionStream({
      model: 'openai/gpt-oss-120b',
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      out.push(chunk);
    }

    expect(out.join('')).toBe('hello');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(modelOfCall(fetchMock, 1)).toBe('openai/gpt-oss-20b');
  });

  it('does NOT fall back a stream on a 429 rate-limit', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(429, 'rate_limit_exceeded'));
    const client = new GroqFetchClient('gsk_test_unit_key');

    await expect(async () => {
      for await (const _ of client.chatCompletionStream({
        model: 'openai/gpt-oss-120b',
        messages: [{ role: 'user', content: 'hi' }],
      })) {
        void _;
      }
    }).rejects.toBeInstanceOf(GroqApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('scoreSession — end-to-end #248 reproduction', () => {
  it('still returns scores when the scoring model is decommissioned', async () => {
    // Primary scoring model gone; fallback returns a valid judge JSON.
    fetchMock
      .mockResolvedValueOnce(decommissioned())
      .mockResolvedValueOnce(
        completion('[{"criteriaIndex":1,"score":7,"justification":"clear"}]', 'openai/gpt-oss-20b'),
      );

    const scores = await scoreSession(
      [
        { role: 'CUSTOMER', content: 'my internet is down' },
        { role: 'AGENT', content: 'let me help you with that' },
      ],
      [{ id: 'c1', name: 'Empathy', description: null, weight: 8 }],
    );

    // Before the ladder this returned [] (a null score) — the #248 outage.
    expect(scores).toHaveLength(1);
    expect(scores[0].score).toBe(7);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
