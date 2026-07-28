/**
 * Deterministic tests for `useChatSession` — the client-side session state
 * machine + SSE message loop shared by chat and voice modes (issue #16, P2-8;
 * the remaining untested half of the voice path after the `src/app/api/**`
 * coverage-gate sweep completed in #170/#172/#173).
 *
 * Every seam is mocked — `global.fetch` returns hand-built responses (a plain
 * object with `.body` as a real `ReadableStream<Uint8Array>` for the SSE path,
 * or `.json()` for the load/end paths). No live Neon/Groq/Telnyx, no DOM APIs
 * beyond the happy-dom environment `renderHook` needs. The pure
 * `splitSpeechChunks` helper runs for real (it is covered under the src/lib
 * gate), so the speech-chunk emission path is genuinely exercised.
 *
 * Environment: happy-dom (vitest environmentMatchGlobs, tests/ui/**)
 * Run:  npx vitest tests/ui/use-chat-session.test.tsx
 */
// @vitest-environment happy-dom

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import { useChatSession } from '@/hooks/useChatSession';
import type { Message, SimulationSession } from '@/types';

// ── Test data ────────────────────────────────────────────────────────────────
const SESSION_ID = 'sess-123';

function makeSession(
  overrides: Partial<SimulationSession> = {}
): SimulationSession {
  const messages: Message[] = overrides.messages ?? [
    { id: 'm1', role: 'AGENT', content: 'Hi there', timestamp: '2026-07-28T00:00:00.000Z' },
  ];
  return {
    id: SESSION_ID,
    status: 'IN_PROGRESS',
    type: 'CHAT',
    startedAt: '2026-07-28T00:00:00.000Z',
    endedAt: null,
    createdAt: '2026-07-28T00:00:00.000Z',
    messages,
    scores: [],
    scenario: { name: 'Angry Customer', description: null, type: 'CHAT' },
    jobTitle: { name: 'Support Agent' },
    ...overrides,
  };
}

// ── Response builders ────────────────────────────────────────────────────────
type FetchResponse = {
  ok: boolean;
  headers: { get: (h: string) => string | null };
  body?: ReadableStream<Uint8Array>;
  json: () => Promise<unknown>;
};

function header(contentType: string | null) {
  return {
    get: (h: string) => (h.toLowerCase() === 'content-type' ? contentType : null),
  };
}

/** A JSON (non-streaming) response — used for load, end-session, and error bodies. */
function jsonResponse(obj: unknown, ok = true): FetchResponse {
  return { ok, headers: header('application/json'), json: async () => obj };
}

/** An SSE response whose `.body` streams the given `data:` frames as UTF-8 chunks. */
function sseResponse(frames: string[]): FetchResponse {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(enc.encode(f));
      controller.close();
    },
  });
  return { ok: true, headers: header('text/event-stream'), body, json: async () => ({}) };
}

/** Serialize one SSE `data:` frame the hook's line-parser understands. */
function frame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/**
 * Install a fetch mock that routes by method:
 *  - GET  /api/chat?sessionId=  → the load body (first) then `getUpdated()`
 *  - POST /api/chat             → `postFn()`
 */
