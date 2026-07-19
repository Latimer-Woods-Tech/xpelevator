import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthError } from '@/lib/auth-api';
import { getRuntimeEnv } from '@/lib/runtime-env';

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

  // Resolve via the CF runtime binding (binding-first, process.env fallback) —
  // reading process.env directly reports a binding-only secret as ABSENT in the
  // deployed Worker (see #125), which is exactly how this diagnostic would lie.
  const groqKey = getRuntimeEnv('GROQ_API_KEY');
  const dbUrl = getRuntimeEnv('DATABASE_URL');

  const envCheck = {
    runtime: typeof process !== 'undefined' ? 'node' : 'edge',
    hasProcess: typeof process !== 'undefined',
    hasProcessEnv: typeof process?.env !== 'undefined',

    // Existence and length only — never the value or a preview
    groqKeyExists: !!groqKey,
    groqKeyLength: groqKey?.length || 0,

    // Existence only — never the value
    dbUrlExists: !!dbUrl,

    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(envCheck, {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}
