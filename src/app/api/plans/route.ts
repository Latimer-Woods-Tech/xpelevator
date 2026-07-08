import { NextResponse } from 'next/server';
import { getPublicPlanCatalog } from '@/lib/plans';

// GET /api/plans — public, read-only seat-plan catalog for the operator-facing
// pricing / signup surface. No auth, no DB, no secrets: pricing is intentionally
// public (like /api/health). Deliberately NOT covered by the Phase-2 read-auth
// gate, which scopes the anonymous-401 requirement to tenant-data routes
// (/api/scenarios, /api/jobs, /api/criteria).
export async function GET() {
  return NextResponse.json(getPublicPlanCatalog(), {
    headers: { 'Cache-Control': 'public, max-age=300' },
  });
}
