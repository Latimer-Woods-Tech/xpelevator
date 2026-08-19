/**
 * Minimal Groq API client using fetch (Cloudflare Workers compatible)
 */

import { getCloudflareContext } from '@opennextjs/cloudflare';
import { fallbackChain, isModelUnavailableError } from './model-fallback';
import { log } from './log';

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

/**
 * A non-OK Groq HTTP response, carrying the parsed `status` + raw `body` so
 * callers (and the model-fallback ladder) can classify it without re-parsing a
 * message string. The `message` keeps the historical `Groq API error: <status>
 * - <body>` shape so existing log/grep expectations are unchanged; `status` is
 * additionally surfaced as a field (the `/api/debug/groq` diagnostic already
 * reads `error.status`).
 */
export class GroqApiError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`Groq API error: ${status} - ${body}`);
    this.name = 'GroqApiError';
    this.status = status;
    this.body = body;
  }

  /** True when a DIFFERENT model might succeed (decommissioned / unknown id). */
  get isModelUnavailable(): boolean {
    return isModelUnavailableError(this.status, this.body);
  }
}

export class GroqFetchClient {
  private apiKey: string;
  private baseURL = 'https://api.groq.com/openai/v1';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Walk the model-fallback chain for `request.model`, invoking `attempt` for
   * each candidate. A {@link GroqApiError} in the "model unavailable" class
   * (decommissioned / unknown id) advances to the next model in the chain (a
   * `warn`-level `ai.model_fallback` line records the degradation for ops); any
   * other error — auth, rate-limit, transport — throws immediately so it is
   * never masked. When the chain is exhausted the last error propagates. Shared
   * by both the buffered and streaming paths; the fallback for streaming is safe
   * because a model-unavailable error is raised at connect time, before any
   * token has been yielded.
   */
  private async withModelFallback<T>(
    model: string,
    attempt: (model: string) => Promise<T>,
  ): Promise<T> {
    const chain = fallbackChain(model);
    let lastError: unknown;
    for (let i = 0; i < chain.length; i++) {
      const candidate = chain[i];
      try {
        return await attempt(candidate);
      } catch (error) {
        lastError = error;
        const canFallback =
          error instanceof GroqApiError &&
          error.isModelUnavailable &&
          i < chain.length - 1;
        if (!canFallback) throw error;
        log('warn', 'ai.model_fallback', {
          from: candidate,
          to: chain[i + 1],
          status: (error as GroqApiError).status,
        });
      }
    }
    throw lastError;
  }

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    return this.withModelFallback(request.model, async (model) => {
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...request, model }),
      });

      if (!response.ok) {
        throw new GroqApiError(response.status, await response.text());
      }

      return response.json() as Promise<ChatCompletionResponse>;
    });
  }

  /**
   * Open the streaming connection for one model, throwing a {@link GroqApiError}
   * on a non-OK response (before any byte is read, so the caller may safely try
   * a fallback model). Returns the live `Response` for the reader loop.
   */
  private async openStream(request: ChatCompletionRequest, model: string): Promise<Response> {
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
        model,
        stream: true,
        stream_options: { include_usage: true },
      }),
    });

    if (!response.ok) {
      throw new GroqApiError(response.status, await response.text());
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    return response;
  }

  async* chatCompletionStream(
    request: ChatCompletionRequest,
    onUsage?: (usage: GroqTokenUsage) => void,
  ): AsyncGenerator<string> {
    // Resolve the connection through the model-fallback ladder FIRST — the only
    // point a substitute model is still safe (nothing has been yielded yet).
    const response = await this.withModelFallback(request.model, (model) =>
      this.openStream(request, model),
    );

    const reader = response.body!.getReader();
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
