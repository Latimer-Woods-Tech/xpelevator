import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthError } from '@/lib/auth-api';

// Diagnostic endpoint to check environment variables in production
// Access at: /api/debug/env — admin only
export async function GET(request: NextRequest) {
  try {
    await requireAuth(request, 'ADMIN');
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const envCheck = {
    runtime: typeof process !== 'undefined' ? 'node' : 'edge',
    hasProcess: typeof process !== 'undefined',
    hasProcessEnv: typeof process?.env !== 'undefined',

    // Check for GROQ_API_KEY (existence and length only — no value or preview)
    groqKeyExists: !!process?.env?.GROQ_API_KEY,
    groqKeyLength: process?.env?.GROQ_API_KEY?.length || 0,

    // Check for DATABASE_URL (existence only — no value or preview)
    dbUrlExists: !!process?.env?.DATABASE_URL,

    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(envCheck, {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}
