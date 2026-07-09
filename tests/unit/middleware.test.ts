import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import middleware from '@/middleware';

// The middleware `matcher` covers `/api/:path*`, so EVERY /api route passes
// through this gate. A route handler declaring itself "public" is not enough —
// if its path is missing from PUBLIC_ROUTES the middleware returns 401 before
// the handler ever runs. These tests exercise the gate itself (the handler-only
// tests in api/plans.test.ts bypass it) so a public/protected mismatch is caught.

function anonRequest(path: string): NextRequest {
  // No session cookie set → simulates an anonymous caller.
  return new NextRequest(new URL(`http://localhost${path}`));
}

/** NextResponse.next() sets this header; a 401 block does not. */
function passedThrough(res: Response): boolean {
  return res.status !== 401 && res.headers.get('x-middleware-next') === '1';
}

describe('middleware auth gate', () => {
  it('lets anonymous callers reach the intentionally-public /api/plans', () => {
    // Regression guard for the operator pricing/signup surface: /api/plans is
    // public by design (like /api/health) and its data carries no secrets.
    const res = middleware(anonRequest('/api/plans'));
    expect(passedThrough(res)).toBe(true);
  });

  it('lets anonymous callers reach /api/health', () => {
    const res = middleware(anonRequest('/api/health'));
    expect(passedThrough(res)).toBe(true);
  });

  it('blocks anonymous reads of tenant-data routes with 401', () => {
    // Phase-2 guarantee: these leak scenario hints / cross-tenant data and MUST
    // stay gated. Proves the fix for /api/plans did not widen the public surface.
    for (const path of ['/api/scenarios', '/api/jobs', '/api/criteria']) {
      const res = middleware(anonRequest(path));
      expect(res.status, `${path} should be gated`).toBe(401);
    }
  });
});
