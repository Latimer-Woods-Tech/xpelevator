/**
 * Deterministic tests for POST /api/telnyx/webhook.
 *
 * This is the inbound Call Control webhook that drives the PHONE modality — the
 * product's differentiating voice path and, until now, its largest untested
 * surface (~474 lines, zero deterministic coverage). Every branch here is a live
 * call in flight: a regression can leave the line silent (the conflicting-gather
 * bug the idempotency guard exists for), skip signature verification (accepting
 * forged events), or — the original phone-scoring bug — finalize a session
 * without ever writing a score. These tests lock in:
 *
 *   - malformed JSON → 400 (before any work)
 *   - a failed Telnyx Ed25519 signature → 401 (fail closed)
 *   - the `call.answered` opening: idempotency skip, the speak, and the
 *     callSpeak-failure fallback (record + hang up)
 *   - `call.speak.ended`: hang up when COMPLETED, else start listening; the
 *     start-transcription failure → graceful hangup
 *   - `call.transcription`: ignore partials, treat noise/silence as re-listen
 *     (and hang up past the turn budget), the full turn (STT → model → speak),
 *     and the `[RESOLVED]` end-of-session finalize+score
 *   - `call.hangup` → mark ABANDONED (guarded to non-COMPLETED)
 *   - unknown events and missing/undecodable client_state → silent 200
 *
 * All I/O deps are mocked (no live Neon / Groq / Telnyx). The pure latency
 * helpers (`classifyPhoneTurn` / `phoneTurnTelemetry` / `routeReasonForDifficulty`)
 * run for real so the telemetry-stamp path is genuinely exercised.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  verifyMock,
  sqlMock,
  callSpeakMock,
  startTranscriptionMock,
  stopTranscriptionMock,
  callHangupMock,
  decodeClientStateMock,
  encodeClientStateMock,
  chatCompletionMock,
  getGroqClientMock,
  finalizeAndScoreMock,
  getCfCtxMock,
} = vi.hoisted(() => ({
  verifyMock: vi.fn(),
  sqlMock: vi.fn(),
  callSpeakMock: vi.fn(),
  startTranscriptionMock: vi.fn(),
  stopTranscriptionMock: vi.fn(),
  callHangupMock: vi.fn(),
  decodeClientStateMock: vi.fn(),
  encodeClientStateMock: vi.fn(() => 'encoded-state'),
  chatCompletionMock: vi.fn(),
  getGroqClientMock: vi.fn(),
  finalizeAndScoreMock: vi.fn(),
  // No CF context in the unit env: the route falls back to awaiting the
  // processing promise inline, which lets us assert side effects after POST.
  getCfCtxMock: vi.fn(() => {
    throw new Error('no cf context in test');
  }),
}));

vi.mock('@/lib/auth-api', () => ({ verifyTelnyxWebhook: verifyMock }));
vi.mock('@/lib/db', () => ({ sql: sqlMock, default: sqlMock }));
vi.mock('@/lib/telnyx', () => ({
  callSpeak: callSpeakMock,
  startTranscription: startTranscriptionMock,
  stopTranscription: stopTranscriptionMock,
  callHangup: callHangupMock,
  decodeClientState: decodeClientStateMock,
  encodeClientState: encodeClientStateMock,
}));
vi.mock('@/lib/groq-fetch', () => ({ getGroqClient: getGroqClientMock }));
vi.mock('@/lib/ai', () => ({
  buildSessionSystemPrompt: vi.fn(() => 'system-prompt'),
  customerModelForDifficulty: vi.fn(() => 'llama-3.1-8b-instant'),
  resolveScenarioDifficulty: vi.fn(() => 'easy'),
}));
vi.mock('@/lib/session-scoring', () => ({ finalizeAndScoreSession: finalizeAndScoreMock }));
vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: getCfCtxMock }));

import { POST } from '@/app/api/telnyx/webhook/route';

// ── sql router ───────────────────────────────────────────────────────────────
// The route uses `sql` as a tagged template; we route by the query text and
// return per-test-configurable rows via `sqlState`. Every DELETE/UPDATE/INSERT
// resolves to a benign shape.
let sqlState: {
  idempotencyRows: unknown[];
  webhookClaimRows: unknown[];
  scenarioAnswered: unknown[];
  scenarioScript: unknown[];
  sessionStatus: unknown[];
  history: unknown[];
};
let savedIdCounter = 0;

function configureSql() {
  sqlMock.mockImplementation((strings: TemplateStringsArray) => {
    const q = Array.isArray(strings) ? strings.join(' ') : String(strings);
    if (q.includes('INSERT INTO chat_messages')) {
      savedIdCounter += 1;
      return Promise.resolve([{ id: `msg-${savedIdCounter}` }]);
    }
    if (q.includes('UPDATE chat_messages')) return Promise.resolve([]);
    if (q.includes('UPDATE simulation_sessions')) return Promise.resolve([]);
    // Event-ID idempotency claim (src/lib/idempotency.ts). A returned row =
    // first-seen (handler runs); [] = the id was already claimed (duplicate →
    // handler skipped). Only reached when the event carries a `data.id`.
    if (q.includes('INSERT INTO webhook_events')) return Promise.resolve(sqlState.webhookClaimRows);
    if (q.includes('SELECT id FROM chat_messages')) return Promise.resolve(sqlState.idempotencyRows);
    if (q.includes('SELECT id, script FROM scenarios')) return Promise.resolve(sqlState.scenarioAnswered);
    if (q.includes('SELECT script FROM scenarios')) return Promise.resolve(sqlState.scenarioScript);
    if (q.includes('SELECT status FROM simulation_sessions')) return Promise.resolve(sqlState.sessionStatus);
    if (q.includes('SELECT role, content FROM chat_messages')) return Promise.resolve(sqlState.history);
    return Promise.resolve([]);
  });
}

const STATE = {
  sessionId: 'sess-1',
  scenarioId: 'scn-1',
  jobTitleId: 'job-1',
  scenarioName: 'Angry customer',
  turnCount: 0,
};

function makeReq(payload: unknown, headers: Record<string, string> = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return new Request('http://localhost/api/telnyx/webhook', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

// `clientState = null` omits client_state entirely (drives the "no state" break
// paths). Note: passing `undefined` would trigger the default, so use `null`.
function event(
  eventType: string,
  extra: Record<string, unknown> = {},
  clientState: string | null = 'cs',
) {
  const payload: Record<string, unknown> = { call_control_id: 'cc-1', ...extra };
  if (clientState !== null) payload.client_state = clientState;
  return { data: { event_type: eventType, payload } };
}

/** Drive POST to completion, flushing the internal setTimeout delays. */
async function post(payload: unknown, headers?: Record<string, string>) {
  const p = POST(makeReq(payload, headers));
  await vi.runAllTimersAsync();
  return p;
}

