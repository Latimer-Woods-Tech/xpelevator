
/**
 * POST /api/telnyx/webhook
 *
 * Receives Telnyx Call Control webhook events and drives the AI phone simulation.
 *
 * CRITICAL: Return 200 to Telnyx IMMEDIATELY (before any async work) using
 * CF Workers ctx.waitUntil(). Telnyx retries the webhook after ~10s with no
 * response, causing duplicate call.answered events that fire conflicting
 * gather_using_speak requests that cancel each other — leaving the call silent.
 *
 * Flow:
 *   1. call.answered      → gather_using_speak(opening) — speaks AND listens
 *   2. call.gather.ended  → STT transcript → Groq → gather_using_speak(aiReply)
 *   3. call.speak.ended   → no-op (fired by gather TTS); hangup if COMPLETED
 *   4. call.hangup        → mark session ABANDONED if not already COMPLETED
 *
 * Event reference: https://developers.telnyx.com/docs/call-control/receiving-webhooks
 */
import { NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { getGroqClient } from '@/lib/groq-fetch';
import type { GroqTokenUsage } from '@/lib/groq-fetch';
import {
  buildSessionSystemPrompt,
  customerModelForDifficulty,
  resolveScenarioDifficulty,
} from '@/lib/ai';
import { finalizeAndScoreSession } from '@/lib/session-scoring';
import { sql } from '@/lib/db';
import {
  callSpeak,
  startTranscription,
  stopTranscription,
  callHangup,
  decodeClientState,
  encodeClientState,
} from '@/lib/telnyx';
import { verifyTelnyxWebhook } from '@/lib/auth-api';
import { withIdempotency } from '@/lib/idempotency';
import { windowConversation } from '@/lib/limits';
import {
  classifyPhoneTurn,
  phoneTurnTelemetry,
  routeReasonForDifficulty,
  type PersistedTurnTelemetry,
} from '@/lib/latency';
import { errorFields, log, requestIdFrom } from '@/lib/log';

/** Canonical path label attached to this route's structured log lines. */
const ROUTE_PATH = '/api/telnyx/webhook';

// ── Types ──────────────────────────────────────────────────────────────────────

interface TelnyxClientState {
  sessionId: string;
  scenarioId: string;
  jobTitleId: string;
  scenarioName: string;
  turnCount?: number;
}

interface TelnyxWebhookPayload {
  data: {
    // Stable, per-event UUID assigned by Telnyx. The idempotency key: a retried
    // delivery of the same event carries the same `id`, so claiming it once
    // collapses duplicates (see `withIdempotency`).
    id?: string;
    event_type: string;
    payload: {
      call_control_id: string;
      call_leg_id?: string;
      client_state?: string;
      reason?: string;
      // call.transcription — real-time STT results from start_transcription
      // is_final: true = utterance complete, process it
      // is_final: false = partial result, ignore
      transcription_data?: {
        transcript: string;
        is_final: boolean;
        language?: string;
        confidence?: number;
      };
    };
  };
}

// ── Handler ────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  // Resolve the per-request correlation id once (honours a middleware-forwarded
  // `x-request-id`, else mints) so every structured log line on this webhook —
  // including the background handler and both outer catches — shares one
  // traceable id (#154, R-111/R-112).
  const requestId = requestIdFrom(request.headers);

  // Clone request for signature verification (body can only be read once)
  const clonedRequest = request.clone();

  let body: TelnyxWebhookPayload;
  try {
    body = (await request.json()) as TelnyxWebhookPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const eventType = body?.data?.event_type ?? 'unknown';
  log('info', 'telnyx.webhook_received', { requestId, path: ROUTE_PATH, method: 'POST', eventType });

  // Verify Telnyx webhook signature in production
  const rawBody = await clonedRequest.text();
  const signatureValid = await verifyTelnyxWebhook(clonedRequest.headers, rawBody);
  if (!signatureValid) {
    log('warn', 'telnyx.signature_invalid', { requestId, path: ROUTE_PATH, method: 'POST', eventType });
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const { id: eventId, event_type, payload } = body.data;
  const { call_control_id, client_state } = payload;

  // Decode session context from client_state
  let state: TelnyxClientState | null = null;
  if (client_state) {
    try {
      state = decodeClientState<TelnyxClientState>(client_state);
    } catch {
      // Log the failure, not the opaque blob itself — keep the drain clean.
      log('warn', 'telnyx.client_state_decode_failed', { requestId, eventType });
    }
  }

  // ── Return 200 to Telnyx IMMEDIATELY, then process in background ─────────────
  // Telnyx retries the webhook after ~10s with no response. Groq + Neon cold
  // starts can take 5–15s each, easily exceeding that timeout. Duplicate
  // call.answered retries create conflicting gather requests that cancel each
  // other, making the call permanently silent.
  //
  // ctx.waitUntil() keeps the CF Worker alive after the response is sent.
  //
  // IDEMPOTENCY: Telnyx delivers AT-LEAST-ONCE (a lost 200 ACK or an edge retry
  // re-sends the same event `id`). Since we return 200 up-front and process in
  // the background, a duplicate would otherwise re-run the full handler — two
  // gather/speak requests racing on one live call (the conflicting-gather bug
  // this route header warns about), a doubled model turn, or a second scoring
  // pass. Claiming the event id once (fail-open on a DB blip) collapses every
  // retry of one event to a single execution, covering ALL event types — the
  // per-branch `call.answered` content-guard below is now the second layer.
  const processingPromise = withIdempotency(eventId, () =>
    handleEvent(event_type, payload, state, call_control_id, client_state, requestId),
  );
  try {
    const { ctx } = getCloudflareContext();
    ctx.waitUntil(processingPromise.catch(err =>
      log('error', 'telnyx.handler_failed', { requestId, path: ROUTE_PATH, method: 'POST', eventType: event_type, ...errorFields(err) })
    ));
  } catch {
    // Local dev — not in a CF Worker context; await directly
    await processingPromise.catch(err =>
      log('error', 'telnyx.handler_failed', { requestId, path: ROUTE_PATH, method: 'POST', eventType: event_type, ...errorFields(err) })
    );
  }

  return NextResponse.json({ received: true });
}

// ── Event processor (runs in background via waitUntil) ─────────────────────────

async function handleEvent(
  event_type: string,
  payload: TelnyxWebhookPayload['data']['payload'],
  state: TelnyxClientState | null,
  call_control_id: string,
  client_state: string | undefined,
  requestId: string,
) {
  log('info', 'telnyx.event', {
    requestId,
    eventType: event_type,
    sessionId: state?.sessionId ?? null,
    turn: state?.turnCount ?? 0,
  });
  switch (event_type) {
      // ── Call answered — AI generates and speaks the opening line ──────────
      // NOTE: gather_using_speak is DTMF-only. Real STT uses start_transcription.
      // Flow: call.answered → callSpeak(opening)
      //       call.speak.ended → startTranscription (listen for trainee response)
      //       call.transcription (is_final) → stopTranscription → Groq → callSpeak(reply)
      //       call.speak.ended → startTranscription → repeat
      case 'call.answered': {
        if (!state) break;

        // IDEMPOTENCY: skip if we've already processed call.answered for this session.
        // Telnyx retries webhooks after ~10s if no 200 is received. Duplicate call.answered
        // events cause two AI voices speaking simultaneously and two openings saved to DB.
        const existingMsgs = await sql`
          SELECT id FROM chat_messages WHERE session_id = ${state.sessionId} LIMIT 1
        `;
        if ((existingMsgs as any[]).length > 0) {
          log('info', 'telnyx.answered_idempotency_skip', { requestId, sessionId: state.sessionId });
          break;
        }

        // Phone-turn latency (R-058) — the opening leg: call answered → the
        // simulated customer's first words. `turnStart` here is the moment the
        // call connects; the gap the trainee waits through before hearing anyone.
        const openTurnStart = Date.now();

        // Load scenario script for the opening line
        const scenarioRows = await sql`
          SELECT id, script FROM scenarios WHERE id = ${state.scenarioId}
        `;
        const scenario: any = scenarioRows[0] ?? null;
        const script = (scenario?.script ?? {}) as Record<string, unknown>;

        // Generate AI opening line via Groq
        // Conversation-speed lever (R-059): mirror the chat path — pick the model
        // tier by scenario difficulty instead of hard-coding the heavy 70B model
        // on every phone turn. Hard scenarios keep the higher-realism 70B model;
        // easy/medium use the ~3x faster 8B model so the simulated customer starts
        // speaking closer to real-time (directly targeting the founder's
        // "half-speed" voice signal — R-058 showed the phone path ran 70B always).
        const customerModel = customerModelForDifficulty(resolveScenarioDifficulty(script));
        const systemPromptOpening = buildSessionSystemPrompt(state.scenarioName, script, state.sessionId);
        const client = getGroqClient();
        const opening = await client.chatCompletion({
          model: customerModel,
          messages: [
            { role: 'system', content: systemPromptOpening },
            { role: 'user', content: '[START_CONVERSATION]' },
          ],
          max_tokens: 100,
        });
        const openReplyReadyMs = Date.now() - openTurnStart;

        const openingText = opening.choices[0]?.message?.content?.trim() ?? 'Hello?';
        const cleanOpening = openingText.replace('[RESOLVED]', '').trim();

        // Save AI opening (CUSTOMER role) — keep its id so this turn's latency
        // telemetry (R-070) can be stamped once callSpeak gives the dispatch total.
        const openingMsgId = await saveMessage(state.sessionId, 'CUSTOMER', cleanOpening);
        const openRouteReason = routeReasonForDifficulty(resolveScenarioDifficulty(script));

        // Speak the opening — call.speak.ended will trigger startTranscription
        const newState = { ...state, turnCount: 1 };
        try {
          await callSpeak(call_control_id, {
            payload: cleanOpening,
            clientState: encodeClientState(newState as unknown as Record<string, unknown>),
          });
          const openTiming = classifyPhoneTurn(openReplyReadyMs, Date.now() - openTurnStart);
          // Persist the same felt-speed number the log reports so the R-068
          // byModality split populates the PHONE bucket (R-070).
          await stampTurnTelemetry(
            openingMsgId,
            phoneTurnTelemetry(openTiming, customerModel, openRouteReason),
            opening.usage,
          );
          log('info', 'telnyx.turn_latency', {
            requestId,
            sessionId: state.sessionId,
            leg: 'opening',
            model: customerModel,
            replyReadyMs: openTiming.replyReadyMs,
            speakDispatchMs: openTiming.speakDispatchMs,
            tier: openTiming.tier,
          });
          log('info', 'telnyx.answered_speak_ok', { requestId, sessionId: state.sessionId });
        } catch (speakErr) {
          // Save the error as a visible DB record so we can diagnose without tail logs
          const errMsg = speakErr instanceof Error ? speakErr.message : String(speakErr);
          log('error', 'telnyx.answered_speak_failed', { requestId, sessionId: state.sessionId, ...errorFields(speakErr) });
          await saveMessage(state.sessionId, 'CUSTOMER', `[SPEAK_ERROR] ${errMsg}`).catch(() => {});
          await callHangup(call_control_id).catch(() => {});
        }
        break;
      }

      // ── call.speak.ended — AI finished speaking, start listening ──────────
      // After AI speaks, start real-time STT transcription so the trainee's
      // response is captured via call.transcription webhooks.
      // Exception: if session is COMPLETED, hang up instead.
      case 'call.speak.ended': {
        if (!state) break;
        const sessionRowsSpeak = await sql`
          SELECT status FROM simulation_sessions WHERE id = ${state.sessionId}
        `;
        const sessionSpeak: any = sessionRowsSpeak[0] ?? null;
        log('info', 'telnyx.speak_ended', {
          requestId,
          sessionId: state.sessionId,
          sessionStatus: sessionSpeak?.status ?? null,
        });
        if (sessionSpeak?.status === 'COMPLETED') {
          await callHangup(call_control_id);
          break;
        }
        // Small delay before listening — prevents audio buffer bleed from AI TTS
        // being captured at the start of the transcription session.
        await new Promise(r => setTimeout(r, 400));

        // Start real-time transcription — fires call.transcription webhooks
        log('info', 'telnyx.start_transcription', { requestId, sessionId: state.sessionId });
        try {
          await startTranscription(call_control_id, {
            engine: 'Telnyx',
            track: 'inbound',  // only transcribe the caller's voice (not AI TTS)
            clientState: client_state,
          });
          log('info', 'telnyx.start_transcription_ok', { requestId, sessionId: state.sessionId });
        } catch (transcriptionErr) {
          log('error', 'telnyx.start_transcription_failed', { requestId, sessionId: state.sessionId, ...errorFields(transcriptionErr) });
          // Hangup gracefully if transcription unavailable
          await callHangup(call_control_id).catch(() => {});
        }
        break;
      }

      // ── call.transcription — real-time STT from start_transcription ────────
      // Telnyx fires this repeatedly as the trainee speaks.
      // Only process is_final=true (complete utterance); ignore partials.
      // When is_final=true: stop transcription → call Groq → speak AI reply
      // → call.speak.ended will restart transcription automatically.
      case 'call.transcription': {
        if (!state) break;

        const transcriptionData = payload.transcription_data;
        // Log metadata only — never the transcript text (caller PII).
        log('info', 'telnyx.transcription', {
          requestId,
          sessionId: state.sessionId,
          isFinal: transcriptionData?.is_final ?? null,
          language: transcriptionData?.language ?? null,
        });
        if (!transcriptionData?.is_final) {
          // Partial result — ignore, wait for is_final=true
          break;
        }

        const transcript = transcriptionData.transcript?.trim() ?? '';
        const wordCount = transcript.split(/\s+/).filter(Boolean).length;

        if (!transcript || wordCount < 2) {
          // Empty or single-word transcript — treat as silence/noise, re-listen
          const turn = state.turnCount ?? 0;
          // Metadata only — the transcript text is caller PII, so log its shape
          // (word count), never the words. (The prior free-text line embedded the
          // raw transcript, contradicting the metadata-only rule two branches up.)
          log('warn', 'telnyx.transcription_noise', { requestId, sessionId: state.sessionId, turn, wordCount });
          try { await stopTranscription(call_control_id); } catch {}
          if (turn > 10) {
            await callHangup(call_control_id);
          } else {
            // Simply restart listening — don't prompt, avoid breaking flow
            await new Promise(r => setTimeout(r, 300));
            await startTranscription(call_control_id, {
              engine: 'Telnyx',
              track: 'inbound',
              clientState: client_state,
            }).catch(() => callHangup(call_control_id));
          }
          break;
        }

        // Phone-turn latency instrumentation (R-058): the founder's "half-speed"
        // signal was about the spoken experience. R-057 proved the chat text turn
        // is real-time, so the lag lives elsewhere on the voice path. `turnStart`
        // marks the trainee stopping speaking (the final transcript in hand); we
        // then measure the server-controllable gap before the simulated customer
        // can speak again: model reply generated, then dispatched to Telnyx TTS.
        const turnStart = Date.now();

        // Stop transcription and kick off Groq in parallel for lower latency.
        // We save the message and load history while Telnyx processes the stop.
        const [, scenarioRows, messages] = await Promise.all([
          stopTranscription(call_control_id).catch(() => {}),
          sql`SELECT script FROM scenarios WHERE id = ${state.scenarioId}`,
          sql`SELECT role, content FROM chat_messages WHERE session_id = ${state.sessionId} ORDER BY timestamp ASC`,
        ]);

        // Save caller's (trainee/AGENT) turn to DB
        await saveMessage(state.sessionId, 'AGENT', transcript);

        const scenario: any = scenarioRows[0] ?? null;
        const script = (scenario?.script ?? {}) as Record<string, unknown>;

        // Build conversation for Groq
        // AGENT = trainee speaking to AI customer → Groq 'user'
        // CUSTOMER = AI virtual customer → Groq 'assistant'
        const groqMessages: Array<{ role: 'user' | 'assistant'; content: string }> = (
          messages as Array<{ role: string; content: string }>
        ).map((m) => ({
          role: m.role === 'AGENT' ? ('user' as const) : ('assistant' as const),
          content: m.content,
        }));
        // Append the current agent turn so Groq has it in context
        groqMessages.push({ role: 'user' as const, content: transcript });
        // Cap the re-sent context to a fixed window (#155 P3b-7) — same lever as
        // the chat path. Short calls are unchanged; long ones keep the opener +
        // freshest turns so token cost / latency don't grow O(turns²). Scoring
        // still reloads the FULL transcript from the DB on [RESOLVED].
        const windowedMessages = windowConversation(groqMessages);

        // Same conversation-speed lever as the opening leg (R-059): route the
        // reply turn by difficulty rather than always paying the 70B latency.
        const customerModel = customerModelForDifficulty(resolveScenarioDifficulty(script));
        const systemPromptGather = buildSessionSystemPrompt(state.scenarioName, script, state.sessionId);
        const client = getGroqClient();
        const aiReply = await client.chatCompletion({
          model: customerModel,
          messages: [
            { role: 'system', content: systemPromptGather },
            ...windowedMessages,
          ],
          max_tokens: 150,
          temperature: 0.8,
        });

        // Model reply is ready — the compute leg the trainee waits through.
        const replyReadyMs = Date.now() - turnStart;

        const aiText = aiReply.choices[0]?.message?.content?.trim() ?? '';
        const isResolved = aiText.includes('[RESOLVED]');
        const cleanText = aiText.replace('[RESOLVED]', '').trim();

        // Save AI reply to DB (AI = CUSTOMER role) — keep its id so this turn's
        // latency telemetry (R-070) can be stamped once the dispatch total is known.
        const replyMsgId = await saveMessage(state.sessionId, 'CUSTOMER', cleanText);
        const replyRouteReason = routeReasonForDifficulty(resolveScenarioDifficulty(script));

        if (isResolved) {
          // Load the full transcript from the DB, then run the SAME
          // end-of-session path as chat (COMPLETED + score + batched insert +
          // scoring_status). Previously this branch re-implemented scoring and
          // never wrote scoring_status, so every phone session was `null` in
          // the manager report.
          const allMessages = await sql`
            SELECT role, content FROM chat_messages
            WHERE session_id = ${state.sessionId}
            ORDER BY timestamp ASC
          `;
          const fullTranscript = (allMessages as Array<{ role: string; content: string }>).map((m) => ({
            role: m.role as 'CUSTOMER' | 'AGENT',
            content: m.content,
          }));
          await finalizeAndScoreSession(state.sessionId, fullTranscript);
        }

        const newState: TelnyxClientState = {
          ...state,
          turnCount: (state.turnCount ?? 0) + 1,
        };

        // Speak AI reply — call.speak.ended will restart startTranscription automatically
        // (or hang up if isResolved — checked in call.speak.ended handler)
        const speakStart = Date.now();
        await callSpeak(call_control_id, {
          payload: cleanText,
          clientState: encodeClientState(newState as unknown as Record<string, unknown>),
        });
        // Dispatch gap excludes the resolved-turn scoring block above so the metric
        // is comparable turn-to-turn: reply-ready time + the TTS dispatch itself.
        const replyTiming = classifyPhoneTurn(replyReadyMs, replyReadyMs + (Date.now() - speakStart));
        // Persist the same felt-speed number the log reports so the R-068
        // byModality split populates the PHONE bucket (R-070).
        await stampTurnTelemetry(
          replyMsgId,
          phoneTurnTelemetry(replyTiming, customerModel, replyRouteReason),
          aiReply.usage,
        );
        log('info', 'telnyx.turn_latency', {
          requestId,
          sessionId: state.sessionId,
          leg: 'reply',
          model: customerModel,
          replyReadyMs: replyTiming.replyReadyMs,
          speakDispatchMs: replyTiming.speakDispatchMs,
          tier: replyTiming.tier,
        });
        break;
      }

      // ── Call hung up — finalize session ─────────────────────────────────────
      case 'call.hangup': {
        if (!state?.sessionId) break;
        await sql`
          UPDATE simulation_sessions
          SET status = 'ABANDONED', ended_at = NOW()
          WHERE id = ${state.sessionId} AND status != 'COMPLETED'
        `;
        break;
      }

      default:
        // Acknowledge unhandled events silently
        break;
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function saveMessage(
  sessionId: string,
  role: 'CUSTOMER' | 'AGENT',
  content: string,
): Promise<string> {
  const rows = await sql`
    INSERT INTO chat_messages (id, session_id, role, content, timestamp)
    VALUES (gen_random_uuid(), ${sessionId}, ${role}, ${content}, NOW())
    RETURNING id
  `;
  return (rows as Array<{ id: string }>)[0].id;
}

/**
 * Stamp a saved CUSTOMER phone-turn row with its latency telemetry (R-070).
 * The phone path saves the reply BEFORE the TTS-dispatch total is known (the row
 * must exist for the resolved-turn scoring read), so telemetry is written as a
 * follow-up UPDATE once `classifyPhoneTurn` has the full timing — mirroring the
 * columns R-066 persists at the chat path's CUSTOMER INSERT. AGENT rows and any
 * turn where dispatch never completes stay NULL, exactly like the chat path.
 */
async function stampTurnTelemetry(
  messageId: string,
  t: PersistedTurnTelemetry,
  usage?: GroqTokenUsage | null,
) {
  await sql`
    UPDATE chat_messages
    SET ttft_ms = ${t.ttftMs},
        total_ms = ${t.totalMs},
        latency_tier = ${t.latencyTier},
        model = ${t.model},
        route_reason = ${t.routeReason},
        prompt_tokens = ${usage?.prompt_tokens ?? null},
        completion_tokens = ${usage?.completion_tokens ?? null},
        total_tokens = ${usage?.total_tokens ?? null}
    WHERE id = ${messageId}
  `;
}
