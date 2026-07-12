import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import {
  buildSessionSystemPrompt,
  streamNextCustomerMessage,
  scoreSession,
  customerModelForDifficulty,
  resolveScenarioDifficulty,
} from '@/lib/ai';
import { requireAuth, AuthError } from '@/lib/auth-api';
import { canAccessSession } from '@/lib/session-access';
import { sanitizeSessionScenario } from '@/lib/scenario-safety';
import { MAX_AGENT_MESSAGE_CHARS, exceedsTurnRate } from '@/lib/limits';


// POST /api/chat
// Body: { sessionId: string; content: string }
// Saves the agent's message, streams back the AI customer's reply as SSE.
// If the agent's message contains "[END]" or turn limit is reached, ends the session and scores it.

export async function POST(request: Request) {
  try {
    // Require authentication for chat interactions
    const { session: authSession } = await requireAuth();
    const userId = authSession.user.id;
    const userOrgId = authSession.user.orgId;
    const userRole = authSession.user.role;

    console.log('[Chat API] POST request received');
    const body = await request.json();
    const { sessionId, content } = body as { sessionId: string; content: string };

    console.log('[Chat API] Request body:', { sessionId: sessionId?.substring(0, 8), content: content?.substring(0, 50) });

    if (!sessionId || !content?.trim()) {
      console.error('[Chat API] Missing required fields');
      return NextResponse.json({ error: 'sessionId and content are required' }, { status: 400 });
    }
    // Every turn is a billable LLM call — cap message size so oversized bodies
    // can't inflate token spend (and prompt-stuff the customer model).
    if (content.length > MAX_AGENT_MESSAGE_CHARS) {
      return NextResponse.json(
        { error: `Message too long (max ${MAX_AGENT_MESSAGE_CHARS} characters)` },
        { status: 400 }
      );
    }

    // ── 1. Load session ───────────────────────────────────────────────────────
    console.log('[Chat API] Loading session:', sessionId);
    const sessionResult = await sql`
      SELECT 
        ss.id,
        ss.org_id as "orgId",
        ss.user_id as "userId",
        ss.status,
        ss.type,
        json_build_object(
          'id', s.id,
          'name', s.name,
          'script', s.script
        ) as scenario,
        COALESCE(
          json_agg(
            json_build_object(
              'role', m.role,
              'content', m.content,
              'timestamp', m.timestamp
            ) ORDER BY m.timestamp
          ) FILTER (WHERE m.id IS NOT NULL),
          '[]'
        ) as messages
      FROM simulation_sessions ss
      LEFT JOIN scenarios s ON s.id = ss.scenario_id
      LEFT JOIN chat_messages m ON m.session_id = ss.id
      WHERE ss.id = ${sessionId}
      GROUP BY ss.id, s.id
    `;
    // NOTE: scoring criteria are intentionally NOT loaded here. They are only
    // needed when a session ends (scoring), so endSession() resolves them by
    // sessionId — keeping the criteria join off the per-turn conversational
    // hot path (this query runs before every streamed reply).

    if (sessionResult.length === 0) {
      console.error('[Chat API] Session not found:', sessionId);
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    
    const session = sessionResult[0];

    // Multi-tenancy: verify user can access this session (owner or same-org admin)
    if (!canAccessSession(session, { id: userId, role: userRole, orgId: userOrgId })) {
      console.error('[Chat API] Access denied for session:', sessionId);
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    console.log('[Chat API] Session loaded:', { status: session.status, type: session.type, scenario: session.scenario.name });

    if (session.status === 'COMPLETED' || session.status === 'CANCELLED') {
      console.error('[Chat API] Session already closed');
      return NextResponse.json({ error: 'Session is already closed' }, { status: 400 });
    }

    // Turn throttle: a human can't reply in under MIN_TURN_INTERVAL_MS; a
    // script hammering the endpoint burns Groq tokens. Enforced against DB
    // message timestamps so it holds across Worker isolates.
    const lastAgentMessage = [...(session.messages as Array<{ role: string; timestamp?: string }>)]
      .reverse()
      .find(m => m.role === 'AGENT');
    if (exceedsTurnRate(lastAgentMessage?.timestamp, Date.now())) {
      return NextResponse.json(
        { error: 'Too many messages — slow down' },
        { status: 429 }
      );
    }

    // ── 2. Save agent message ─────────────────────────────────────────────────
    // Fire the INSERT now but DON'T block the turn on it: on a normal turn we
    // let it run concurrently with the (much longer) AI stream and only await
    // it once, after streaming, before any read that depends on it. This drops
    // a Neon round-trip off the pre-first-token path — the latency the trainee
    // actually feels. On terminal branches (end/maxTurns) we await before
    // scoring so the transcript read is durable.
    const isStartSignal = content.trim() === '[START]';
    const agentInsertPromise = isStartSignal
      ? null
      : sql`
        INSERT INTO chat_messages (id, session_id, role, content, timestamp)
        VALUES (gen_random_uuid(), ${sessionId}, 'AGENT', ${content.trim()}, NOW())
      `;

    // ── 3. Check for end signal ───────────────────────────────────────────────
    const shouldEnd =
      content.trim().toUpperCase() === '[END]' ||
      content.trim().toLowerCase() === 'end conversation';

    if (shouldEnd) {
      if (agentInsertPromise) await agentInsertPromise;
      return await endSession(sessionId, session as any);
    }

    // ── 3.5. Enforce maxTurns ─────────────────────────────────────────────────
    if (!isStartSignal) {
      const script = session.scenario.script as Record<string, unknown> | null;
      const maxTurns = typeof script?.maxTurns === 'number' ? script.maxTurns : undefined;
      if (maxTurns && maxTurns > 0) {
        // session.messages was loaded before this turn's agent message was saved,
        // so prior agent turn count + 1 = current turn number.
        const priorAgentTurns = session.messages.filter(
          (m: { role: string }) => m.role === 'AGENT'
        ).length;
        if (priorAgentTurns + 1 >= maxTurns) {
          console.log(`[Chat API] maxTurns (${maxTurns}) reached — auto-ending session`);
          if (agentInsertPromise) await agentInsertPromise;
          return await endSession(sessionId, session as any);
        }
      }
    }

    // ── 4. Build history for AI ───────────────────────────────────────────────
    const systemPrompt = buildSessionSystemPrompt(
      session.scenario.name,
      session.scenario.script,
      sessionId
    );
    // Conversation-speed lever: pick the model tier by scenario difficulty. Hard
    // scenarios keep the higher-realism 70B model; easy/medium use the ~3x faster
    // 8B model so the customer's reply streams back closer to real-time.
    const customerModel = customerModelForDifficulty(
      resolveScenarioDifficulty(session.scenario.script)
    );
    console.log('[Chat API] Customer model:', customerModel);
    console.log('[Chat API] System prompt length:', systemPrompt.length);
    console.log('[Chat API] System prompt preview:', systemPrompt.substring(0, 150) + '...');

    // Include the just-saved agent message in history (skip [START] signal)
    const history = [
      ...session.messages.map((m: { role: string; content: string }) => ({
        role: m.role as 'CUSTOMER' | 'AGENT',
        content: m.content,
      })),
      ...(isStartSignal ? [] : [{ role: 'AGENT' as const, content: content.trim() }]),
    ];
    console.log('[Chat API] Conversation history length:', history.length);
    console.log('[Chat API] Is start signal:', isStartSignal);

    // ── 5. Stream AI response ─────────────────────────────────────────────────
    const encoder = new TextEncoder();
    let fullResponse = '';

    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of streamNextCustomerMessage(systemPrompt, history, customerModel)) {
            fullResponse += chunk;
            const event = `data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`;
            controller.enqueue(encoder.encode(event));
          }

          // The agent-message INSERT was fired before streaming so it overlaps
          // the model latency; ensure it has landed before we persist the reply
          // and before any transcript read (ordering + scoring correctness).
          if (agentInsertPromise) await agentInsertPromise;

          // Strip [RESOLVED] signal from stored message
          const isResolved = /\[RESOLVED\]/i.test(fullResponse);
          const cleanedResponse = fullResponse.replace(/\[RESOLVED\]\s*$/i, '').trim();

          // Save the full AI message to DB
          await sql`
            INSERT INTO chat_messages (id, session_id, role, content, timestamp)
            VALUES (gen_random_uuid(), ${sessionId}, 'CUSTOMER', ${cleanedResponse}, NOW())
          `;

          if (isResolved) {
            // Customer signalled resolution — auto-end the session
            const sessionEndingEvent = `data: ${JSON.stringify({ type: 'session_ending', content: cleanedResponse })}\n\n`;
            controller.enqueue(encoder.encode(sessionEndingEvent));

            // Reload the transcript with the newly-saved message included.
            // Criteria are resolved inside endSession() by sessionId, so this
            // refresh only needs the message list.
            const refreshedResult = await sql`
              SELECT
                ss.id,
                COALESCE(
                  json_agg(
                    json_build_object(
                      'role', m.role,
                      'content', m.content
                    ) ORDER BY m.timestamp
                  ) FILTER (WHERE m.id IS NOT NULL),
                  '[]'
                ) as messages
              FROM simulation_sessions ss
              LEFT JOIN chat_messages m ON m.session_id = ss.id
              WHERE ss.id = ${sessionId}
              GROUP BY ss.id
            `;
            if (refreshedResult.length > 0) {
              await endSession(sessionId, refreshedResult[0] as any);
            }
            const sessionEndedEvent = `data: ${JSON.stringify({ type: 'session_ended' })}\n\n`;
            controller.enqueue(encoder.encode(sessionEndedEvent));
          } else {
            // Normal turn — send done event
            const doneEvent = `data: ${JSON.stringify({ type: 'done', content: cleanedResponse })}\n\n`;
            controller.enqueue(encoder.encode(doneEvent));
          }
          controller.close();
        } catch (err) {
          // If the stream failed before we awaited the concurrent agent-message
          // INSERT, swallow its result so a late rejection can't surface as an
          // unhandled promise rejection.
          if (agentInsertPromise) await agentInsertPromise.catch(() => {});
          const errEvent = `data: ${JSON.stringify({ type: 'error', message: 'Simulation error' })}\n\n`;
          controller.enqueue(encoder.encode(errEvent));
          controller.close();
          console.error('[chat] Stream error:', err);
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('[chat] POST failed:', error);
    return NextResponse.json({ error: 'Failed to process message' }, { status: 500 });
  }
}

// GET /api/chat?sessionId=...
// Returns all messages in a session (for initial load / resume).
// Add ?stream=true to receive a live SSE stream of transcript updates (used by phone mode).
export async function GET(request: Request) {
  try {
    // Require authentication for reading session data
    const { session: viewer } = await requireAuth();
    const isAdmin = viewer.user.role === 'ADMIN';

    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }

    // Multi-tenancy: a session transcript (and its live phone stream) must only
    // be readable by the session owner or an admin in the same org — never by
    // any authenticated user who guesses the session UUID. Verify ownership
    // before emitting any data on either the JSON or the SSE path.
    const ownerRows = await sql`
      SELECT user_id as "userId", org_id as "orgId"
      FROM simulation_sessions
      WHERE id = ${sessionId}
      LIMIT 1
    `;
    if (ownerRows.length === 0) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    if (!canAccessSession(ownerRows[0], {
      id: viewer.user.id,
      role: viewer.user.role,
      orgId: viewer.user.orgId,
    })) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // ── BL-054: SSE transcript stream for phone simulation ──────────────────────
    if (searchParams.get('stream') === 'true') {
      return phoneTranscriptStream(sessionId);
    }

    // Fetch session with all relations using raw SQL
    const result = await sql`
      SELECT 
        ss.id,
        ss.org_id as "orgId",
        ss.user_id as "userId",
        ss.db_user_id as "dbUserId",
        ss.job_title_id as "jobTitleId",
        ss.scenario_id as "scenarioId",
        ss.type,
        ss.status,
        ss.started_at as "startedAt",
        ss.ended_at as "endedAt",
        ss.created_at as "createdAt",
        json_build_object(
          'id', s.id,
          'name', s.name,
          'description', s.description,
          'type', s.type,
          'script', s.script
        ) as scenario,
        json_build_object(
          'id', jt.id,
          'name', jt.name,
          'description', jt.description
        ) as "jobTitle",
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'id', m.id,
              'role', m.role,
              'content', m.content,
              'timestamp', m.timestamp
            ) ORDER BY jsonb_build_object(
              'id', m.id,
              'role', m.role,
              'content', m.content,
              'timestamp', m.timestamp
            )
          ) FILTER (WHERE m.id IS NOT NULL),
          '[]'
        ) as messages,
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'id', sc.id,
                'score', sc.score,
                'feedback', sc.feedback,
                'criteria', json_build_object(
                  'id', c.id,
                  'name', c.name,
                  'description', c.description,
                  'weight', c.weight,
                  'category', c.category
                )
              ) ORDER BY sc.scored_at
            )
            FROM scores sc
            LEFT JOIN criteria c ON c.id = sc.criteria_id
            WHERE sc.session_id = ss.id
          ),
          '[]'
        ) as scores
      FROM simulation_sessions ss
      LEFT JOIN scenarios s ON s.id = ss.scenario_id
      LEFT JOIN job_titles jt ON jt.id = ss.job_title_id
      LEFT JOIN chat_messages m ON m.session_id = ss.id
      WHERE ss.id = ${sessionId}
      GROUP BY ss.id, s.id, jt.id
    `;

    if (result.length === 0) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Trainees must not receive the scenario's hidden mechanics via the session.
    return NextResponse.json(sanitizeSessionScenario(result[0], isAdmin));
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[chat] GET failed:', error);
    return NextResponse.json({ error: 'Failed to fetch session' }, { status: 500 });
  }
}

