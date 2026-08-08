import { describe, it, expect, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import middleware from '@/middleware';
import { REQUEST_ID_HEADER } from '@/lib/log';

// The middleware `matcher` covers `/api/:path*`, so EVERY /api route passes
// through this gate. A route handler declaring itself "public" is not enough —
// if its path is missing from PUBLIC_ROUTES the middleware returns 401 before
// the handler ever runs. These tests exercise the gate itself (the handler-only
// tests in api/plans.test.ts bypass it) so a public/protected mismatch is caught.

function anonRequest(path: string, headers?: Record<string, string>): NextRequest {
  // No session cookie set → simulates an anonymous caller.
  return new NextRequest(new URL(`http://localhost${path}`), { headers });
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

  it('lets anonymous callers reach the public /api/scenario-packs catalog', () => {
    const res = middleware(anonRequest('/api/scenario-packs'));
    expect(passedThrough(res)).toBe(true);
  });

  it('gates the admin import subpath — a public route does NOT expose subpaths', () => {
    // Regression guard: /api/scenario-packs is public (exact), but the write
    // action /api/scenario-packs/import must stay gated at the middleware (the
    // handler also enforces ADMIN). A prefix-match public rule would leak it.
    const res = middleware(anonRequest('/api/scenario-packs/import'));
    expect(res.status).toBe(401);
  });

  it('lets anonymous callers reach the public client-facing brand read /api/branding/[slug]', () => {
    // R-050: the brand-safe, slug-keyed read must be reachable pre-sign-in so an
    // operator's brand renders on the login shell. Public by prefix (dynamic
    // [slug] segment); the handler returns only brand-safe fields.
    for (const slug of ['acme', 'operator-1', 'a-b-c']) {
      const res = middleware(anonRequest(`/api/branding/${slug}`));
      expect(passedThrough(res), `/api/branding/${slug} should be public`).toBe(true);
    }
  });

  it('keeps the admin branding write path /api/orgs/[id]/branding gated', () => {
    // The public read is /api/branding/[slug]; the admin write stays under
    // /api/orgs/[id]/branding and MUST remain gated (a 401 at the middleware).
    // Guards that opening the read prefix did not widen the write surface.
    const res = middleware(anonRequest('/api/orgs/org-1/branding'));
    expect(res.status).toBe(401);
  });

  it('gates the self-context route /api/me (R-051) — never public', () => {
    // /api/me returns the caller's own identity + org context and MUST require
    // auth. A near-miss to the public /api/branding prefix, so this pins that it
    // is not accidentally opened.
    const res = middleware(anonRequest('/api/me'));
    expect(res.status).toBe(401);
  });
});

// ── Proof-of-removal: the DISABLE_AUTH backdoor (Standing Law 1, R-080) ────────
//
// The auth-bypass footgun (`DISABLE_AUTH` → synthetic ADMIN, once at
// middleware.ts:56 / auth-api.ts:58) was retired with the credential-bound
// `tests/integration` tier. `requireAuth` already carries its own proof-of-
// removal (`tests/unit/lib/auth-api.test.ts`). This is the matching guard at
// the OTHER cited layer — the middleware gate: no env flag may open it. The
// module is re-imported with `DISABLE_AUTH=true` set so a bypass reintroduced
// at EITHER module-load OR request time is caught. `middleware.ts` reads no env
// at all today, so an anonymous caller to a protected route must still 401.
describe('middleware — DISABLE_AUTH backdoor stays retired (R-080)', () => {
  afterEach(() => {
    delete process.env.DISABLE_AUTH;
    vi.resetModules();
  });

  it('ignores DISABLE_AUTH=true and still 401s anonymous callers on protected routes', async () => {
    process.env.DISABLE_AUTH = 'true';
    vi.resetModules();
    // Fresh import with the env flag set — catches a load-time bypass too.
    const freshMiddleware = (await import('@/middleware')).default;
    for (const path of ['/api/scenarios', '/api/jobs', '/api/criteria', '/api/me', '/api/orgs']) {
      const res = freshMiddleware(anonRequest(path));
      expect(res.status, `${path} must stay gated even with DISABLE_AUTH=true`).toBe(401);
    }
  });

  it('ignores DISABLE_AUTH=true and still redirects anonymous page callers to sign-in', async () => {
    process.env.DISABLE_AUTH = 'true';
    vi.resetModules();
    const freshMiddleware = (await import('@/middleware')).default;
    const res = freshMiddleware(anonRequest('/admin/scenarios'));
    // A protected page: 3xx redirect to /auth/signin, never a synthetic pass-through.
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get('location')).toContain('/auth/signin');
  });
});

// ── Request-ID correlation propagation (R-111) ─────────────────────────────────
//
// The middleware mints/propagates an `x-request-id` on EVERY response path so a
// single request is traceable end-to-end (client header ↔ structured logs). This
// guards all three exits: public pass-through, the /api 401, and the page
// redirect — plus the caller-supplied-id honour path.
describe('middleware — x-request-id correlation (R-111)', () => {
  it('stamps an x-request-id on a public pass-through response', () => {
    const res = middleware(anonRequest('/api/health'));
    expect(passedThrough(res)).toBe(true);
    expect(res.headers.get(REQUEST_ID_HEADER)).toMatch(/[0-9a-f-]{36}/i);
  });

  it('stamps an x-request-id on the anonymous /api 401', () => {
    const res = middleware(anonRequest('/api/scenarios'));
    expect(res.status).toBe(401);
    expect(res.headers.get(REQUEST_ID_HEADER)).toMatch(/[0-9a-f-]{36}/i);
  });

  it('stamps an x-request-id on the page sign-in redirect', () => {
    const res = middleware(anonRequest('/admin/scenarios'));
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get(REQUEST_ID_HEADER)).toMatch(/[0-9a-f-]{36}/i);
  });

  it('honours a caller-supplied x-request-id (upstream trace continuity)', () => {
    const supplied = 'upstream-trace-abc123';
    for (const path of ['/api/health', '/api/scenarios']) {
      const res = middleware(anonRequest(path, { [REQUEST_ID_HEADER]: supplied }));
      expect(res.headers.get(REQUEST_ID_HEADER), path).toBe(supplied);
    }
  });

  it('mints a DISTINCT id per request when none is supplied', () => {
    const a = middleware(anonRequest('/api/health')).headers.get(REQUEST_ID_HEADER);
    const b = middleware(anonRequest('/api/health')).headers.get(REQUEST_ID_HEADER);
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
  });
});
