# Groq AI Reference — XPElevator

Groq provides ultra-fast inference for open-source LLMs (LLaMA 3, Mixtral, Gemma). It is the primary AI provider for virtual customer conversations.

**SDK**: `groq-sdk` (official Node.js SDK)
**Dashboard**: https://console.groq.com
**Docs**: https://console.groq.com/docs

---

## Installation

```bash
npm install groq-sdk
```

---

## Client Setup

Location: `src/lib/ai.ts`

```ts
import Groq from 'groq-sdk';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
```

---

## Available Models

| Model | Context | Speed | Best For |
|-------|---------|-------|---------|
| `llama-3.3-70b-versatile` | 128k | Fast | High-quality conversation |
| `llama-3.1-8b-instant` | 128k | Ultra-fast | Quick responses, cost-efficient |
| `llama3-70b-8192` | 8k | Fast | General use |
| `mixtral-8x7b-32768` | 32k | Fast | Instruction following |
| `gemma2-9b-it` | 8k | Fast | Lightweight conversations |
| `llama-3.3-70b-specdec` | 8k | Ultra-fast | Low latency priority |

**Recommendation for XPElevator**:
- **Chat simulation**: `llama-3.3-70b-versatile` — highest quality, important for customer personas
- **Auto-scoring**: `llama-3.1-8b-instant` — quick analysis of transcripts, doesn't need 70B for scoring

---

## Basic Chat Completion

```ts
const completion = await groq.chat.completions.create({
  model: 'llama-3.3-70b-versatile',
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ],
  temperature: 0.7,    // 0 = deterministic, 1 = creative
  max_tokens: 500,
});

const reply = completion.choices[0].message.content;
```

---

## Streaming Response

Required for real-time chat feel:

```ts
const stream = await groq.chat.completions.create({
  model: 'llama-3.3-70b-versatile',
  messages: [...],
  stream: true,
});

for await (const chunk of stream) {
  const delta = chunk.choices[0]?.delta?.content ?? '';
  process.stdout.write(delta);  // or pipe to SSE
}
```

---

## Virtual Customer System Prompt Pattern

The system prompt defines the AI's persona and constraints:

```ts
function buildCustomerSystemPrompt(scenario: {
  customerPersona: string;
  customerObjective: string;
  difficulty: 'easy' | 'medium' | 'hard';
  hints?: string[];
}): string {
  return `You are a virtual customer in a training simulation. Stay completely in character.

PERSONA: ${scenario.customerPersona}
YOUR OBJECTIVE: ${scenario.customerObjective}
DIFFICULTY: ${scenario.difficulty}

BEHAVIORAL GUIDELINES:
- Easy: Be cooperative, give information when asked, accept reasonable solutions
- Medium: Be mildly frustrated, require reassurance, ask clarifying questions
- Hard: Be very frustrated, interrupt, escalate, require exceptional service to resolve

RULES:
- Never break character or reveal you are an AI
- Respond naturally as this customer would, including frustration, confusion, or satisfaction
- Keep responses concise (1-3 sentences) — you are on a phone call or chat
- If the agent handles the situation excellently, de-escalate naturally
${scenario.hints?.length ? `\nCUES:\n${scenario.hints.map(h => `- ${h}`).join('\n')}` : ''}`;
}
```

---

## Auto-Scoring System Prompt

```ts
function buildScoringPrompt(
  transcript: Array<{ role: string; content: string }>,
  criteria: Array<{ name: string; description: string | null; weight: number }>
): string {
  const transcriptText = transcript
    .map(m => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n');

  const criteriaList = criteria
    .map((c, i) => `${i + 1}. ${c.name}${c.description ? ` — ${c.description}` : ''}`)
    .join('\n');

  return `You are a customer service training evaluator. Score the AGENT's performance.

CONVERSATION TRANSCRIPT:
${transcriptText}

SCORING CRITERIA (score each 1-10):
${criteriaList}

Respond ONLY with a valid JSON array:
[
  { "criteriaName": "...", "score": 8, "justification": "..." },
  ...
]

Score 1-4: Poor. Score 5-6: Adequate. Score 7-8: Good. Score 9-10: Excellent.
Base scores ONLY on the agent's messages. Be objective and specific.`;
}
```

---

## Parsing Scoring Response

```ts
async function scoreSession(
  transcript: Array<{ role: string; content: string }>,
  criteria: Criteria[]
): Promise<Array<{ criteriaName: string; score: number; justification: string }>> {
  const prompt = buildScoringPrompt(transcript, criteria);

  const completion = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',  // faster, cheaper for scoring
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,  // low temperature for consistent scoring
    response_format: { type: 'json_object' },  // force JSON output
  });

  const raw = completion.choices[0].message.content ?? '[]';
  return JSON.parse(raw);
}
```

---

## Message History Management

Groq (like all LLM APIs) uses a stateless request model. The full conversation history must be sent with each request:

```ts
type Message = { role: 'system' | 'user' | 'assistant'; content: string };

// Initial state (session start)
const history: Message[] = [
  { role: 'system', content: systemPrompt },
];

// User sends a message
history.push({ role: 'user', content: agentMessage });

// Get AI response
const response = await groq.chat.completions.create({
  model: 'llama-3.3-70b-versatile',
  messages: history,
});

const aiReply = response.choices[0].message.content!;
history.push({ role: 'assistant', content: aiReply });
```

**In this app**: Message history is stored in `chat_messages` (Postgres). Reconstruct it from the DB:

```ts
const dbMessages = await prisma.chatMessage.findMany({
  where: { sessionId },
  orderBy: { createdAt: 'asc' }
});

const history: Message[] = [
  { role: 'system', content: systemPrompt },
  ...dbMessages.map(m => ({
    role: m.role === 'CUSTOMER' ? 'assistant' : 'user',
    content: m.content,
  } as Message)),
];
```

---

## Rate Limits & Pricing (Free Tier)

| Model | Requests/min | Tokens/min | Tokens/day |
|-------|-------------|------------|-----------|
| llama-3.3-70b-versatile | 30 | 6,000 | 1,000 |
| llama-3.1-8b-instant | 30 | 20,000 | 500,000 |

Training app with bursts of chat messages — 8B model is sufficient for the MVP, switch to 70B for quality when on a paid plan.

---

## Error Handling

```ts
import Groq from 'groq-sdk';

try {
  const completion = await groq.chat.completions.create({ ... });
} catch (error) {
  if (error instanceof Groq.APIError) {
    console.error('Groq API error:', error.status, error.message);
    // 429 = rate limit exceeded
    // 503 = model loading (retry after 2s)
  }
  throw error;
}
```

---

## xAI Grok (Alternative Provider)

API is OpenAI-compatible. Use the `openai` SDK pointing at xAI's base URL. Store key in `GROK_API_KEY`.

```ts
import OpenAI from 'openai';

const grok = new OpenAI({
  apiKey: process.env.GROK_API_KEY,
  baseURL: 'https://api.x.ai/v1',
});

const completion = await grok.chat.completions.create({
  model: 'grok-3-mini',   // or 'grok-3'
  messages: [...],
});
```

**When to use Grok vs Groq**: Groq for speed (training/volume), Grok for highest quality or when Groq hits rate limits.