// ─── Helper: stream live phone transcript updates via SSE (BL-054) ────────────
// Polls DB every 1 second and pushes events to the client as messages arrive.
// Replaces the 3-second setInterval poll in PhoneInterface.

async function phoneTranscriptStream(sessionId: string): Promise<Response> {
  const encoder = new TextEncoder();
  const MAX_ITERATIONS = 300; // 5-minute cap (300 × 1 s)
  let lastMessageCount = -1;

  const readable = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          // controller already closed (client disconnected)
        }
      };

      try {
        for (let i = 0; i < MAX_ITERATIONS; i++) {
          const sessionResult = await sql`
            SELECT 
              ss.id,
              ss.status,
              json_build_object(
                'id', s.id,
                'name', s.name
              ) as scenario,
              json_build_object(
                'id', jt.id,
                'name', jt.name
              ) as "jobTitle",
              COALESCE(
                json_agg(
                  DISTINCT jsonb_build_object(
                    'id', m.id,
                    'role', m.role,
                    'content', m.content,
                    'timestamp', m.timestamp
                  ) ORDER BY jsonb_build_object(
                    'id', m.id,
                    'role', m.role,
                    'content', m.content,
                    'timestamp', m.timestamp
                  )
                ) FILTER (WHERE m.id IS NOT NULL),
                '[]'
              ) as messages,
              COALESCE(
                (
                  SELECT json_agg(
                    json_build_object(
                      'id', sc.id,
                      'score', sc.score,
                      'feedback', sc.feedback,
                      'criteria', json_build_object(
                        'id', c.id,
                        'name', c.name
                      )
                    ) ORDER BY sc.scored_at
                  )
                  FROM scores sc
                  LEFT JOIN criteria c ON c.id = sc.criteria_id
                  WHERE sc.session_id = ss.id
                ),
                '[]'
              ) as scores
            FROM simulation_sessions ss
            LEFT JOIN scenarios s ON s.id = ss.scenario_id
            LEFT JOIN job_titles jt ON jt.id = ss.job_title_id
            LEFT JOIN chat_messages m ON m.session_id = ss.id
            WHERE ss.id = ${sessionId}
            GROUP BY ss.id, s.id, jt.id
          `;

          if (sessionResult.length === 0) {
            send({ type: 'error', message: 'Session not found' });
            break;
          }

          const session = sessionResult[0];
          const isTerminal =
            session.status === 'COMPLETED' ||
            session.status === 'CANCELLED' ||
            session.status === 'ABANDONED';

          if (session.messages.length !== lastMessageCount || isTerminal) {
            lastMessageCount = session.messages.length;
            if (isTerminal) {
              send({ type: 'ended', session });
              break;
            }
            send({ type: 'transcript', messages: session.messages, status: session.status });
          }

          await new Promise<void>(r => setTimeout(r, 1_000));
        }
      } catch (err) {
        console.error('[chat] phoneTranscriptStream error:', err);
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: 'Stream error' })}\n\n`));
        } catch { /* already closed */ }
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

async function endSession(
  sessionId: string,
  session: {
    messages: Array<{ role: string; content: string }>;
  }
) {
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  // Mark session COMPLETED
  await sql`
    UPDATE simulation_sessions
    SET status = 'COMPLETED', ended_at = NOW()
    WHERE id = ${sessionId}
  `;

  // Resolve scoring criteria for this session's job title (active only). This
  // is fetched here — at end-of-session — rather than on every conversational
  // turn, so the criteria join stays off the streamed-reply hot path. Falls
  // back to all active criteria if the job has no explicit links (unchanged
  // scoring semantics vs. the previous per-turn load).
  let criteria = await sql`
    SELECT c.id, c.name, c.description, c.weight
    FROM simulation_sessions ss
    JOIN job_criteria jc ON jc.job_title_id = ss.job_title_id
    JOIN criteria c ON c.id = jc.criteria_id
    WHERE ss.id = ${sessionId} AND c.active = true
  `;
  if (criteria.length === 0) {
    criteria = await sql`SELECT id, name, description, weight FROM criteria WHERE active = true`;
  }

  // Auto-score using AI
  const transcript = session.messages.map((m: { role: string; content: string }) => ({
    role: m.role as 'CUSTOMER' | 'AGENT',
    content: m.content,
  }));

  let scores: Array<{ criteriaId: string; score: number; justification: string }> = [];
  const scorable = transcript.length >= 2 && criteria.length > 0;
  if (scorable) {
    try {
      scores = await scoreSession(transcript, criteria as any);
    } catch (err) {
      console.error('[chat] Auto-scoring failed:', err);
    }
  }
  // A scorable session that produced zero scores is a scoring-engine failure
  // (expired credential, parse failure, empty judge output) — not a genuinely
  // unscored call. Surface it so the client shows "couldn't score this session"
  // instead of a silent zero the manager can't distinguish from a bad call.
  const scoringFailed = scorable && scores.length === 0;

  // Save scores
  if (scores.length > 0) {
    for (const s of scores) {
      await sql`
        INSERT INTO scores (id, session_id, criteria_id, score, feedback, scored_at)
        VALUES (gen_random_uuid(), ${sessionId}, ${s.criteriaId}, ${s.score}, ${s.justification}, NOW())
      `;
    }
  }

  // Persist WHY a session has (or lacks) scores so the manager report can tell a
  // scoring-engine failure apart from a genuinely un-scorable call — a `null`
  // score in the analytics/CSV/PDF is otherwise indistinguishable between the
  // two, which is the "managers don't trust the /10 scores" kill-signal.
  const scoringStatus = !scorable
    ? 'NOT_SCORABLE'
    : scores.length > 0
      ? 'SCORED'
      : 'FAILED';
  await sql`
    UPDATE simulation_sessions
    SET scoring_status = ${scoringStatus}
    WHERE id = ${sessionId}
  `;

  // Return final session state
  const finalSessionResult = await sql`
    SELECT 
      ss.id,
      ss.org_id as "orgId",
      ss.user_id as "userId",
      ss.status,
      ss.scoring_status as "scoringStatus",
      ss.type,
      json_build_object(
        'id', s.id,
        'name', s.name
      ) as scenario,
      json_build_object(
        'id', jt.id,
        'name', jt.name
      ) as "jobTitle",
      COALESCE(
        json_agg(
          json_build_object(
            'id', m.id,
            'role', m.role,
            'content', m.content,
            'timestamp', m.timestamp
          ) ORDER BY m.timestamp
        ) FILTER (WHERE m.id IS NOT NULL),
        '[]'
      ) as messages,
      COALESCE(
        (
          SELECT json_agg(
            json_build_object(
              'id', sc.id,
              'score', sc.score,
              'feedback', sc.feedback,
              'criteria', json_build_object(
                'id', c.id,
                'name', c.name,
                'description', c.description,
                'weight', c.weight
              )
            )
          )
          FROM scores sc
          LEFT JOIN criteria c ON c.id = sc.criteria_id
          WHERE sc.session_id = ss.id
        ),
        '[]'
      ) as scores
    FROM simulation_sessions ss
    LEFT JOIN scenarios s ON s.id = ss.scenario_id
    LEFT JOIN job_titles jt ON jt.id = ss.job_title_id
    LEFT JOIN chat_messages m ON m.session_id = ss.id
    WHERE ss.id = ${sessionId}
    GROUP BY ss.id, s.id, jt.id
  `;

  return NextResponse.json({ session: finalSessionResult[0], ended: true, scoringFailed });
}
