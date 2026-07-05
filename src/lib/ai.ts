// Use fetch-based Groq client (Cloudflare Workers compatible)
import { getGroqClient } from './groq-fetch';
import type { ChatMessage } from './groq-fetch';
import type { ScenarioScript, ScoreResult } from '@/types';

// Re-export so callers that import from '@/lib/ai' still get these types
export type { ScenarioScript, ScoreResult, ChatMessage };

// ─── System Prompts ──────────────────────────────────────────────────────────

// Pre-generated name pool keeps the customer persona varied across calls
const CUSTOMER_NAMES = [
  'Marcus Webb', 'Sandra Okafor', 'David Chen', 'Patricia Nguyen',
  'Robert Castillo', 'Linda Kowalski', 'James Osei', 'Karen Yamamoto',
  'Thomas Mbeki', 'Angela Rivera', 'Charles Petrov', 'Margaret Johansson',
];

const EMOTIONAL_STATES: Record<string, string[]> = {
  easy: ['mildly inconvenienced', 'politely impatient', 'calm but pressed for time'],
  medium: ['noticeably frustrated', 'stressed', 'short-tempered but not rude'],
  hard: ['angry', 'extremely frustrated', 'borderline rude — demanding immediate action'],
};

function buildCustomerSystemPrompt(
  scenarioName: string,
  script: ScenarioScript
): string {
  // Pick a consistent name for this prompt (stable hash so same session = same name)
  const nameIndex = Math.abs(
    scenarioName.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  ) % CUSTOMER_NAMES.length;
  const customerName = CUSTOMER_NAMES[nameIndex];

  const emotionalState =
    (EMOTIONAL_STATES[script.difficulty] ?? EMOTIONAL_STATES.medium)[
      Math.floor(Math.random() * 3)
    ];

  const difficultyGuide = {
    easy: 'Be cooperative and accept reasonable solutions on the first or second attempt. Express relief and gratitude when resolved.',
    medium:
      'Be mildly frustrated. Push back once or twice before accepting a good solution. Make the agent work a little for it.',
    hard: 'Be very frustrated. Interrupt, question every step, push back on standard procedures, and only fully de-escalate if the agent handles the situation exceptionally — empathy AND competence required.',
  }[script.difficulty];

  return `You are roleplaying as a real customer on a phone call. Stay completely in character — never acknowledge being an AI.

YOUR IDENTITY:
- Name: ${customerName}
- Emotional state right now: ${emotionalState}
- Persona: ${script.customerPersona}

SITUATION:
- Scenario: ${scenarioName}
- Your goal: ${script.customerObjective}
- Difficulty: ${script.difficulty.toUpperCase()}

HOW TO BEHAVE (${script.difficulty}):
${difficultyGuide}

PHONE CALL RULES:
- You called THEM — speak first, explain your problem directly
- Keep each response to 1–3 sentences max (it's a phone call, not an essay)
- Use natural spoken language — contractions, interruptions, mild impatience as appropriate
- Do NOT offer help — you are the customer with the problem
- Do NOT repeat your full issue every turn — the agent heard you
- If fully resolved, end naturally and append exactly: [RESOLVED]
- Do NOT append [RESOLVED] unless genuinely satisfied
${script.hints?.length ? `\nCONTEXT DETAILS:\n${script.hints.map(h => `- ${h}`).join('\n')}` : ''}`;
}

// ─── Chat Completion ──────────────────────────────────────────────────────────

/**
 * Generate text (non-streaming) from the Groq API.
 */
export async function generateResponse(messages: ChatMessage[]): Promise<string> {
  const client = getGroqClient();
  const completion = await client.chatCompletion({
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
    const client = getGroqClient();
    let hasYielded = false;
    
    for await (const chunk of client.chatCompletionStream({
      model: 'llama-3.3-70b-versatile',
      messages,
      temperature: 0.75,
      max_tokens: 400,
    })) {
      hasYielded = true;
      yield chunk;
    }

    if (!hasYielded) {
      yield "I'm sorry, I'm having trouble responding right now. Could you please try again?";
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[AI] Groq API error:', msg);
    // Yield a clear, actionable error — surfaces in UI so the cause is obvious
    yield `[AI Error: ${msg}]`;
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
    .map((c, i) => `${i + 1}. ${c.name} [importance: ${c.weight}/10]${c.description ? ` — ${c.description}` : ''}`)
    .join('\n');

  const prompt = `You are an expert customer service coach evaluating a trainee's phone call performance.

TRANSCRIPT:
${transcriptText}

CRITERIA TO SCORE (1–10 each, weight shown for importance):
${criteriaList}

SCORING GUIDE:
- 9–10 = Excellent: textbook example, proactive, empathetic
- 7–8  = Good: handled well, minor gaps
- 5–6  = Adequate: met minimum bar, missed opportunities
- 3–4  = Poor: notable failures affecting customer experience
- 1–2  = Very poor: harmful or completely absent behaviour

RULES:
- Judge ONLY the agent's words and actions — not the customer's behaviour
- Be specific: cite actual quotes or moments from the transcript in justifications
- Keep each justification to 1–2 sentences max
- If the agent did not address a criterion at all, score accordingly (likely 1–4)
- Higher weight criteria deserve extra scrutiny

Respond ONLY with valid JSON, no markdown, no extra text:
[{"criteriaIndex": 1, "score": 7, "justification": "..."}]`;

  const client = getGroqClient();
  const completion = await client.chatCompletion({
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
