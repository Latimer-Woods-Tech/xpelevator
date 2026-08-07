import { NextResponse } from 'next/server';
import { getPublicPlanCatalog } from '@/lib/plans';
import { enforceRateLimit } from '@/lib/rate-limit';

// GET /api/plans — public, read-only seat-plan catalog for the operator-facing
// pricing / signup surface. No auth, no secrets: pricing is intentionally
// public (like /api/health). Deliberately NOT covered by the Phase-2 read-auth
// gate, which scopes the anonymous-401 requirement to tenant-data routes
// (/api/scenarios, /api/jobs, /api/criteria).
//
// Per-IP rate limited (#157) so the anonymous surface can't be hammered; the
// limiter fails OPEN, so a DB blip never takes the public pricing page dark.
export async function GET(request: Request) {
  const limited = await enforceRateLimit(request, 'plans');
  if (limited) return limited;

  return NextResponse.json(getPublicPlanCatalog(), {
    headers: { 'Cache-Control': 'public, max-age=300' },
  });
}
