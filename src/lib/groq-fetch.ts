/**
 * Minimal Groq API client using fetch (Cloudflare Workers compatible)
 */

import { getCloudflareContext } from '@opennextjs/cloudflare';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

/**
 * Groq token-usage block (OpenAI-compatible field names). Returned on every
 * non-streaming completion, and on the terminal chunk of a stream when
 * `stream_options.include_usage` is set. Persisted per reply turn (R-132, #155)
 * so per-turn LLM spend becomes a durable, queryable record.
 */
export interface GroqTokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/** Runtime guard: a value is a usable token-usage block (three finite numbers). */
export function isGroqTokenUsage(v: unknown): v is GroqTokenUsage {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.prompt_tokens === 'number' &&
    Number.isFinite(o.prompt_tokens) &&
    typeof o.completion_tokens === 'number' &&
    Number.isFinite(o.completion_tokens) &&
    typeof o.total_tokens === 'number' &&
    Number.isFinite(o.total_tokens)
  );
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: GroqTokenUsage;
}

export class GroqFetchClient {
  private apiKey: string;
  private baseURL = 'https://api.groq.com/openai/v1';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Groq API error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  async* chatCompletionStream(
    request: ChatCompletionRequest,
    onUsage?: (usage: GroqTokenUsage) => void,
  ): AsyncGenerator<string> {
    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      // `stream_options.include_usage` asks Groq to emit a terminal chunk (empty
      // choices) carrying the token `usage` block, so per-turn spend can be
      // metered without a second billable call (R-132, #155).
      body: JSON.stringify({
        ...request,
        stream: true,
        stream_options: { include_usage: true },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Groq API error: ${response.status} - ${error}`);
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.substring(6).trim();
            if (data === '[DONE]') continue;
            
            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                yield content;
              }
              // The terminal usage chunk has empty `choices` + a `usage` block;
              // surface it via the sink without disturbing the content stream.
              if (onUsage && isGroqTokenUsage(parsed.usage)) {
                onUsage(parsed.usage);
              }
            } catch {
              // Skip unparseable lines
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

/**
 * Get a Groq client with the API key resolved at REQUEST time.
 *
 * Why not process.env?
 * Next.js / webpack's DefinePlugin inlines process.env.* at BUILD time.
 * If the CI build sets GROQ_API_KEY to a dummy value the string gets baked
 * into the worker bundle and Groq returns 401 forever.
 *
 * getCloudflareContext().env is a runtime binding resolved by the CF Worker
 * runtime — never touched by webpack — so it always carries the real secret.
 * process.env is kept as a fallback so local `next dev` still works.
 */
export function getGroqClient(): GroqFetchClient {
  let apiKey: string | undefined;

  // 1. Cloudflare runtime bindings (production) — NOT inlined at build time
  try {
    const { env } = getCloudflareContext();
    apiKey = (env as Record<string, string | undefined>).GROQ_API_KEY;
  } catch {
    // Not in a CF Worker context (local dev) — fall through
  }

  // 2. process.env fallback for local development
  if (!apiKey) {
    apiKey = process.env.GROQ_API_KEY?.replace(/\r/g, '');
  }

  // Reject obviously-wrong build-time placeholder injected by CI
  if (!apiKey || apiKey.startsWith('dummy-')) {
    throw new Error('GROQ_API_KEY is not available in this runtime environment');
  }

  // Do NOT cache as a module-level singleton: always resolve the key fresh so
  // CF secret rotation takes effect without redeployment.
  return new GroqFetchClient(apiKey);
}
