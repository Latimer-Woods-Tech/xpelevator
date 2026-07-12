import { NextResponse } from 'next/server';
import { getPublicPackCatalog } from '@/lib/scenario-packs';

// GET /api/scenario-packs — public, read-only catalog of the starter
// scenario-library packs (Phase 4: operators need sellable day-one inventory).
// Public by design, like /api/plans and /api/health: it carries no secrets and
// no tenant data. It is the hidden-mechanic-SAFE view — getPublicPackCatalog()
// strips every scenario `script` (persona / objective / hints), so this route
// can never leak the concealed mechanics trainees must not see (R-021). The
// full pack materialises into org-scoped scenarios only on an authenticated
// admin import (a later slice).
//
// Must be listed in middleware PUBLIC_ROUTES, or the /api/:path* matcher gates
// anonymous callers with a 401 before this handler ever runs.
export async function GET() {
  return NextResponse.json(getPublicPackCatalog(), {
    headers: { 'Cache-Control': 'public, max-age=300' },
  });
}
