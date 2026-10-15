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

import { GroqFetchClient, GroqApiError, pickStreamTokenUsage } from '@/lib/groq-fetch';
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

type TokenUsage = { prompt_tokens: number; completion_tokens: number; total_tokens: number };

/**
 * An SSE stream that yields one content token, then a terminal usage chunk
 * (empty `choices`) carrying the token block where `where` puts it — mirroring
 * the two shapes Groq actually emits `include_usage` in: top-level `usage`, or
 * nested under the vendor `x_groq.usage` envelope.
 */
function streamWithUsage(token: string, where: 'top' | 'x_groq', usage: TokenUsage) {
  const enc = new TextEncoder();
  const terminal =
    where === 'top'
      ? { choices: [], usage }
      : { choices: [], x_groq: { id: 'req_test', usage } };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: token } }] })}\n\n`));
      controller.enqueue(enc.encode(`data: ${JSON.stringify(terminal)}\n\n`));
      controller.enqueue(enc.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

/** Drive a stream to completion, returning the captured usage (or null). */
async function captureStreamUsage(res: Response): Promise<TokenUsage | null> {
  fetchMock.mockResolvedValueOnce(res);
  const client = new GroqFetchClient('gsk_test_unit_key');
  let captured: TokenUsage | null = null;
  for await (const _ of client.chatCompletionStream(
    { model: 'openai/gpt-oss-120b', messages: [{ role: 'user', content: 'hi' }] },
    (u) => {
      captured = u as TokenUsage;
    },
  )) {
    void _;
  }
  return captured;
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

describe('chatCompletionStream — per-turn token usage capture (R-132, #155)', () => {
  // PROOF-OF-REJECTION (Standing Law 1): the live scoring canary caught per-turn
  // Groq token accounting silently nulling on 2026-10-05 (alert #278) — the
  // reply row's usage columns went NULL with no code change because the parse
  // read ONLY top-level `usage`, and the usage block was arriving under the
  // vendor `x_groq.usage` envelope. Nothing unit-tested the real stream→onUsage
  // parse (only the write path downstream of it), so the shift was invisible
  // until the Phase-4 wholesale-seat margin input (#155) had been null for days.
  // These are that missing test.
  const usage: TokenUsage = { prompt_tokens: 321, completion_tokens: 42, total_tokens: 363 };

  it('captures usage carried at the top-level `usage` field', async () => {
    expect(await captureStreamUsage(streamWithUsage('hi', 'top', usage))).toEqual(usage);
  });

  it('captures usage carried under the `x_groq.usage` envelope (the #278 regression)', async () => {
    // Before pickStreamTokenUsage this returned null → the reply row's token
    // columns were NULL → the canary's token-usage gate went red.
    expect(await captureStreamUsage(streamWithUsage('hi', 'x_groq', usage))).toEqual(usage);
  });

  it('leaves usage uncaptured when no chunk carries a valid block', async () => {
    expect(await captureStreamUsage(streamOf('hi'))).toBeNull();
  });
});

describe('pickStreamTokenUsage — tolerant usage extraction', () => {
  const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };

  it('reads the OpenAI-compatible top-level `usage`', () => {
    expect(pickStreamTokenUsage({ choices: [], usage })).toEqual(usage);
  });

  it('reads the vendor `x_groq.usage` envelope', () => {
    expect(pickStreamTokenUsage({ choices: [], x_groq: { usage } })).toEqual(usage);
  });

  it('prefers top-level `usage` when both are present', () => {
    const other = { prompt_tokens: 99, completion_tokens: 9, total_tokens: 108 };
    expect(pickStreamTokenUsage({ usage, x_groq: { usage: other } })).toEqual(usage);
  });

  it('returns null for a content chunk, a malformed block, or a non-object', () => {
    expect(pickStreamTokenUsage({ choices: [{ delta: { content: 'x' } }] })).toBeNull();
    expect(pickStreamTokenUsage({ usage: { prompt_tokens: 1 } })).toBeNull();
    expect(pickStreamTokenUsage({ x_groq: { usage: { total_tokens: 'nope' } } })).toBeNull();
    expect(pickStreamTokenUsage(null)).toBeNull();
    expect(pickStreamTokenUsage('string')).toBeNull();
  });

  // The #296 live shape: PR #295 taught the parser `usage` and `x_groq.usage`,
  // yet the live `openai/gpt-oss-*` stream stayed red — the block reaches
  // NEITHER named location. The bounded deep-search is the net that tolerates
  // an unanticipated nesting so a future block move cannot silently null spend.
  it('finds a usage block nested at an unanticipated path (the #296 net)', () => {
    expect(
      pickStreamTokenUsage({ choices: [], x_groq: { meta: { usage } } })
    ).toEqual(usage);
    expect(
      pickStreamTokenUsage({ choices: [{ delta: {}, finish_reason: 'stop' }], response: { usage } })
    ).toEqual(usage);
  });

  // Proof-of-rejection (Standing Law 1): the deep-search must NOT be fooled by a
  // partial block (prompt-only) or a usage-details sub-object — otherwise the
  // canary would go green on a wrong number.
  it('deep-search rejects partials and *_tokens_details sub-objects', () => {
    expect(
      pickStreamTokenUsage({ x_groq: { usage: { completion_tokens_details: { reasoning_tokens: 7 } } } })
    ).toBeNull();
    expect(
      pickStreamTokenUsage({ deeply: { nested: { partial: { prompt_tokens: 3 } } } })
    ).toBeNull();
  });

  it('deep-search still prefers the canonical top-level `usage` over a nested one', () => {
    const other = { prompt_tokens: 99, completion_tokens: 9, total_tokens: 108 };
    expect(pickStreamTokenUsage({ usage, nested: { deep: { usage: other } } })).toEqual(usage);
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

// ─────────────────────────────────────────────────────────────────────────────

describe('listModels — the non-billable probe behind /api/debug/groq (W1.12)', () => {
  it('GETs /v1/models (never /chat/completions) and returns the offered ids', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [{ id: 'openai/gpt-oss-120b' }, { id: 'openai/gpt-oss-20b' }, { foo: 1 }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const client = new GroqFetchClient('gsk_test_unit_key');
    const ids = await client.listModels();

    expect(ids).toEqual(['openai/gpt-oss-120b', 'openai/gpt-oss-20b']);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.groq.com/openai/v1/models');
    expect(init?.method ?? 'GET').toBe('GET');
    expect(init?.body).toBeUndefined();
  });

  it('throws a GroqApiError carrying the status on a rejected credential', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(401, '{"error":{"message":"Invalid API Key"}}'));

    const client = new GroqFetchClient('gsk_test_unit_key');
    const err = await client.listModels().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(GroqApiError);
    expect((err as GroqApiError).status).toBe(401);
  });
});
