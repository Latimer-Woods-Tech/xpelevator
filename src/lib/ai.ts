// groq-sdk is a CJS package with a dual CJS/ESM export — static ESM import can
// fail in the esbuild + Cloudflare Workers bundle (produces "handler is not a
// function" at runtime). Dynamic import() sidesteps that problem by deferring
// the resolution until the first AI call, at which point the CF runtime has
// fully initialised and the CJS interop shim works correctly.

import type { ScenarioScript, ScoreResult } from '@/types';
import type Groq from 'groq-sdk'; // type-only — no runtime import

// Re-export so callers that import from '@/lib/ai' still get these types
export type { ScenarioScript, ScoreResult };

// ─── Client (lazy dynamic import: avoids CF Worker bundle crash) ─────────────

let _groq: Groq | null = null;

export async function getGroq(): Promise<Groq> {
  if (!_groq) {
    // CRITICAL: Import polyfill BEFORE groq-sdk so http.Agent is available
    await import('./http-agent-polyfill');
    
    const { default: GroqClass } = await import('groq-sdk');
    const apiKey = process.env.GROQ_API_KEY?.replace(/\r/g, '');
    if (!apiKey) {
      console.error('[AI] GROQ_API_KEY is not set in environment variables');
      console.error('[AI] Available env vars:', Object.keys(process.env).filter(k => k.includes('GROQ') || k.includes('API')));
      throw new Error('GROQ_API_KEY environment variable is not set');
    }
    console.log('[AI] Initializing Groq client with key:', apiKey.substring(0, 10) + '...');
    _groq = new GroqClass({ apiKey }) as Groq;
  }
  return _groq;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

// ─── System Prompts ──────────────────────────────────────────────────────────

function buildCustomerSystemPrompt(
  scenarioName: string,
  script: ScenarioScript
): string {
  const difficultyGuide = {
    easy: 'Be cooperative, friendly, and accept reasonable solutions on the first attempt.',
    medium:
      'Be mildly frustrated. Ask clarifying questions and require some reassurance before accepting a solution.',
    hard: 'Be very frustrated or upset. Interrupt occasionally, push back on solutions, and only de-escalate if the agent handles the situation exceptionally well.',
  }[script.difficulty];

  return `You are a virtual customer in a call center training simulation. Stay completely in character at all times.

SCENARIO: ${scenarioName}
CUSTOMER PERSONA: ${script.customerPersona}
YOUR OBJECTIVE: ${script.customerObjective}
DIFFICULTY LEVEL: ${script.difficulty.toUpperCase()}

BEHAVIORAL GUIDELINES:
${difficultyGuide}

RULES:
- Never break character or reveal that you are an AI
- Respond naturally as this customer would — including frustration, confusion, or satisfaction
- Keep responses concise (1–4 sentences) — this is a phone call or chat conversation
- If the agent resolves your issue satisfactorily, wrap up the conversation naturally AND append [RESOLVED] on a new line as the very last part of that final message
- If the conversation ends without resolution, end naturally WITHOUT [RESOLVED]
- Do NOT ask "How can I help you?" — you are the customer, not the agent
${script.hints?.length ? `\nSITUATION CUES:\n${script.hints.map(h => `- ${h}`).join('\n')}` : ''}

Begin the conversation by describing your issue or reason for calling.`;
}

// ─── Chat Completion ──────────────────────────────────────────────────────────

/**
 * Generate text (non-streaming) from the Groq API.
 */
export async function generateResponse(messages: ChatMessage[]): Promise<string> {
  const completion = await (await getGroq()).chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages,
    temperature: 0.75,
    max_tokens: 400,
  });
  return completion.choices[0]?.message.content ?? '';
}

/**
 * Generate a streaming response. Returns an async iterable of token strings.
 */
export async function* streamResponse(
  messages: ChatMessage[]
): AsyncGenerator<string> {
  try {
    const stream = await (await getGroq()).chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages,
      temperature: 0.75,
      max_tokens: 400,
      stream: true,
    });

    let hasYielded = false;
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        hasYielded = true;
        yield delta;
      }
    }

    if (!hasYielded) {
      yield "I'm sorry, I'm having trouble responding right now. Could you please try again?";
    }
  } catch (error) {
    console.error('[AI] Groq API error:', error);
    console.error('[AI] Error details:', error instanceof Error ? error.message : String(error));
    console.error('[AI] Error stack:', error instanceof Error ? error.stack : 'N/A');
    yield "I apologize, but I'm experiencing technical difficulties. As a customer, I'm having trouble with my account. Could you help me?";
  }
}

