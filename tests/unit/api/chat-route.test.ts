/**
 * Deterministic tests for the /api/chat route — the SSE scoring hot path
 * (issue #16, Phase 3 — P2-7 CI coverage gate). This is the product's core
 * conversational loop: it saves the trainee turn, streams the simulated
 * customer's reply as Server-Sent Events, and on an end/resolved/maxTurns
 * signal finalizes + scores the session.
 *
 * At ~635 lines it was the highest-risk file still outside the deterministic
 * coverage gate (run 49 next-slice #1). This suite mocks only the external
 * seams — `@/lib/db` (`sql`), `@/lib/ai` (the LLM stream), `@/lib/auth-api`
 * (`requireAuth`), and `@/lib/session-scoring` (`finalizeAndScoreSession`) —
 * and exercises the REAL pure logic in `limits`, `session-access`, `latency`,
 * and `scenario-safety`. No live Neon/Groq, no `DISABLE_AUTH`.
 *
 * Covered:
 *   POST — anon→401 (AuthError re-mapped; proof for the catch-block fix that
 *   stopped an anon POST surfacing as 500), body validation (400), oversized
 *   message (400), session-not-found (404), cross-tenant access (403),
 *   already-closed (400), per-turn throttle (429), the [START] opener, a normal
 *   streamed turn (chunk→done SSE framing + the CUSTOMER reply INSERT), the
 *   [RESOLVED] auto-end (session_ending→session_ended), the [END] signal and
 *   maxTurns auto-end (both → finalize+score), the mid-stream LLM error
 *   (error SSE frame), and the outer 500 boundary.
 *
 *   GET — anon→401, missing sessionId (400), owner-not-found (404),
 *   cross-tenant (403), the admin vs trainee sanitizer (hidden-mechanic
 *   boundary), the second not-found after the join, and the 500 boundary.
 *
 *   phoneTranscriptStream (GET ?stream=true) — the live phone transcript SSE:
 *   terminal-on-first-poll (ended), a transcript emission followed by a
 *   terminal poll (fake timers drive the 1s poll interval), session-not-found
 *   mid-stream (error), and the loop's error boundary.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireAuthMock, sqlMock, aiMock, scoringMock, FakeAuthError } = vi.hoisted(() => {
  class FakeAuthError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
      this.name = 'AuthError';
    }
  }
  return {
    requireAuthMock: vi.fn(),
    sqlMock: vi.fn(),
    aiMock: {
      buildSessionSystemPrompt: vi.fn(() => 'SYSTEM PROMPT'),
      streamNextCustomerMessage: vi.fn(),
      customerModelForDifficulty: vi.fn(() => 'llama-8b'),
      resolveScenarioDifficulty: vi.fn(() => 'easy'),
    },
    scoringMock: vi.fn(),
    FakeAuthError,
  };
});

vi.mock('@/lib/auth-api', () => ({ requireAuth: requireAuthMock, AuthError: FakeAuthError }));
vi.mock('@/lib/db', () => ({ sql: sqlMock, default: sqlMock }));
vi.mock('@/lib/ai', () => aiMock);
vi.mock('@/lib/session-scoring', () => ({ finalizeAndScoreSession: scoringMock }));

import { POST, GET } from '@/app/api/chat/route';

// ── Request builders ──────────────────────────────────────────────────────────
function postReq(body: unknown, raw = false) {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}
function getReq(query = '') {
  return new Request(`http://localhost/api/chat${query}`, { method: 'GET' });
}

// ── Auth helpers ──────────────────────────────────────────────────────────────
function asUser(id: string, orgId: string | null, role: 'ADMIN' | 'MEMBER' = 'MEMBER') {
  requireAuthMock.mockResolvedValue({ session: { user: { id, orgId, role } } });
}
function asAnon() {
  requireAuthMock.mockRejectedValue(new FakeAuthError('Unauthorized', 401));
}

// ── sql mock router ───────────────────────────────────────────────────────────
function queryText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(' ') : String(strings);
}
function classify(t: string): string {
  if (t.includes("'AGENT'")) return 'insertAgent';
  if (t.includes("'CUSTOMER'")) return 'insertCustomer';
  if (t.includes('"scoringStatus"')) return 'endFinal';
  if (t.includes('"dbUserId"')) return 'getFull';
  if (t.includes('LIMIT 1')) return 'owner';
  if (t.includes("'script', s.script") && t.includes('GROUP BY ss.id, s.id')) return 'postLoad';
  // Remaining SELECTs: the [RESOLVED] messages-only reload vs the phone poll.
  // The phone poll joins job_titles ("jobTitle"/jt.id); the reload does not.
  if (t.includes('"jobTitle"') || t.includes('jt.id')) return 'phone';
  return 'refreshed';
}
/** Wire the sql mock from a tag→rows map; unmapped tags resolve to []. */
function wireSql(map: Record<string, unknown[]>) {
  sqlMock.mockImplementation((strings?: TemplateStringsArray) => {
    const tag = classify(queryText(strings));
    return Promise.resolve(map[tag] ?? []);
  });
}

