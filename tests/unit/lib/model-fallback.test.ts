/**
 * Unit tests for src/lib/model-fallback.ts — the pure model-substitution ladder.
 *
 * Proof-of-rejection (Standing Law 1): the classifier tests below FAIL if a
 * non-model error (401 auth / 429 rate-limit) is ever misclassified as
 * "model unavailable", which would let the ladder silently retry a different
 * model on an expired key and mask the credential alarm — the exact regression
 * this layer must never introduce. The drift guard fails if a live tier model
 * (imported from `@/lib/ai`) loses its fallback chain.
 */

import { describe, it, expect } from 'vitest';

import {
  MODEL_FALLBACKS,
  fallbackChain,
  isModelUnavailableError,
} from '@/lib/model-fallback';
import { CUSTOMER_MODEL_REALISM, CUSTOMER_MODEL_FAST } from '@/lib/ai';

describe('fallbackChain', () => {
  it('puts the requested model first, then its substitutes', () => {
    expect(fallbackChain('openai/gpt-oss-120b')).toEqual([
      'openai/gpt-oss-120b',
      'openai/gpt-oss-20b',
    ]);
  });

  it('returns a single-element chain for a model with no configured fallback', () => {
    expect(fallbackChain('some/unknown-model')).toEqual(['some/unknown-model']);
  });

  it('deduplicates so a model never retries itself', () => {
    // A hypothetical self-referential entry must not produce a duplicate.
    const chain = fallbackChain('openai/gpt-oss-20b');
    expect(new Set(chain).size).toBe(chain.length);
    expect(chain[0]).toBe('openai/gpt-oss-20b');
  });
});

describe('isModelUnavailableError', () => {
  it('matches a 400 model_decommissioned (the #248 outage signature)', () => {
    expect(
      isModelUnavailableError(
        400,
        '{"error":{"code":"model_decommissioned","message":"llama-3.3-70b-versatile has been decommissioned"}}',
      ),
    ).toBe(true);
  });

  it('matches a 400 model_not_found and a "does not exist" body', () => {
    expect(isModelUnavailableError(400, '{"code":"model_not_found"}')).toBe(true);
    expect(isModelUnavailableError(400, 'The model `foo` does not exist')).toBe(true);
  });

  it('matches a 404 (unknown model id)', () => {
    expect(isModelUnavailableError(404, 'Not Found')).toBe(true);
  });

  it('matches a 403 org-level model block (the gpt-oss-20b fast-tier outage)', () => {
    // Groq lists the id in /v1/models but 403s every completion until an org
    // admin enables it; degrade to the live substitute instead of outaging.
    expect(
      isModelUnavailableError(
        403,
        '{"error":{"message":"The model `openai/gpt-oss-20b` is blocked at the organization level. Please have the org admin enable this model in the org settings at https://console.groq.com/settings/limits"}}',
      ),
    ).toBe(true);
  });

  it('does NOT match auth / rate-limit / server errors or a credential-wide 403', () => {
    expect(isModelUnavailableError(401, 'invalid_api_key')).toBe(false);
    expect(isModelUnavailableError(429, 'rate_limit_exceeded')).toBe(false);
    expect(isModelUnavailableError(500, 'internal_server_error')).toBe(false);
    // A plain 400 that is NOT about model availability must not fall back.
    expect(isModelUnavailableError(400, 'invalid_request: max_tokens too large')).toBe(false);
    // A credential-wide 403 (no model reference) must surface unchanged, not be
    // retried across models — that would mask a real permission failure.
    expect(isModelUnavailableError(403, '{"error":{"message":"Forbidden: insufficient permissions"}}')).toBe(false);
  });
});

describe('ladder ↔ ai.ts tier drift guard', () => {
  it('every live tier model has a fallback chain', () => {
    for (const model of [CUSTOMER_MODEL_REALISM, CUSTOMER_MODEL_FAST]) {
      expect(MODEL_FALLBACKS[model]).toBeDefined();
      expect(MODEL_FALLBACKS[model].length).toBeGreaterThan(0);
    }
  });
});
