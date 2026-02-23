
/**
 * POST /api/telnyx/webhook
 *
 * Receives Telnyx Call Control webhook events and drives the AI phone simulation.
 *
 * Flow:
 *   1. call.answered      → AI speaks the scenario opening line, then listens
 *   2. call.gather.ended  → STT result arrives; send to Groq AI; speak the response
 *   3. call.speak.ended   → AI finished speaking; start listening again (gather)
 *   4. call.hangup        → End session, trigger scoring
 *
 * Event reference: https://developers.telnyx.com/docs/call-control/receiving-webhooks
 */
import { NextResponse } from 'next/server';
import { getGroq } from '@/lib/ai';
import { sql } from '@/lib/db';
import {
  callSpeak,
  callGather,
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
      // gather.ended specific
      transcript?: string;
      reason?: string;
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

  // Verify Telnyx webhook signature in production
  const rawBody = await clonedRequest.text();
  const signatureValid = await verifyTelnyxWebhook(clonedRequest.headers, rawBody);
  if (!signatureValid) {
    console.warn('Telnyx webhook signature verification failed');
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

  try {
    switch (event_type) {
      // ── Call answered — AI speaks opening ───────────────────────────────────
      case 'call.answered': {
        if (!state) break;

        // Load scenario script for the opening line
        const scenarioRows = await sql`
          SELECT id, script FROM scenarios WHERE id = ${state.scenarioId}
        `;
        const scenario: any = scenarioRows[0] ?? null;

        const script = (scenario?.script ?? {}) as Record<string, unknown>;
        const persona = (script.customerPersona as string | undefined) ?? 'a customer who needs help';
        const objective = (script.customerObjective as string | undefined) ?? 'get help with their issue';
        const difficulty = (script.difficulty as string | undefined) ?? 'medium';

        // Generate AI opening line via Groq
        const opening = await (await getGroq()).chat.completions.create({
          model: 'llama-3.3-70b-versatile',
          messages: [
            {
              role: 'system',
              content: buildSystemPrompt(persona, objective, difficulty),
            },
            {
              role: 'user',
              content: '[START_CONVERSATION]',
            },
          ],
          max_tokens: 100,
        });

        const openingText = opening.choices[0]?.message?.content?.trim() ?? 'Hello?';
        const cleanOpening = openingText.replace('[RESOLVED]', '').trim();

        // Save AI's opening message to DB (AI = CUSTOMER role; trainee = AGENT role)
        await saveMessage(state.sessionId, 'CUSTOMER', cleanOpening);

        // Speak the opening line, then gather
        const newState = { ...state, turnCount: 1 };
        await callSpeak(call_control_id, {
          payload: cleanOpening,
          clientState: encodeClientState(newState as unknown as Record<string, unknown>),
        });
        break;
      }

      // ── AI finished speaking — start gathering caller input ──────────────────
      case 'call.speak.ended': {
        if (!state) break;

        // Check if conversation was flagged as resolved (session ended by AI)
        const sessionRows = await sql`
          SELECT status FROM simulation_sessions WHERE id = ${state.sessionId}
        `;
        const session: any = sessionRows[0] ?? null;
        if (session?.status === 'COMPLETED') {
          await callHangup(call_control_id);
          break;
        }

        await callGather(call_control_id, {
          timeout: 4000,
          speechTimeout: 10000,
          clientState: client_state,
        });
        break;
      }

      // ── Gather ended — caller spoke, process the transcript ─────────────────
      case 'call.gather.ended': {
        if (!state) break;

        const transcript = payload.transcript?.trim();
        if (!transcript) {
          // No speech detected — ask AI to prompt again or hang up after too many retries
          const turn = state.turnCount ?? 0;
          if (turn > 10) {
            await callHangup(call_control_id);
          } else {
            await callGather(call_control_id, {
              timeout: 6000,
              speechTimeout: 12000,
              clientState: client_state,
            });
          }
          break;
        }

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
        const persona = (script.customerPersona as string | undefined) ?? 'a customer who needs help';
        const objective = (script.customerObjective as string | undefined) ?? 'get help with their issue';
        const difficulty = (script.difficulty as string | undefined) ?? 'medium';

        // Build conversation for Groq
        // AGENT = trainee speaking to AI customer → Groq 'user'
        // CUSTOMER = AI virtual customer → Groq 'assistant'
        const groqMessages = messages.map((m: { role: string; content: string }) => ({
          role: m.role === 'AGENT' ? ('user' as const) : ('assistant' as const),
          content: m.content,
        }));

        const aiReply = await (await getGroq()).chat.completions.create({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: buildSystemPrompt(persona, objective, difficulty) },
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
          // End the session
          await sql`
            UPDATE simulation_sessions
            SET status = 'COMPLETED', ended_at = NOW()
            WHERE id = ${state.sessionId}
          `;
          // TODO: trigger scoring (same as chat route — POST /api/scoring)
        }

        const newState: TelnyxClientState = {
          ...state,
          turnCount: (state.turnCount ?? 0) + 1,
        };

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
  } catch (err) {
    console.error(`Telnyx webhook error for ${event_type}:`, err);
    // Always return 200 to Telnyx to prevent retries for app errors
  }

  // Telnyx expects a 200 response for all webhook events
  return NextResponse.json({ received: true });
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildSystemPrompt(persona: string, objective: string, difficulty: string): string {
  return `You are ${persona}. Your goal is to ${objective}.
Difficulty level: ${difficulty}.
Respond naturally as this customer would on a phone call. Keep your responses concise (1–3 sentences).
When your issue is fully resolved or your goal is achieved, append [RESOLVED] at the end of your final message.
Do not break character. Do not mention that you are an AI.`;
}

async function saveMessage(sessionId: string, role: 'CUSTOMER' | 'AGENT', content: string) {
  await sql`
    INSERT INTO chat_messages (id, session_id, role, content, timestamp)
    VALUES (gen_random_uuid(), ${sessionId}, ${role}, ${content}, NOW())
  `;
}