// ── Fixtures ──────────────────────────────────────────────────────────────────
function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sess1',
    orgId: 'o1',
    userId: 'u1',
    status: 'IN_PROGRESS',
    type: 'CHAT',
    scenario: { id: 's1', name: 'Angry Customer', script: { difficulty: 'easy' } },
    messages: [] as Array<{ role: string; content: string; timestamp?: string }>,
    ...overrides,
  };
}

/** An async generator that yields the given chunks, as the LLM stream mock. */
function streamOf(...chunks: string[]) {
  return async function* () {
    for (const c of chunks) yield c;
  };
}
function streamThrows(err: Error) {
  return async function* () {
    if (err) throw err;
    yield '';
  };
}

/** Drain an SSE Response body to completion and return the parsed data frames. */
async function collectSSE(res: Response): Promise<Array<Record<string, unknown>>> {
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) buf += dec.decode(value, { stream: true });
  }
  return parseFrames(buf);
}
function parseFrames(buf: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const block of buf.split('\n\n')) {
    const line = block.trim();
    if (line.startsWith('data:')) out.push(JSON.parse(line.slice(5).trim()));
  }
  return out;
}

beforeEach(() => {
  requireAuthMock.mockReset();
  sqlMock.mockReset();
  scoringMock.mockReset();
  aiMock.buildSessionSystemPrompt.mockClear();
  aiMock.streamNextCustomerMessage.mockReset();
  aiMock.customerModelForDifficulty.mockClear();
  aiMock.resolveScenarioDifficulty.mockClear();
  scoringMock.mockResolvedValue({ scores: [], scoringStatus: 'SCORED', scoringFailed: false });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST — guard branches
// ══════════════════════════════════════════════════════════════════════════════
describe('POST /api/chat — guard branches', () => {
  it('anonymous caller → 401 (AuthError re-mapped, not a generic 500), no DB touched', async () => {
    asAnon();
    const res = await POST(postReq({ sessionId: 'sess1', content: 'hi' }));
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('missing sessionId or content → 400', async () => {
    asUser('u1', 'o1');
    expect((await POST(postReq({ content: 'hi' }))).status).toBe(400);
    expect((await POST(postReq({ sessionId: 'sess1', content: '   ' }))).status).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('oversized message → 400 before any DB read', async () => {
    asUser('u1', 'o1');
    const res = await POST(postReq({ sessionId: 'sess1', content: 'x'.repeat(2001) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('too long') });
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('session not found → 404', async () => {
    asUser('u1', 'o1');
    wireSql({ postLoad: [] });
    const res = await POST(postReq({ sessionId: 'missing', content: 'hi' }));
    expect(res.status).toBe(404);
  });

  it('cross-tenant caller (not owner, not same-org admin) → 403', async () => {
    asUser('intruder', 'o2', 'MEMBER');
    wireSql({ postLoad: [sessionRow()] });
    const res = await POST(postReq({ sessionId: 'sess1', content: 'hi' }));
    expect(res.status).toBe(403);
  });

  it('already-closed session → 400', async () => {
    asUser('u1', 'o1');
    wireSql({ postLoad: [sessionRow({ status: 'COMPLETED' })] });
    const res = await POST(postReq({ sessionId: 'sess1', content: 'hi' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'Session is already closed' });
  });

  it('per-turn throttle → 429 for a too-soon trainee reply (control signals exempt)', async () => {
    asUser('u1', 'o1');
    const recent = new Date().toISOString();
    wireSql({
      postLoad: [sessionRow({ messages: [{ role: 'AGENT', content: 'prev', timestamp: recent }] })],
    });
    const res = await POST(postReq({ sessionId: 'sess1', content: 'too fast' }));
    expect(res.status).toBe(429);
  });

  it('outer 500 boundary — a non-auth failure (malformed body) → 500', async () => {
    asUser('u1', 'o1');
    const res = await POST(postReq('{ not json', true));
    expect(res.status).toBe(500);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST — streaming happy paths + terminal branches
// ══════════════════════════════════════════════════════════════════════════════
describe('POST /api/chat — streaming + terminal', () => {
  it('normal turn streams chunk→done SSE frames and persists the CUSTOMER reply', async () => {
    asUser('u1', 'o1');
    aiMock.streamNextCustomerMessage.mockImplementation(streamOf('Hello ', 'there'));
    // A prior CUSTOMER turn in history so the history-builder map runs (and the
    // throttle's last-AGENT lookup finds nothing → not throttled).
    const old = new Date(Date.now() - 60_000).toISOString();
    wireSql({
      postLoad: [sessionRow({ messages: [{ role: 'CUSTOMER', content: 'I am upset', timestamp: old }] })],
      insertAgent: [],
      insertCustomer: [],
    });

    const res = await POST(postReq({ sessionId: 'sess1', content: 'good morning' }));
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    const frames = await collectSSE(res);
    const types = frames.map((f) => f.type);
    expect(types).toContain('chunk');
    expect(types).toContain('done');
    const done = frames.find((f) => f.type === 'done')!;
    expect(done.content).toBe('Hello there');
    // The CUSTOMER reply was persisted with the stripped/cleaned content.
    const insertedCustomer = sqlMock.mock.calls.some((c) =>
      queryText(c[0]).includes("'CUSTOMER'")
    );
    expect(insertedCustomer).toBe(true);
  });

  it('[START] opener streams without inserting an AGENT message', async () => {
    asUser('u1', 'o1');
    aiMock.streamNextCustomerMessage.mockImplementation(streamOf('Hi, I need help'));
    wireSql({ postLoad: [sessionRow()], insertCustomer: [] });

    const res = await POST(postReq({ sessionId: 'sess1', content: '[START]' }));
    const frames = await collectSSE(res);
    expect(frames.map((f) => f.type)).toContain('done');
    // No AGENT insert on the opener.
    const insertedAgent = sqlMock.mock.calls.some((c) => queryText(c[0]).includes("'AGENT'"));
    expect(insertedAgent).toBe(false);
  });

  it('[RESOLVED] in the reply auto-ends: session_ending → session_ended, and scores', async () => {
    asUser('u1', 'o1');
    aiMock.streamNextCustomerMessage.mockImplementation(streamOf('All sorted, thanks [RESOLVED]'));
    wireSql({
      postLoad: [sessionRow()],
      insertAgent: [],
      insertCustomer: [],
      refreshed: [{ id: 'sess1', messages: [{ role: 'AGENT', content: 'help' }] }],
      endFinal: [{ id: 'sess1', status: 'COMPLETED', scoringStatus: 'SCORED', scenario: {}, jobTitle: {}, messages: [], scores: [] }],
    });

    const res = await POST(postReq({ sessionId: 'sess1', content: 'here is the fix' }));
    const frames = await collectSSE(res);
    const types = frames.map((f) => f.type);
    expect(types).toContain('session_ending');
    expect(types).toContain('session_ended');
    expect(scoringMock).toHaveBeenCalledTimes(1);
  });

  it('[END] signal finalizes + scores the session and returns JSON', async () => {
    asUser('u1', 'o1');
    wireSql({
      postLoad: [sessionRow()],
      insertAgent: [],
      endFinal: [{ id: 'sess1', status: 'COMPLETED', scoringStatus: 'SCORED', scenario: {}, jobTitle: {}, messages: [], scores: [] }],
    });
    const res = await POST(postReq({ sessionId: 'sess1', content: '[END]' }));
    expect(res.headers.get('Content-Type')).not.toBe('text/event-stream');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ended: true });
    expect(scoringMock).toHaveBeenCalledTimes(1);
    // Regression: a BARE control token must NOT be persisted as a trainee turn —
    // otherwise a literal "[END]" AGENT row lands in the transcript operators
    // review + export (the CSV artifact). No AGENT INSERT should have fired.
    const agentInsert = sqlMock.mock.calls.find(c =>
      String((c[0] as unknown as string[]).join(' ')).includes("'AGENT'")
    );
    expect(agentInsert).toBeUndefined();
    // And the bare token adds no scorable turn to the transcript.
    const scored = scoringMock.mock.calls[0][1] as Array<{ role: string; content: string }>;
    expect(scored.some(m => m.content.includes('[END]'))).toBe(false);
  });

  it('[END] appended to closing prose ends + scores on the words, not the token', async () => {
    asUser('u1', 'o1');
    wireSql({
      postLoad: [
        sessionRow({
          messages: [{ role: 'CUSTOMER', content: 'Is my issue resolved?' }],
        }),
      ],
      insertAgent: [],
      endFinal: [{ id: 'sess1', status: 'COMPLETED', scoringStatus: 'SCORED', scenario: {}, jobTitle: {}, messages: [], scores: [] }],
    });
    const res = await POST(
      postReq({ sessionId: 'sess1', content: 'Thanks for your patience [END]' })
    );
    // A prose + trailing-token close now terminates the session (previously it
    // was unrecognized and silently continued the conversation).
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ended: true });
    expect(aiMock.streamNextCustomerMessage).not.toHaveBeenCalled();
    expect(scoringMock).toHaveBeenCalledTimes(1);
    // The closing turn is persisted + scored on the STRIPPED prose, never the
    // control token.
    const agentInsert = sqlMock.mock.calls.find(c =>
      String((c[0] as unknown as string[]).join(' ')).includes("'AGENT'")
    );
    expect(agentInsert).toBeDefined();
    expect(agentInsert?.[2]).toBe('Thanks for your patience');
    const scored = scoringMock.mock.calls[0][1] as Array<{ role: string; content: string }>;
    expect(scored).toContainEqual({ role: 'AGENT', content: 'Thanks for your patience' });
    expect(scored.some(m => m.content.includes('[END]'))).toBe(false);
  });

  it('maxTurns reached auto-ends the session', async () => {
    asUser('u1', 'o1');
    // A prior AGENT turn (old timestamp → not throttled) so the maxTurns
    // prior-turn count reflects real history: 1 prior + this turn ≥ maxTurns(2).
    const old = new Date(Date.now() - 60_000).toISOString();
    wireSql({
      postLoad: [
        sessionRow({
          scenario: { id: 's1', name: 'x', script: { maxTurns: 2 } },
          messages: [{ role: 'AGENT', content: 'earlier reply', timestamp: old }],
        }),
      ],
      insertAgent: [],
      endFinal: [{ id: 'sess1', status: 'COMPLETED', scoringStatus: 'SCORED', scenario: {}, jobTitle: {}, messages: [], scores: [] }],
    });
    const res = await POST(postReq({ sessionId: 'sess1', content: 'one more' }));
    expect(await res.json()).toMatchObject({ ended: true });
    expect(scoringMock).toHaveBeenCalledTimes(1);
    // The LLM was never invoked — the turn ended before streaming.
    expect(aiMock.streamNextCustomerMessage).not.toHaveBeenCalled();
    // Regression: the trainee's FINAL turn ("one more") — the one that hit the
    // cap — must be in the scored transcript, not dropped. It was loaded before
    // this turn's INSERT, so the route has to append it (as [RESOLVED]/phone do).
    const scoredTranscript = scoringMock.mock.calls[0][1] as Array<{ role: string; content: string }>;
    expect(scoredTranscript).toContainEqual({ role: 'AGENT', content: 'one more' });
    expect(scoredTranscript).toContainEqual({ role: 'AGENT', content: 'earlier reply' });
  });

  it('mid-stream LLM failure emits an error SSE frame and closes cleanly', async () => {
    asUser('u1', 'o1');
    aiMock.streamNextCustomerMessage.mockImplementation(streamThrows(new Error('groq down')));
    wireSql({ postLoad: [sessionRow()], insertAgent: [] });

    const res = await POST(postReq({ sessionId: 'sess1', content: 'hello' }));
    const frames = await collectSSE(res);
    expect(frames.map((f) => f.type)).toContain('error');
    // No CUSTOMER reply persisted when the stream failed.
    const insertedCustomer = sqlMock.mock.calls.some((c) =>
      queryText(c[0]).includes("'CUSTOMER'")
    );
    expect(insertedCustomer).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET — transcript read
// ══════════════════════════════════════════════════════════════════════════════
describe('GET /api/chat — transcript read', () => {
  it('anonymous caller → 401', async () => {
    asAnon();
    const res = await GET(getReq('?sessionId=sess1'));
    expect(res.status).toBe(401);
  });

  it('missing sessionId → 400', async () => {
    asUser('u1', 'o1');
    const res = await GET(getReq(''));
    expect(res.status).toBe(400);
  });

  it('owner row not found → 404', async () => {
    asUser('u1', 'o1');
    wireSql({ owner: [] });
    const res = await GET(getReq('?sessionId=missing'));
    expect(res.status).toBe(404);
  });

  it('cross-tenant caller → 403 (no body leaked)', async () => {
    asUser('intruder', 'o2', 'MEMBER');
    wireSql({ owner: [{ userId: 'u1', orgId: 'o1' }] });
    const res = await GET(getReq('?sessionId=sess1'));
    expect(res.status).toBe(403);
  });

  it('trainee (non-admin) owner → 200 with the hidden script stripped', async () => {
    asUser('u1', 'o1', 'MEMBER');
    wireSql({
      owner: [{ userId: 'u1', orgId: 'o1' }],
      getFull: [
        {
          id: 'sess1',
          scenario: { id: 's1', name: 'x', script: { ttsVoiceName: 'Rachel', hints: 'SECRET', customerObjective: 'SECRET' } },
          messages: [],
          scores: [],
        },
      ],
    });
    const res = await GET(getReq('?sessionId=sess1'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { scenario: { script: Record<string, unknown> } };
    expect(body.scenario.script).toEqual({ ttsVoiceName: 'Rachel' });
    expect(body.scenario.script.hints).toBeUndefined();
    expect(body.scenario.script.customerObjective).toBeUndefined();
  });

  it('admin owner → 200 with the FULL script (author view)', async () => {
    asUser('admin1', 'o1', 'ADMIN');
    const fullScript = { ttsVoiceName: 'Rachel', hints: 'SECRET', customerObjective: 'de-escalate' };
    wireSql({
      owner: [{ userId: 'u1', orgId: 'o1' }],
      getFull: [{ id: 'sess1', scenario: { id: 's1', name: 'x', script: fullScript }, messages: [], scores: [] }],
    });
    const res = await GET(getReq('?sessionId=sess1'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { scenario: { script: Record<string, unknown> } };
    expect(body.scenario.script).toEqual(fullScript);
  });

  it('second not-found (join returns no rows) → 404', async () => {
    asUser('u1', 'o1');
    wireSql({ owner: [{ userId: 'u1', orgId: 'o1' }], getFull: [] });
    const res = await GET(getReq('?sessionId=sess1'));
    expect(res.status).toBe(404);
  });

  it('500 boundary — a non-auth DB failure → 500', async () => {
    asUser('u1', 'o1');
    sqlMock.mockRejectedValue(new Error('neon exploded'));
    const res = await GET(getReq('?sessionId=sess1'));
    expect(res.status).toBe(500);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET ?stream=true — live phone transcript SSE (phoneTranscriptStream)
// ══════════════════════════════════════════════════════════════════════════════
describe('GET /api/chat?stream=true — phone transcript stream', () => {
  it('terminal on the first poll → single "ended" frame', async () => {
    asUser('u1', 'o1');
    sqlMock.mockImplementation((strings?: TemplateStringsArray) => {
      const t = queryText(strings);
      if (t.includes('LIMIT 1')) return Promise.resolve([{ userId: 'u1', orgId: 'o1' }]);
      return Promise.resolve([
        { id: 'sess1', status: 'COMPLETED', scenario: {}, jobTitle: {}, messages: [{ id: 'm1', role: 'CUSTOMER', content: 'hi' }], scores: [] },
      ]);
    });
    const res = await GET(getReq('?sessionId=sess1&stream=true'));
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    const frames = await collectSSE(res);
    expect(frames.map((f) => f.type)).toEqual(['ended']);
  });

  it('session not found mid-stream → "error" frame', async () => {
    asUser('u1', 'o1');
    sqlMock.mockImplementation((strings?: TemplateStringsArray) => {
      const t = queryText(strings);
      if (t.includes('LIMIT 1')) return Promise.resolve([{ userId: 'u1', orgId: 'o1' }]);
      return Promise.resolve([]); // gone from under the stream
    });
    const res = await GET(getReq('?sessionId=sess1&stream=true'));
    const frames = await collectSSE(res);
    expect(frames.map((f) => f.type)).toEqual(['error']);
  });

  it('loop error boundary — a poll failure emits an "error" frame and closes', async () => {
    asUser('u1', 'o1');
    let call = 0;
    sqlMock.mockImplementation((strings?: TemplateStringsArray) => {
      const t = queryText(strings);
      if (t.includes('LIMIT 1')) return Promise.resolve([{ userId: 'u1', orgId: 'o1' }]);
      call += 1;
      return Promise.reject(new Error('poll failed'));
    });
    const res = await GET(getReq('?sessionId=sess1&stream=true'));
    const frames = await collectSSE(res);
    expect(frames.map((f) => f.type)).toEqual(['error']);
    expect(call).toBe(1);
  });

  it('emits a transcript frame then an ended frame across poll iterations', async () => {
    vi.useFakeTimers();
    try {
      asUser('u1', 'o1');
      let poll = 0;
      sqlMock.mockImplementation((strings?: TemplateStringsArray) => {
        const t = queryText(strings);
        if (t.includes('LIMIT 1')) return Promise.resolve([{ userId: 'u1', orgId: 'o1' }]);
        poll += 1;
        if (poll === 1) {
          return Promise.resolve([
            { id: 'sess1', status: 'IN_PROGRESS', scenario: {}, jobTitle: {}, messages: [{ id: 'm1', role: 'CUSTOMER', content: 'hi' }], scores: [] },
          ]);
        }
        return Promise.resolve([
          { id: 'sess1', status: 'COMPLETED', scenario: {}, jobTitle: {}, messages: [{ id: 'm1', role: 'CUSTOMER', content: 'hi' }], scores: [] },
        ]);
      });

      const res = await GET(getReq('?sessionId=sess1&stream=true'));
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      const dec = new TextDecoder();

      // First poll runs immediately (no timer): a transcript frame.
      const first = await reader.read();
      const firstFrames = parseFrames(dec.decode(first.value));
      expect(firstFrames.map((f) => f.type)).toContain('transcript');

      // Advance past the 1s poll interval → second poll is terminal → ended.
      await vi.advanceTimersByTimeAsync(1000);
      const second = await reader.read();
      const secondFrames = parseFrames(dec.decode(second.value));
      expect(secondFrames.map((f) => f.type)).toContain('ended');
    } finally {
      vi.useRealTimers();
    }
  });
});
