
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
import { buildSessionSystemPrompt, scoreSession } from '@/lib/ai';
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
  // Clone request for signature verification (body can only be read once)
  const clonedRequest = request.clone();
  
  let body: TelnyxWebhookPayload;
  try {
    body = (await request.json()) as TelnyxWebhookPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const eventType = body?.data?.event_type ?? 'unknown';
  console.log(`[telnyx] incoming webhook: ${eventType}`);

  // Verify Telnyx webhook signature in production
  const rawBody = await clonedRequest.text();
  const signatureValid = await verifyTelnyxWebhook(clonedRequest.headers, rawBody);
  if (!signatureValid) {
    console.warn(`[telnyx] signature verification FAILED for event: ${eventType}`);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const { event_type, payload } = body.data;
  const { call_control_id, client_state } = payload;

  // Decode session context from client_state
  let state: TelnyxClientState | null = null;
  if (client_state) {
    try {
      state = decodeClientState<TelnyxClientState>(client_state);
    } catch {
      console.warn('Could not decode client_state:', client_state);
    }
  }

  // ── Return 200 to Telnyx IMMEDIATELY, then process in background ─────────────
  // Telnyx retries the webhook after ~10s with no response. Groq + Neon cold
  // starts can take 5–15s each, easily exceeding that timeout. Duplicate
  // call.answered retries create conflicting gather requests that cancel each
  // other, making the call permanently silent.
  //
  // ctx.waitUntil() keeps the CF Worker alive after the response is sent.
  const processingPromise = handleEvent(event_type, payload, state, call_control_id, client_state);
  try {
    const { ctx } = getCloudflareContext();
    ctx.waitUntil(processingPromise.catch(err =>
      console.error(`[telnyx] webhook error (${event_type}):`, err)
    ));
  } catch {
    // Local dev — not in a CF Worker context; await directly
    await processingPromise.catch(err =>
      console.error(`[telnyx] webhook error (${event_type}):`, err)
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
) {
  console.log(`[telnyx] event: ${event_type} | session: ${state?.sessionId ?? 'no-state'} | turn: ${state?.turnCount ?? 0}`);
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
          console.log('[telnyx] call.answered: already processed (idempotency skip), session:', state.sessionId);
          break;
        }

        // Load scenario script for the opening line
        const scenarioRows = await sql`
          SELECT id, script FROM scenarios WHERE id = ${state.scenarioId}
        `;
        const scenario: any = scenarioRows[0] ?? null;
        const script = (scenario?.script ?? {}) as Record<string, unknown>;

        // Generate AI opening line via Groq
        const systemPromptOpening = buildSessionSystemPrompt(state.scenarioName, script);
        const client = getGroqClient();
        const opening = await client.chatCompletion({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: systemPromptOpening },
            { role: 'user', content: '[START_CONVERSATION]' },
          ],
          max_tokens: 100,
        });

        const openingText = opening.choices[0]?.message?.content?.trim() ?? 'Hello?';
        const cleanOpening = openingText.replace('[RESOLVED]', '').trim();

        // Save AI opening (CUSTOMER role)
        await saveMessage(state.sessionId, 'CUSTOMER', cleanOpening);

        // Speak the opening — call.speak.ended will trigger startTranscription
        const newState = { ...state, turnCount: 1 };
        await callSpeak(call_control_id, {
          payload: cleanOpening,
          clientState: encodeClientState(newState as unknown as Record<string, unknown>),
        });
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
        console.log(`[telnyx] call.speak.ended: session status=${sessionSpeak?.status}, call_control_id=${call_control_id.slice(0, 20)}...`);
        if (sessionSpeak?.status === 'COMPLETED') {
          await callHangup(call_control_id);
          break;
        }
        // Start real-time transcription — fires call.transcription webhooks
        console.log('[telnyx] call.speak.ended: calling startTranscription...');
        try {
          await startTranscription(call_control_id, {
            engine: 'Telnyx',
            track: 'inbound',  // only transcribe the caller's voice (not AI TTS)
            clientState: client_state,
          });
          console.log('[telnyx] call.speak.ended: startTranscription succeeded');
        } catch (transcriptionErr) {
          console.error('[telnyx] call.speak.ended: startTranscription FAILED:', transcriptionErr);
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
        console.log(`[telnyx] call.transcription: is_final=${transcriptionData?.is_final}, transcript='${transcriptionData?.transcript?.slice(0, 80) ?? ''}', language=${transcriptionData?.language}`);
        if (!transcriptionData?.is_final) {
          // Partial result — ignore, wait for is_final=true
          break;
        }

        const transcript = transcriptionData.transcript?.trim() ?? '';

        if (!transcript) {
          // is_final but empty transcript — silence / no speech detected
          const turn = state.turnCount ?? 0;
          console.warn('[telnyx] call.transcription is_final with empty transcript (silence). turn:', turn);
          // Stop transcription first, then re-prompt
          try { await stopTranscription(call_control_id); } catch {}
          if (turn > 10) {
            await callHangup(call_control_id);
          } else {
            await callSpeak(call_control_id, {
              payload: 'Are you still there?',
              clientState: client_state,
            });
          }
          break;
        }

        // Stop transcription before processing — prevents picking up AI's TTS voice
        await stopTranscription(call_control_id);

        // Save caller's (trainee/AGENT) turn to DB
        await saveMessage(state.sessionId, 'AGENT', transcript);

        // Load conversation history for context
        const messages = await sql`
          SELECT role, content
          FROM chat_messages
          WHERE session_id = ${state.sessionId}
          ORDER BY timestamp ASC
        `;

        const scenarioRows = await sql`
          SELECT script FROM scenarios WHERE id = ${state.scenarioId}
        `;
        const scenario: any = scenarioRows[0] ?? null;
        const script = (scenario?.script ?? {}) as Record<string, unknown>;

        // Build conversation for Groq
        // AGENT = trainee speaking to AI customer → Groq 'user'
        // CUSTOMER = AI virtual customer → Groq 'assistant'
        const groqMessages = (messages as any).map((m: { role: string; content: string }) => ({
          role: m.role === 'AGENT' ? ('user' as const) : ('assistant' as const),
          content: m.content,
        }));

        const systemPromptGather = buildSessionSystemPrompt(state.scenarioName, script);
        const client = getGroqClient();
        const aiReply = await client.chatCompletion({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: systemPromptGather },
            ...groqMessages,
          ],
          max_tokens: 150,
        });

        const aiText = aiReply.choices[0]?.message?.content?.trim() ?? '';
        const isResolved = aiText.includes('[RESOLVED]');
        const cleanText = aiText.replace('[RESOLVED]', '').trim();

        // Save AI reply to DB (AI = CUSTOMER role)
        await saveMessage(state.sessionId, 'CUSTOMER', cleanText);

        if (isResolved) {
          // Mark session completed
          await sql`
            UPDATE simulation_sessions
            SET status = 'COMPLETED', ended_at = NOW()
            WHERE id = ${state.sessionId}
          `;
          // Load criteria for this job title (fallback: all active criteria)
          const criteriaRows = await sql`
            SELECT c.id, c.name, c.description, c.weight
            FROM job_criteria jc
            JOIN criteria c ON c.id = jc.criteria_id
            WHERE jc.job_title_id = ${state.jobTitleId} AND c.active = true
          `;
          let scoringCriteria = criteriaRows as any[];
          if (scoringCriteria.length === 0) {
            const globalCriteria = await sql`SELECT id, name, description, weight FROM criteria WHERE active = true`;
            scoringCriteria = globalCriteria as any[];
          }
          // Load full transcript for scoring
          const allMessages = await sql`
            SELECT role, content FROM chat_messages
            WHERE session_id = ${state.sessionId}
            ORDER BY timestamp ASC
          `;
          const fullTranscript = (allMessages as any[]).map((m: any) => ({
            role: m.role as 'CUSTOMER' | 'AGENT',
            content: m.content,
          }));
          if (fullTranscript.length >= 2 && scoringCriteria.length > 0) {
            try {
              const scores = await scoreSession(fullTranscript, scoringCriteria);
              for (const s of scores) {
                await sql`
                  INSERT INTO scores (id, session_id, criteria_id, score, feedback, scored_at)
                  VALUES (gen_random_uuid(), ${state.sessionId}, ${s.criteriaId}, ${s.score}, ${s.justification}, NOW())
                `;
              }
            } catch (err) {
              console.error('[telnyx] Auto-scoring failed:', err);
            }
          }
        }

        const newState: TelnyxClientState = {
          ...state,
          turnCount: (state.turnCount ?? 0) + 1,
        };

        // Speak AI reply — call.speak.ended will restart startTranscription automatically
        // (or hang up if isResolved — checked in call.speak.ended handler)
        await callSpeak(call_control_id, {
          payload: cleanText,
          clientState: encodeClientState(newState as unknown as Record<string, unknown>),
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

async function saveMessage(sessionId: string, role: 'CUSTOMER' | 'AGENT', content: string) {
  await sql`
    INSERT INTO chat_messages (id, session_id, role, content, timestamp)
    VALUES (gen_random_uuid(), ${sessionId}, ${role}, ${content}, NOW())
  `;
}
