import { NextResponse } from 'next/server';

// GET /api/health — returns which required env vars are present (without values)
export async function GET() {
  const vars = ['DATABASE_URL', 'AUTH_SECRET', 'GROQ_API_KEY'];
  const status: Record<string, boolean> = {};
  for (const v of vars) {
    status[v] = !!(process.env[v] && process.env[v]!.trim().length > 0);
  }
  const allOk = Object.values(status).every(Boolean);
  return NextResponse.json({ ok: allOk, env: status }, { status: allOk ? 200 : 503 });
}