function installFetch(opts: {
  load: () => FetchResponse;
  post?: () => FetchResponse;
  getUpdated?: () => FetchResponse;
}) {
  let getCalls = 0;
  const fn = vi.fn(async (_url: string, init?: { method?: string }) => {
    if (init?.method === 'POST') return opts.post ? opts.post() : jsonResponse({});
    getCalls += 1;
    if (getCalls === 1) return opts.load();
    return opts.getUpdated ? opts.getUpdated() : opts.load();
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useChatSession — load on mount', () => {
  it('loads an in-progress session and clears loading', async () => {
    const session = makeSession();
    installFetch({ load: () => jsonResponse(session) });

    const { result } = renderHook(() => useChatSession(SESSION_ID));
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.session?.id).toBe(SESSION_ID);
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.ended).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('marks ended when the loaded session is already COMPLETED', async () => {
    installFetch({ load: () => jsonResponse(makeSession({ status: 'COMPLETED' })) });
    const { result } = renderHook(() => useChatSession(SESSION_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.ended).toBe(true);
  });

  it('marks ended when the loaded session is CANCELLED', async () => {
    installFetch({ load: () => jsonResponse(makeSession({ status: 'CANCELLED' })) });
    const { result } = renderHook(() => useChatSession(SESSION_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.ended).toBe(true);
  });

  it('surfaces a load error when the session fetch is not ok', async () => {
    installFetch({ load: () => jsonResponse({ error: 'nope' }, false) });
    const { result } = renderHook(() => useChatSession(SESSION_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Session not found');
    expect(result.current.session).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useChatSession — sendMessage streaming', () => {
  async function mounted(post: () => FetchResponse, getUpdated?: () => FetchResponse) {
    const fetchFn = installFetch({ load: () => jsonResponse(makeSession()), post, getUpdated });
    const hook = renderHook(() => useChatSession(SESSION_ID));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    return { ...hook, fetchFn };
  }

  it('streams chunks, appends the customer reply, and emits speech chunks + timing', async () => {
    const timing = { ttftMs: 120, totalMs: 640, tier: 'realtime' as const };
    const post = () =>
      sseResponse([
        frame({ type: 'chunk', content: 'Hello there. ' }),
        frame({ type: 'chunk', content: 'How can you help me? ' }),
        frame({ type: 'done', content: 'Hello there. How can you help me?', timing }),
      ]);
    const { result } = await mounted(post);

    await act(async () => {
      await result.current.sendMessage('I can reset your password');
    });

    // optimistic AGENT turn + the CUSTOMER reply appended to the mount message
    const roles = result.current.messages.map(m => m.role);
    expect(roles).toContain('AGENT');
    expect(roles).toContain('CUSTOMER');
    expect(result.current.lastAiMessage).toBe('Hello there. How can you help me?');
    expect(result.current.streamingText).toBe(''); // cleared on done
    expect(result.current.speechChunks.length).toBeGreaterThan(0);
    expect(result.current.lastTiming).toEqual(timing);
    expect(result.current.sending).toBe(false);
  });

  it('handles a session_ending frame (adds reply) then session_ended (re-fetches + ends)', async () => {
    const ended = makeSession({
      status: 'COMPLETED',
      messages: [
        { id: 'm1', role: 'AGENT', content: 'Hi there', timestamp: '2026-07-28T00:00:00.000Z' },
        { id: 'm2', role: 'CUSTOMER', content: 'Thanks, goodbye.', timestamp: '2026-07-28T00:01:00.000Z' },
      ],
    });
    const post = () =>
      sseResponse([
        frame({ type: 'session_ending', content: 'Thanks, goodbye.' }),
        frame({ type: 'session_ended' }),
      ]);
    const { result } = await mounted(post, () => jsonResponse(ended));

    await act(async () => {
      await result.current.sendMessage('You are all set');
    });

    expect(result.current.lastAiMessage).toBe('Thanks, goodbye.');
    expect(result.current.ended).toBe(true);
    expect(result.current.session?.status).toBe('COMPLETED');
    expect(result.current.messages.map(m => m.content)).toContain('Thanks, goodbye.');
  });

  it('skips the optimistic AGENT message for a silent signal like [START]', async () => {
    const post = () => sseResponse([frame({ type: 'done', content: 'Hi, I need help.' })]);
    const { result } = await mounted(post);

    await act(async () => {
      await result.current.sendMessage('[START]', true);
    });

    // No AGENT turn was optimistically inserted for the silent send.
    expect(result.current.messages.some(m => m.role === 'AGENT' && m.content === '[START]')).toBe(false);
    expect(result.current.lastAiMessage).toBe('Hi, I need help.');
  });

  it('skips malformed SSE lines but surfaces a mid-stream error frame to the caller', async () => {
    // A malformed `data:` line is skipped (the per-line try/catch swallows the
    // JSON.parse failure), but an explicit `type:'error'` frame is NOT swallowed:
    // it aborts the stream and surfaces `data.message` as `error`. Any frame
    // after the error (the `done` below) must NOT be processed.
    const post = () =>
      sseResponse([
        'data: not-json\n\n',
        frame({ type: 'chunk', content: 'partial ' }),
        frame({ type: 'error', message: 'boom' }),
        frame({ type: 'done', content: 'recovered reply.' }),
      ]);
    const { result } = await mounted(post);

    await act(async () => {
      await result.current.sendMessage('hello');
    });

    expect(result.current.error).toBe('boom'); // surfaced, not swallowed
    expect(result.current.lastAiMessage).toBeNull(); // stream aborted before `done`
    expect(result.current.sending).toBe(false);
  });

  it('surfaces a mid-stream error frame with a fallback message when none is given', async () => {
    const post = () =>
      sseResponse([
        frame({ type: 'chunk', content: 'partial ' }),
        frame({ type: 'error' }),
      ]);
    const { result } = await mounted(post);

    await act(async () => {
      await result.current.sendMessage('hello');
    });

    expect(result.current.error).toBe('Stream error');
    expect(result.current.sending).toBe(false);
  });

  it('handles a non-streaming end-session JSON response', async () => {
    const endedSession = makeSession({ status: 'COMPLETED' });
    const post = () => jsonResponse({ ended: true, session: endedSession });
    const { result } = await mounted(post);

    await act(async () => {
      await result.current.sendMessage('[END]');
    });

    expect(result.current.ended).toBe(true);
    expect(result.current.session?.status).toBe('COMPLETED');
  });

  it('sets error when the POST itself is not ok', async () => {
    const post = () => jsonResponse({ error: 'Rate limited' }, false);
    const { result } = await mounted(post);

    await act(async () => {
      await result.current.sendMessage('hello');
    });

    expect(result.current.error).toBe('Rate limited');
    expect(result.current.sending).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useChatSession — guards and endConversation', () => {
  it('does not POST for empty/whitespace content', async () => {
    const fetchFn = installFetch({ load: () => jsonResponse(makeSession()) });
    const { result } = renderHook(() => useChatSession(SESSION_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));
    fetchFn.mockClear();

    await act(async () => {
      await result.current.sendMessage('   ');
    });

    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('endConversation sends the [END] signal via POST', async () => {
    const post = () => sseResponse([frame({ type: 'done', content: 'Bye.' })]);
    const fetchFn = installFetch({ load: () => jsonResponse(makeSession()), post });
    const { result } = renderHook(() => useChatSession(SESSION_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.endConversation();
    });

    await waitFor(() => expect(result.current.sending).toBe(false));
    const postCall = fetchFn.mock.calls.find(([, init]) => (init as { method?: string })?.method === 'POST');
    expect(postCall).toBeDefined();
    expect(String((postCall![1] as { body?: string }).body)).toContain('[END]');
  });
});
