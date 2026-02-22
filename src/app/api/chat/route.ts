import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { buildSessionSystemPrompt, streamNextCustomerMessage, scoreSession } from '@/lib/ai';


// POST /api/chat
// Body: { sessionId: string; content: string }
// Saves the agent's message, streams back the AI customer's reply as SSE.
// If the agent's message contains "[END]" or turn limit is reached, ends the session and scores it.

export async function POST(request: Request) {
  try {
    console.log('[Chat API] POST request received');
    const body = await request.json();
    const { sessionId, content } = body as { sessionId: string; content: string };

    console.log('[Chat API] Request body:', { sessionId: sessionId?.substring(0, 8), content: content?.substring(0, 50) });

    if (!sessionId || !content?.trim()) {
      console.error('[Chat API] Missing required fields');
      return NextResponse.json({ error: 'sessionId and content are required' }, { status: 400 });
    }

    // ── 1. Load session ───────────────────────────────────────────────────────
    console.log('[Chat API] Loading session:', sessionId);
    const session = await prisma.simulationSession.findUnique({
      where: { id: sessionId },
      include: {
        scenario: true,
        jobTitle: {
          include: {
            jobCriteria: {
              where: { criteria: { active: true } },
              include: { criteria: true },
            },
          },
        },
        messages: { orderBy: { timestamp: 'asc' } },
      },
    });

    if (!session) {
      console.error('[Chat API] Session not found:', sessionId);
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    console.log('[Chat API] Session loaded:', { status: session.status, type: session.type, scenario: session.scenario.name });

    if (session.status === 'COMPLETED' || session.status === 'CANCELLED') {
      console.error('[Chat API] Session already closed');
      return NextResponse.json({ error: 'Session is already closed' }, { status: 400 });
    }

    // ── 2. Save agent message ─────────────────────────────────────────────────
    const isStartSignal = content.trim() === '[START]';
    if (!isStartSignal) {
      await prisma.chatMessage.create({
        data: {
          sessionId,
          role: 'AGENT',
          content: content.trim(),
        },
      });
    }

    // ── 3. Check for end signal ───────────────────────────────────────────────
    const shouldEnd =
      content.trim().toUpperCase() === '[END]' ||
      content.trim().toLowerCase() === 'end conversation';

    if (shouldEnd) {
      return await endSession(sessionId, session);
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
          return await endSession(sessionId, session);
        }
      }
    }

    // ── 4. Build history for AI ───────────────────────────────────────────────
    const systemPrompt = buildSessionSystemPrompt(
      session.scenario.name,
      session.scenario.script
    );

    // Include the just-saved agent message in history
    const history = [
      ...session.messages.map((m: { role: string; content: string }) => ({
        role: m.role as 'CUSTOMER' | 'AGENT',
        content: m.content,
      })),
      { role: 'AGENT' as const, content: content.trim() },
    ];

    // ── 5. Stream AI response ─────────────────────────────────────────────────
    const encoder = new TextEncoder();
    let fullResponse = '';

    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of streamNextCustomerMessage(systemPrompt, history)) {
            fullResponse += chunk;
            const event = `data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`;
            controller.enqueue(encoder.encode(event));
          }

          // Strip [RESOLVED] signal from stored message
          const isResolved = /\[RESOLVED\]/i.test(fullResponse);
          const cleanedResponse = fullResponse.replace(/\[RESOLVED\]\s*$/i, '').trim();

          // Save the full AI message to DB
          await prisma.chatMessage.create({
            data: {
              sessionId,
              role: 'CUSTOMER',
              content: cleanedResponse,
            },
          });

          if (isResolved) {
            // Customer signalled resolution — auto-end the session
            const sessionEndingEvent = `data: ${JSON.stringify({ type: 'session_ending', content: cleanedResponse })}\n\n`;
            controller.enqueue(encoder.encode(sessionEndingEvent));

            // Reload session with the newly-saved message included
            const refreshed = await prisma.simulationSession.findUnique({
              where: { id: sessionId },
              include: {
                scenario: true,
                jobTitle: {
                  include: {
                    jobCriteria: {
                      where: { criteria: { active: true } },
                      include: { criteria: true },
                    },
                  },
                },
                messages: { orderBy: { timestamp: 'asc' } },
              },
            });
            if (refreshed) {
              await endSession(sessionId, refreshed);
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
          const errEvent = `data: ${JSON.stringify({ type: 'error', message: 'AI error' })}\n\n`;
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
// Returns all messages in a session (for initial load / resume)
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }

    const session = await prisma.simulationSession.findUnique({
      where: { id: sessionId },
      include: {
        scenario: true,
        jobTitle: true,
        messages: { orderBy: { timestamp: 'asc' } },
        scores: { include: { criteria: true } },
      },
    });

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    return NextResponse.json(session);
  } catch (error) {
    console.error('[chat] GET failed:', error);
    return NextResponse.json({ error: 'Failed to fetch session' }, { status: 500 });
  }
}

// ─── Helper: End a session and auto-score ─────────────────────────────────────

async function endSession(
  sessionId: string,
  session: Awaited<ReturnType<typeof prisma.simulationSession.findUnique>> & {
    messages: Array<{ role: string; content: string }>;
    jobTitle: {
      jobCriteria: Array<{
        criteria: { id: string; name: string; description: string | null; weight: number };
      }>;
    };
  }
) {
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  // Mark session COMPLETED
  await prisma.simulationSession.update({
    where: { id: sessionId },
    data: { status: 'COMPLETED', endedAt: new Date() },
  });

  // Collect criteria for this job title (or all active criteria as fallback)
  const jobCriteria = session.jobTitle.jobCriteria.map(
    (jc: { criteria: { id: string; name: string; description: string | null; weight: number } }) => jc.criteria
  );
  const criteria =
    jobCriteria.length > 0
      ? jobCriteria
      : await prisma.criteria.findMany({ where: { active: true } });

  // Auto-score using AI
  const transcript = session.messages.map((m: { role: string; content: string }) => ({
    role: m.role as 'CUSTOMER' | 'AGENT',
    content: m.content,
  }));

  let scores: Array<{ criteriaId: string; score: number; justification: string }> = [];
  if (transcript.length >= 2) {
    try {
      scores = await scoreSession(transcript, criteria);
    } catch (err) {
      console.error('[chat] Auto-scoring failed:', err);
    }
  }

  // Save scores
  if (scores.length > 0) {
    await prisma.score.createMany({
      data: scores.map(s => ({
        sessionId,
        criteriaId: s.criteriaId,
        score: s.score,
        feedback: s.justification,
      })),
    });
  }

  // Return final session state
  const finalSession = await prisma.simulationSession.findUnique({
    where: { id: sessionId },
    include: {
      messages: { orderBy: { timestamp: 'asc' } },
      scores: { include: { criteria: true } },
      scenario: true,
      jobTitle: true,
    },
  });

  return NextResponse.json({ session: finalSession, ended: true });
}