// ─── Virtual Customer ─────────────────────────────────────────────────────────

/**
 * Build the initial system prompt for a new simulation session.
 */
export function buildSessionSystemPrompt(
  scenarioName: string,
  scenarioScript: unknown
): string {
  // Parse script JSON if it's a plain object or default empty
  let script: ScenarioScript;
  if (
    scenarioScript &&
    typeof scenarioScript === 'object' &&
    'customerPersona' in scenarioScript
  ) {
    script = scenarioScript as ScenarioScript;
  } else {
    // Default fallback script when no script configured
    script = {
      customerPersona: 'A customer who needs assistance.',
      customerObjective: 'Get help with their issue.',
      difficulty: 'medium',
    };
  }
  return buildCustomerSystemPrompt(scenarioName, script);
}

/**
 * Get the next AI customer message given the conversation history.
 * Stores history as DB messages (caller's responsibility to provide full history).
 */
export async function getNextCustomerMessage(
  systemPrompt: string,
  conversationHistory: Array<{ role: 'CUSTOMER' | 'AGENT'; content: string }>
): Promise<string> {
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory.map(m => ({
      role: m.role === 'CUSTOMER' ? ('assistant' as const) : ('user' as const),
      content: m.content,
    })),
  ];

  return generateResponse(messages);
}

/**
 * Streaming version — get the next customer message as a stream.
 */
export async function* streamNextCustomerMessage(
  systemPrompt: string,
  conversationHistory: Array<{ role: 'CUSTOMER' | 'AGENT'; content: string }>
): AsyncGenerator<string> {
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory.map(m => ({
      role: m.role === 'CUSTOMER' ? ('assistant' as const) : ('user' as const),
      content: m.content,
    })),
  ];
  yield* streamResponse(messages);
}

// ─── Auto-Scoring ─────────────────────────────────────────────────────────────

type ScoringCriterion = {
  id: string;
  name: string;
  description: string | null;
  weight: number;
};

/**
 * Score a completed simulation session transcript against defined criteria.
 * Returns one score per criterion.
 */
export async function scoreSession(
  transcript: Array<{ role: 'CUSTOMER' | 'AGENT'; content: string }>,
  criteria: ScoringCriterion[]
): Promise<ScoreResult[]> {
  if (criteria.length === 0) return [];

  const transcriptText = transcript
    .map(m => `${m.role}: ${m.content}`)
    .join('\n');

  const criteriaList = criteria
    .map((c, i) => `${i + 1}. ${c.name}${c.description ? ` — ${c.description}` : ''}`)
    .join('\n');

  const prompt = `You are evaluating a customer service training session. Score the AGENT's performance.

CONVERSATION TRANSCRIPT:
${transcriptText}

SCORE THE AGENT ON THESE CRITERIA (each 1–10):
${criteriaList}

Rules:
- Score ONLY the agent's messages — not the customer's behaviour
- 1–4 = Poor, 5–6 = Adequate, 7–8 = Good, 9–10 = Excellent
- Be objective and specific in justifications

Respond ONLY with a valid JSON array, no extra text:
[{"criteriaIndex": 1, "score": 7, "justification": "..."}]`;

  const completion = await (await getGroq()).chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
    max_tokens: 1000,
  });

  const raw = completion.choices[0]?.message.content ?? '[]';

  // Strip markdown code fences if present
  const cleaned = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim();

  try {
    const parsed: Array<{ criteriaIndex: number; score: number; justification: string }> =
      JSON.parse(cleaned);

    return parsed
      .filter(p => p.criteriaIndex >= 1 && p.criteriaIndex <= criteria.length)
      .map(p => ({
        criteriaId: criteria[p.criteriaIndex - 1].id,
        criteriaName: criteria[p.criteriaIndex - 1].name,
        score: Math.max(1, Math.min(10, Math.round(p.score))),
        justification: p.justification,
      }));
  } catch {
    console.error('[ai] Failed to parse scoring response:', cleaned);
    return [];
  }
}
