import { NextRequest, NextResponse } from 'next/server';
import { getGroqClient } from '@/lib/groq-fetch';
import { requireAuth, AuthError } from '@/lib/auth-api';
import { getRuntimeEnv } from '@/lib/runtime-env';
import { enforceRateLimit, type RateLimitOptions } from '@/lib/rate-limit';

// Test endpoint to diagnose Groq API issues
// GET /api/debug/groq — admin only

// Each GET fires a live, BILLABLE Groq completion, so cap it hard even behind
// ADMIN auth (#157): a stolen admin session or a mis-wired monitor must not be
// able to burn LLM spend in a loop. A tight per-IP fixed-window budget — a real
// operator diagnosing an outage never needs more than a handful a minute.
// Reuses the shared DB-backed limiter (`api_rate_limits`, fails OPEN).
const DEBUG_GROQ_RATE_LIMIT: RateLimitOptions = { limit: 6, windowMs: 60_000 };

export async function GET(request: NextRequest) {
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
  // to a 429 (+`Retry-After`) before the billable Groq call below.
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
  };
  
  try {
    console.log('[Debug Groq] Starting Groq API test call...');
    const client = getGroqClient();
    
    console.log('[Debug Groq] Groq client initialized, making test API call...');
    const completion = await client.chatCompletion({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: 'Say "test successful" and nothing else.' }],
      temperature: 0.5,
      max_tokens: 20,
    });
    
    console.log('[Debug Groq] API call completed successfully');
    result.success = true;
    result.response = completion.choices[0]?.message?.content || '(empty response)';
    result.model = completion.model;
    
  } catch (error) {
    console.error('[Debug Groq] API call failed:', error);
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
