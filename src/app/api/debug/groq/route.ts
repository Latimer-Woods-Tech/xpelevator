import { NextRequest, NextResponse } from 'next/server';
import { getGroqClient } from '@/lib/groq-fetch';
import { CUSTOMER_MODEL_FAST, CUSTOMER_MODEL_REALISM } from '@/lib/ai';
import { requireAuth, AuthError } from '@/lib/auth-api';
import { getRuntimeEnv } from '@/lib/runtime-env';
import { enforceRateLimit, type RateLimitOptions } from '@/lib/rate-limit';
import { errorFields, log, requestIdFrom } from '@/lib/log';

// Test endpoint to diagnose Groq API issues
// GET /api/debug/groq — admin only
//
// Runs a models probe, NOT a completion (Plan W1.12, #5238): `GET /v1/models`
// proves the key authenticates, and the id check proves the models the app
// calls are still offered (a decommissioned model — the #248 outage — leaves
// the key valid but drops the id). Same probe as scripts/uptime-check.mjs.
const REQUIRED_GROQ_MODELS = [CUSTOMER_MODEL_REALISM, CUSTOMER_MODEL_FAST];

// Cap it hard even behind ADMIN auth (#157): a stolen admin session or a
// mis-wired monitor must not be able to loop it against Groq. A tight per-IP
// fixed-window budget — a real operator diagnosing an outage never needs more
// than a handful a minute. Reuses the shared DB-backed limiter
// (`api_rate_limits`, fails OPEN).
const DEBUG_GROQ_RATE_LIMIT: RateLimitOptions = { limit: 6, windowMs: 60_000 };

export async function GET(request: NextRequest) {
  const requestId = requestIdFrom(request.headers);
  try {
    await requireAuth(request, 'ADMIN');
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  // Throttle AFTER auth so an anonymous caller is rejected (401) without a DB
  // write, and the budget is spent only by authenticated ADMINs. Short-circuits
  // to a 429 (+`Retry-After`) before the Groq probe below.
  const limited = await enforceRateLimit(request, 'debug-groq', DEBUG_GROQ_RATE_LIMIT);
  if (limited) return limited;

  // Resolve via the CF runtime binding (the source of truth in the deployed
  // Worker) — process.env is empty for binding-only secrets there (#125), which
  // would make this scoring-outage diagnostic falsely report the key missing.
  const groqKey = getRuntimeEnv('GROQ_API_KEY');
  const result: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    apiKeyPresent: !!groqKey,
    apiKeyLength: groqKey?.length || 0,
    probe: 'models',
  };

  try {
    log('info', 'debug_groq.start', { requestId });
    const client = getGroqClient();

    log('info', 'debug_groq.client_ready', { requestId });
    const offered = await client.listModels();
    const missing = REQUIRED_GROQ_MODELS.filter((m) => !offered.includes(m));

    log('info', 'debug_groq.call_ok', { requestId, missing: missing.length });
    result.success = missing.length === 0;
    result.models = { required: REQUIRED_GROQ_MODELS, missing, offered: offered.length };

  } catch (error) {
    log('error', 'debug_groq.call_failed', { requestId, ...errorFields(error) });
    result.success = false;
    result.error = {
      message: error instanceof Error ? error.message : String(error),
      type: error?.constructor?.name || 'Unknown',
      // @ts-expect-error - Groq SDK might have specific error fields
      status: error?.status,
    };
  }
  
  return NextResponse.json(result, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
