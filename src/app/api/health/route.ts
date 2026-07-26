import { NextResponse } from 'next/server';
import { buildInfo } from '@/build-info';

// GET /api/health — returns which required env vars are present (without
// values) plus the build identity (commit SHA + build timestamp) stamped by
// deploy.yml, so "which build is production serving?" is answerable (G72).
export async function GET() {
  const vars = ['DATABASE_URL', 'AUTH_SECRET', 'GROQ_API_KEY'];
  const status: Record<string, boolean> = {};
  for (const v of vars) {
    status[v] = !!(process.env[v] && process.env[v]!.trim().length > 0);
  }
  const allOk = Object.values(status).every(Boolean);
  return NextResponse.json(
    { ok: allOk, commit: buildInfo.commit, builtAt: buildInfo.builtAt, env: status },
    { status: allOk ? 200 : 503 },
  );
}