function groqReply(content: string) {
  chatCompletionMock.mockResolvedValueOnce({ choices: [{ message: { content } }] });
}

function groqReplyWithUsage(
  content: string,
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number },
) {
  chatCompletionMock.mockResolvedValueOnce({ choices: [{ message: { content } }], usage });
}

function ranInsertCustomer(text?: string) {
  return sqlMock.mock.calls.some((c) => {
    const q = Array.isArray(c[0]) ? c[0].join(' ') : '';
    if (!q.includes('INSERT INTO chat_messages')) return false;
    return text === undefined || c.slice(1).some((v) => String(v) === text);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  savedIdCounter = 0;
  sqlState = {
    idempotencyRows: [],
    webhookClaimRows: [{ event_id: 'evt-first' }],
    scenarioAnswered: [{ id: 'scn-1', script: { difficulty: 'easy' } }],
    scenarioScript: [{ script: { difficulty: 'easy' } }],
    sessionStatus: [{ status: 'IN_PROGRESS' }],
    history: [],
  };
  configureSql();
  verifyMock.mockResolvedValue(true);
  getGroqClientMock.mockReturnValue({ chatCompletion: chatCompletionMock });
  chatCompletionMock.mockResolvedValue({ choices: [{ message: { content: 'Hello there' } }] });
  decodeClientStateMock.mockReturnValue({ ...STATE });
  callSpeakMock.mockResolvedValue(undefined);
  startTranscriptionMock.mockResolvedValue(undefined);
  stopTranscriptionMock.mockResolvedValue(undefined);
  callHangupMock.mockResolvedValue(undefined);
  finalizeAndScoreMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

// ── request-level guards ───────────────────────────────────────────────────────

describe('POST /api/telnyx/webhook — request guards', () => {
  it('returns 400 on malformed JSON (before signature verification)', async () => {
    const res = await post('this is not json{');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid JSON' });
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('returns 401 when the Telnyx signature is invalid (fail closed)', async () => {
    verifyMock.mockResolvedValueOnce(false);
    const res = await post(event('call.answered'));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Invalid signature' });
    // No handler work runs on a rejected signature.
    expect(sqlMock).not.toHaveBeenCalled();
    expect(callSpeakMock).not.toHaveBeenCalled();
  });

  it('acknowledges (200) an unknown event type with no side effects', async () => {
    const res = await post(event('call.machine.detection.ended'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(callSpeakMock).not.toHaveBeenCalled();
    expect(finalizeAndScoreMock).not.toHaveBeenCalled();
  });

  it('acknowledges (200) when client_state is missing (state stays null → break)', async () => {
    const res = await post(event('call.answered', {}, null));
    expect(res.status).toBe(200);
    expect(decodeClientStateMock).not.toHaveBeenCalled();
    expect(callSpeakMock).not.toHaveBeenCalled();
  });

  it('acknowledges (200) when client_state cannot be decoded (state stays null)', async () => {
    decodeClientStateMock.mockImplementationOnce(() => {
      throw new Error('bad state');
    });
    const res = await post(event('call.answered'));
    expect(res.status).toBe(200);
    expect(callSpeakMock).not.toHaveBeenCalled();
  });
});

// ── call.answered ──────────────────────────────────────────────────────────────

describe('call.answered', () => {
  it('speaks the model-generated opening and stamps the CUSTOMER turn', async () => {
    groqReply('Hi, I need help with my order');
    const res = await post(event('call.answered'));
    expect(res.status).toBe(200);
    // opening saved as a CUSTOMER message, then spoken
    expect(ranInsertCustomer('Hi, I need help with my order')).toBe(true);
    expect(callSpeakMock).toHaveBeenCalledTimes(1);
    expect(callSpeakMock.mock.calls[0][0]).toBe('cc-1');
    expect(callSpeakMock.mock.calls[0][1].payload).toBe('Hi, I need help with my order');
    // the CUSTOMER row gets a telemetry stamp (UPDATE chat_messages)
    const stamped = sqlMock.mock.calls.some(
      (c) => Array.isArray(c[0]) && c[0].join(' ').includes('UPDATE chat_messages'),
    );
    expect(stamped).toBe(true);
    expect(callHangupMock).not.toHaveBeenCalled();
  });

  it('stamps per-turn Groq token usage on the CUSTOMER turn (R-132)', async () => {
    groqReplyWithUsage('Hi there', {
      prompt_tokens: 210,
      completion_tokens: 18,
      total_tokens: 228,
    });
    await post(event('call.answered'));
    // The telemetry stamp UPDATE interpolates values in column order, ending
    // with the three token columns then the row id (WHERE id = ...).
    const stampCall = sqlMock.mock.calls.find(
      (c) => Array.isArray(c[0]) && c[0].join(' ').includes('UPDATE chat_messages'),
    );
    expect(stampCall).toBeDefined();
    expect(stampCall!.slice(1).slice(-4, -1)).toEqual([210, 18, 228]);
  });

  it('stamps NULL token columns when the model returns no usage', async () => {
    groqReply('Hi there'); // no usage field on the completion
    await post(event('call.answered'));
    const stampCall = sqlMock.mock.calls.find(
      (c) => Array.isArray(c[0]) && c[0].join(' ').includes('UPDATE chat_messages'),
    );
    expect(stampCall!.slice(1).slice(-4, -1)).toEqual([null, null, null]);
  });

  it('strips the [RESOLVED] sentinel from the spoken opening', async () => {
    groqReply('Hello? [RESOLVED]');
    await post(event('call.answered'));
    expect(callSpeakMock.mock.calls[0][1].payload).toBe('Hello?');
  });

  it('falls back to "Hello?" when the model returns no content', async () => {
    chatCompletionMock.mockResolvedValueOnce({ choices: [{ message: {} }] });
    await post(event('call.answered'));
    expect(callSpeakMock.mock.calls[0][1].payload).toBe('Hello?');
  });

  it('is idempotent: skips entirely when the session already has a message', async () => {
    sqlState.idempotencyRows = [{ id: 'existing' }];
    await post(event('call.answered'));
    expect(chatCompletionMock).not.toHaveBeenCalled();
    expect(callSpeakMock).not.toHaveBeenCalled();
  });

  it('still speaks a safe opening when the scenario row is missing (deleted mid-call)', async () => {
    sqlState.scenarioAnswered = [];
    groqReply('Hello, is anyone there?');
    await post(event('call.answered'));
    expect(callSpeakMock).toHaveBeenCalledTimes(1);
    expect(callSpeakMock.mock.calls[0][1].payload).toBe('Hello, is anyone there?');
  });

  it('records a [SPEAK_ERROR] message and hangs up when callSpeak throws', async () => {
    callSpeakMock.mockRejectedValueOnce(new Error('telnyx 502'));
    groqReply('Opening line');
    await post(event('call.answered'));
    expect(ranInsertCustomer('[SPEAK_ERROR] telnyx 502')).toBe(true);
    expect(callHangupMock).toHaveBeenCalledWith('cc-1');
  });
});

// ── event-ID idempotency (withIdempotency) ───────────────────────────────────

describe('event-ID idempotency', () => {
  // Attach a Telnyx event `data.id` so the generic idempotency claim runs (the
  // other tests omit it, exercising the no-id fall-through).
  function withId(evt: { data: Record<string, unknown> }, id: string) {
    return { data: { ...evt.data, id } };
  }

  it('PROOF-OF-REJECTION: a duplicate event id skips the handler entirely', async () => {
    // The claim insert returns no row → this exact event was already processed
    // by an earlier delivery → NONE of the handler side effects may re-run
    // (no second opening spoken, no doubled model turn).
    sqlState.webhookClaimRows = [];
    const res = await post(withId(event('call.answered'), 'evt-dup-1'));
    expect(res.status).toBe(200);
    expect(chatCompletionMock).not.toHaveBeenCalled();
    expect(callSpeakMock).not.toHaveBeenCalled();
  });

  it('processes normally on the first delivery of an event id', async () => {
    sqlState.webhookClaimRows = [{ event_id: 'evt-new-1' }];
    groqReply('Opening line');
    const res = await post(withId(event('call.answered'), 'evt-new-1'));
    expect(res.status).toBe(200);
    expect(callSpeakMock).toHaveBeenCalledTimes(1);
  });

  it('fails OPEN: still processes when the claim write throws (DB blip)', async () => {
    // The claim INSERT is the first sql call for an id-bearing event; make it
    // reject once. A dropped live-call event is worse than a rare double.
    sqlMock.mockImplementationOnce(() => Promise.reject(new Error('neon blip')));
    groqReply('Opening line');
    const res = await post(withId(event('call.answered'), 'evt-blip-1'));
    expect(res.status).toBe(200);
    expect(callSpeakMock).toHaveBeenCalledTimes(1);
  });
});

// ── call.speak.ended ─────────────────────────────────────────────────────────

describe('call.speak.ended', () => {
  it('starts transcription (listening) when the session is still in progress', async () => {
    const res = await post(event('call.speak.ended'));
    expect(res.status).toBe(200);
    expect(startTranscriptionMock).toHaveBeenCalledTimes(1);
    expect(startTranscriptionMock.mock.calls[0][0]).toBe('cc-1');
    expect(startTranscriptionMock.mock.calls[0][1].track).toBe('inbound');
    expect(callHangupMock).not.toHaveBeenCalled();
  });

  it('hangs up (does not listen) when the session is COMPLETED', async () => {
    sqlState.sessionStatus = [{ status: 'COMPLETED' }];
    await post(event('call.speak.ended'));
    expect(callHangupMock).toHaveBeenCalledWith('cc-1');
    expect(startTranscriptionMock).not.toHaveBeenCalled();
  });

  it('hangs up gracefully when startTranscription fails', async () => {
    startTranscriptionMock.mockRejectedValueOnce(new Error('stt down'));
    await post(event('call.speak.ended'));
    expect(callHangupMock).toHaveBeenCalledWith('cc-1');
  });

  it('breaks with no work when there is no state', async () => {
    await post(event('call.speak.ended', {}, null));
    expect(sqlMock).not.toHaveBeenCalled();
    expect(startTranscriptionMock).not.toHaveBeenCalled();
  });
});

// ── call.transcription ───────────────────────────────────────────────────────

describe('call.transcription', () => {
  it('ignores non-final (partial) transcripts', async () => {
    await post(
      event('call.transcription', {
        transcription_data: { transcript: 'I want', is_final: false },
      }),
    );
    expect(chatCompletionMock).not.toHaveBeenCalled();
    expect(callSpeakMock).not.toHaveBeenCalled();
  });

  it('treats short noise/silence as a re-listen (stop then restart transcription)', async () => {
    await post(
      event('call.transcription', {
        transcription_data: { transcript: 'uh', is_final: true },
      }),
    );
    // single word (<2) → no model call, just re-listen
    expect(chatCompletionMock).not.toHaveBeenCalled();
    expect(stopTranscriptionMock).toHaveBeenCalled();
    expect(startTranscriptionMock).toHaveBeenCalled();
    expect(callHangupMock).not.toHaveBeenCalled();
  });

  it('hangs up on repeated noise past the turn budget (turn > 10)', async () => {
    decodeClientStateMock.mockReturnValueOnce({ ...STATE, turnCount: 11 });
    await post(
      event('call.transcription', {
        transcription_data: { transcript: '', is_final: true },
      }),
    );
    expect(callHangupMock).toHaveBeenCalledWith('cc-1');
    expect(startTranscriptionMock).not.toHaveBeenCalled();
  });

  it('runs a full turn: saves AGENT transcript, calls the model, speaks the reply', async () => {
    sqlState.history = [{ role: 'CUSTOMER', content: 'Hello there' }];
    groqReply('I understand, let me check that for you');
    await post(
      event('call.transcription', {
        transcription_data: { transcript: 'my order is late and I am upset', is_final: true },
      }),
    );
    // trainee (AGENT) turn persisted
    expect(ranInsertCustomer('my order is late and I am upset')).toBe(true);
    // model reply spoken and persisted
    expect(chatCompletionMock).toHaveBeenCalledTimes(1);
    expect(ranInsertCustomer('I understand, let me check that for you')).toBe(true);
    expect(callSpeakMock.mock.calls[0][1].payload).toBe('I understand, let me check that for you');
    // not resolved → no scoring yet
    expect(finalizeAndScoreMock).not.toHaveBeenCalled();
  });

  it('completes a turn even when the scenario row is missing (deleted mid-call)', async () => {
    sqlState.scenarioScript = [];
    sqlState.history = [{ role: 'CUSTOMER', content: 'Hello there' }];
    groqReply('Okay, tell me more.');
    await post(
      event('call.transcription', {
        transcription_data: { transcript: 'the package never arrived', is_final: true },
      }),
    );
    expect(callSpeakMock).toHaveBeenCalledTimes(1);
    expect(callSpeakMock.mock.calls[0][1].payload).toBe('Okay, tell me more.');
  });

  it('finalizes + scores the session when the reply contains [RESOLVED]', async () => {
    sqlState.history = [{ role: 'AGENT', content: 'thanks, that fixes it' }];
    groqReply('Glad I could help. [RESOLVED]');
    await post(
      event('call.transcription', {
        transcription_data: { transcript: 'that resolves my issue thank you', is_final: true },
      }),
    );
    expect(finalizeAndScoreMock).toHaveBeenCalledTimes(1);
    expect(finalizeAndScoreMock.mock.calls[0][0]).toBe('sess-1');
    // the sentinel is stripped from the spoken reply
    expect(callSpeakMock.mock.calls[0][1].payload).toBe('Glad I could help.');
  });

  it('breaks with no work when there is no state', async () => {
    await post(
      event(
        'call.transcription',
        { transcription_data: { transcript: 'hello world', is_final: true } },
        null,
      ),
    );
    expect(chatCompletionMock).not.toHaveBeenCalled();
  });
});

// ── call.hangup ──────────────────────────────────────────────────────────────

describe('call.hangup', () => {
  it('marks the session ABANDONED (guarded to non-COMPLETED)', async () => {
    const res = await post(event('call.hangup'));
    expect(res.status).toBe(200);
    const abandoned = sqlMock.mock.calls.some((c) => {
      const q = Array.isArray(c[0]) ? c[0].join(' ') : '';
      return q.includes('UPDATE simulation_sessions') && q.includes('ABANDONED') && q.includes("status != 'COMPLETED'");
    });
    expect(abandoned).toBe(true);
  });

  it('breaks with no work when the state has no sessionId', async () => {
    decodeClientStateMock.mockReturnValueOnce({ scenarioId: 'scn-1' });
    await post(event('call.hangup'));
    expect(sqlMock).not.toHaveBeenCalled();
  });
});

// ── background dispatch (ctx.waitUntil) + error swallowing ───────────────────────

describe('background dispatch', () => {
  it('returns 200 immediately via ctx.waitUntil when in a CF Worker context', async () => {
    const waitUntil = vi.fn();
    getCfCtxMock.mockReturnValueOnce({ ctx: { waitUntil } });
    const res = await post(event('call.hangup'));
    expect(res.status).toBe(200);
    // The handler is handed to waitUntil (kept alive after the response) rather
    // than awaited inline — the anti-silent-call design.
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });

  it('still returns 200 when the background handler rejects (error is swallowed)', async () => {
    // Idempotency/hangup UPDATE rejects → handleEvent rejects → the inline
    // await-fallback `.catch` logs and does not surface the error to Telnyx.
    sqlMock.mockImplementationOnce(() => Promise.reject(new Error('db down')));
    const res = await post(event('call.hangup'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
  });

  it('hangs up when the noise re-listen startTranscription also fails', async () => {
    // Short-noise path → re-listen restart; if that startTranscription rejects,
    // the `.catch(() => callHangup())` closes the call gracefully.
    startTranscriptionMock.mockRejectedValueOnce(new Error('stt gone'));
    await post(
      event('call.transcription', {
        transcription_data: { transcript: 'uh', is_final: true },
      }),
    );
    expect(callHangupMock).toHaveBeenCalledWith('cc-1');
  });
});

// ── structured request-correlated logging (#154) ────────────────────────────────
// The phone webhook replaced its 17 ad-hoc `console.*` calls with the structured
// `log()` primitive + the middleware-propagated `x-request-id`, so a phone-path
// request can be traced across the background handler by one id. These are the
// Standing-Law-1 proof-of-rejection tests: each asserts the emitted line is ONE
// parseable JSON object carrying `{ level, msg, requestId }` — which the previous
// free-text `console.log('[telnyx] incoming webhook: ...')` (not JSON, no id)
// would fail. The noise-branch test additionally proves the caller transcript
// (PII) is never written to the drain.
describe('structured request-correlated logging (#154)', () => {
  /** Parse the single-arg JSON lines the `log()` primitive writes to a console spy. */
  function loggedLines(spy: ReturnType<typeof vi.spyOn>): Array<Record<string, unknown>> {
    return spy.mock.calls
      .map((c) => c[0])
      .filter((a): a is string => typeof a === 'string')
      .map((s) => {
        try {
          return JSON.parse(s) as Record<string, unknown>;
        } catch {
          return { __unparseable__: s };
        }
      });
  }

  it('emits ONE structured JSON info line for the received webhook, with a requestId', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await post(event('call.answered'));
      const line = loggedLines(logSpy).find((l) => l.msg === 'telnyx.webhook_received');
      expect(line).toBeDefined();
      expect(line).toMatchObject({
        level: 'info',
        msg: 'telnyx.webhook_received',
        path: '/api/telnyx/webhook',
        method: 'POST',
        eventType: 'call.answered',
      });
      expect(typeof line!.requestId).toBe('string');
      expect((line!.requestId as string).length).toBeGreaterThan(0);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('honours a caller-supplied x-request-id so the log line correlates to the request', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await post(event('call.answered'), { 'x-request-id': 'trace-phone-999' });
      const line = loggedLines(logSpy).find((l) => l.msg === 'telnyx.webhook_received');
      expect(line?.requestId).toBe('trace-phone-999');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('logs an invalid signature as a structured warn line (fail closed) with a requestId', async () => {
    verifyMock.mockResolvedValueOnce(false);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const res = await post(event('call.answered'), { 'x-request-id': 'trace-sig-1' });
      expect(res.status).toBe(401);
      const line = loggedLines(warnSpy).find((l) => l.msg === 'telnyx.signature_invalid');
      expect(line).toMatchObject({
        level: 'warn',
        msg: 'telnyx.signature_invalid',
        eventType: 'call.answered',
        requestId: 'trace-sig-1',
      });
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('never writes the caller transcript (PII) to the drain on the noise branch', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // Single-word transcript → wordCount 1 (< 2) → noise/silence re-listen.
      await post(
        event('call.transcription', {
          transcription_data: { transcript: 'zqxsecret', is_final: true, language: 'en' },
        }),
      );
      const line = loggedLines(warnSpy).find((l) => l.msg === 'telnyx.transcription_noise');
      expect(line).toMatchObject({ level: 'warn', msg: 'telnyx.transcription_noise', wordCount: 1 });
      expect(typeof line!.requestId).toBe('string');
      // The transcript text must not appear in ANY structured line on any channel.
      const all = [
        ...loggedLines(warnSpy),
        ...loggedLines(logSpy),
        ...loggedLines(errSpy),
      ];
      expect(all.some((l) => JSON.stringify(l).includes('zqxsecret'))).toBe(false);
    } finally {
      warnSpy.mockRestore();
      logSpy.mockRestore();
      errSpy.mockRestore();
    }
  });
});
