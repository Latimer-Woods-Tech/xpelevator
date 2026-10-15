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

/**
 * Bounded recursive search for the FIRST usage-shaped block anywhere inside a
 * parsed streaming chunk. The canonical locations are tried first by
 * {@link pickStreamTokenUsage}; this is the last-resort net that tolerates a
 * location Groq has not used before, so a future shift of the token block
 * cannot silently null per-turn spend again (the R-132 / #155 failure mode).
 *
 * Depth is capped (Groq chunks are shallow) and the search is read-only. A
 * usage block is identified structurally by {@link isGroqTokenUsage}, so a
 * `prompt_tokens`-only partial or a `*_tokens_details` sub-object is not
 * mistaken for the real block.
 */
function deepFindTokenUsage(value: unknown, depth = 0): GroqTokenUsage | null {
  if (depth > 6 || typeof value !== 'object' || value === null) return null;
  if (isGroqTokenUsage(value)) return value;
  for (const v of Object.values(value as Record<string, unknown>)) {
    if (v && typeof v === 'object') {
      const found = deepFindTokenUsage(v, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Pull the token-usage block from a streaming chunk, tolerating every shape Groq
 * uses for it (R-132, #155).
 *
 * Groq emits the terminal usage block at the OpenAI-compatible top-level `usage`
 * (what `stream_options.include_usage` documents) OR nested under its vendor
 * `x_groq.usage` envelope — and which one carries it varies by model and has
 * shifted over time. Reading only `parsed.usage` meant a shift to the `x_groq`
 * envelope silently nulled per-turn spend with no code change and no unit-test
 * signal — exactly the regression the live scoring canary caught on 2026-10-05
 * (alert #278). PR #295 added `x_groq.usage`; the canary stayed red on the live
 * `openai/gpt-oss-*` stream, so the block is reaching NEITHER named location.
 * We therefore try the two canonical locations first (preserving their
 * precedence) and fall back to a bounded recursive scan for a usage-shaped
 * block anywhere in the chunk — robust to whatever nesting the live models use.
 *
 * @returns the usage block, or `null` when no location carries a valid one.
 */
export function pickStreamTokenUsage(parsed: unknown): GroqTokenUsage | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const o = parsed as Record<string, unknown>;
  if (isGroqTokenUsage(o.usage)) return o.usage;
  const xGroq = o.x_groq;
  if (typeof xGroq === 'object' && xGroq !== null) {
    const nested = (xGroq as Record<string, unknown>).usage;
    if (isGroqTokenUsage(nested)) return nested;
  }
  // Last resort: a location neither name covers (the live #278/#296 shape).
  return deepFindTokenUsage(o);
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
   * List the model ids Groq currently offers (`GET /v1/models`). Not billable:
   * no completion is made. Used by the `/api/debug/groq` diagnostic to check
   * the credential AND that the model ids the app calls are still offered (a
   * decommissioned model leaves the key valid — the #248 outage). Throws a
   * {@link GroqApiError} on a non-OK response.
   */
  async listModels(): Promise<string[]> {
    const response = await fetch(`${this.baseURL}/models`, {
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
    });

    if (!response.ok) {
      throw new GroqApiError(response.status, await response.text());
    }

    const parsed = (await response.json()) as { data?: Array<{ id?: unknown }> };
    return Array.isArray(parsed?.data)
      ? parsed.data.map((m) => m?.id).filter((id): id is string => typeof id === 'string')
      : [];
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

  /**
   * Max times to (re)open a streaming completion that CONNECTS (HTTP 200) but
   * yields ZERO content before `[DONE]`. A 200-with-empty-stream is NOT a 4xx
   * the model-fallback ladder classifies ({@link isModelUnavailableError}) — it
   * is a transient Groq generation hiccup. On 2026-10-15 the realism model
   * `openai/gpt-oss-120b` returned exactly this for ~18 min, taking every live
   * customer turn down to the canned `CUSTOMER_TURN_FALLBACK` with no recourse
   * (the ladder's only 120b substitute, `gpt-oss-20b`, was org-blocked), and
   * opening alert #304 — while the same model answered normally minutes later.
   * Reopening the SAME model once absorbs that blip; capped at 2 so a
   * persistently-empty model cannot loop (it falls through to the caller's
   * in-character fallback turn, behaviour unchanged once retries are exhausted).
   */
  private static readonly MAX_STREAM_ATTEMPTS = 2;

  async* chatCompletionStream(
    request: ChatCompletionRequest,
    onUsage?: (usage: GroqTokenUsage) => void,
  ): AsyncGenerator<string> {
    // Forward the terminal token-usage block to the sink at most once across all
    // attempts — a retried empty attempt must never double-count R-132/#155 spend.
    let usageForwarded = false;
    const forwardUsage = (usage: GroqTokenUsage): void => {
      if (onUsage && !usageForwarded) {
        usageForwarded = true;
        onUsage(usage);
      }
    };

    for (let attempt = 1; attempt <= GroqFetchClient.MAX_STREAM_ATTEMPTS; attempt++) {
      // Resolve the connection through the model-fallback ladder FIRST — the only
      // point a substitute model is still safe (nothing has been yielded yet). A
      // model-unavailable error here walks the ladder; any other non-OK class
      // (auth/rate-limit/transport) throws unchanged, before the read loop.
      const response = await this.withModelFallback(request.model, (model) =>
        this.openStream(request, model),
      );

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let yieldedContent = false;

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
                  yieldedContent = true;
                  yield content;
                }
                // The terminal usage chunk has empty `choices` + a token block
                // carried at top-level `usage` OR under `x_groq.usage`; surface
                // whichever is present via the sink without disturbing the
                // content stream (R-132, #155 — see pickStreamTokenUsage).
                const usage = pickStreamTokenUsage(parsed);
                if (usage) forwardUsage(usage);
              } catch {
                // Skip unparseable lines
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      // Any content streamed → done (a partial stream is NOT retried: content
      // was already yielded and reopening would duplicate it). A stream that
      // connected but yielded nothing is the transient #304 empty-stream:
      // reopen the SAME model once more, else fall through and return empty.
      if (yieldedContent) return;
      if (attempt < GroqFetchClient.MAX_STREAM_ATTEMPTS) {
        log('warn', 'ai.stream_empty_retry', { model: request.model, attempt });
      }
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
