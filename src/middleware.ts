/**
 * Next.js middleware — protects admin and API routes from unauthorized access.
 *
 * Uses a lightweight cookie check for the initial gate, then downstream
 * handlers verify the actual session and role.
 *
 * Protected routes:
 *   /admin/*  — requires authentication (role checked by page/API)
 *   /api/*    — most routes require authentication (handled in route handlers)
 *
 * Public routes:
 *   /          — home page
 *   /auth/*    — sign in/out pages
 *   /api/health — health check
 *   /api/plans — public seat-plan catalog (pricing/signup surface)
 *   /api/scenario-packs — public starter scenario-library catalog (operator inventory)
 *   /api/telnyx/webhook — external webhook (has own verification)
 *
 * Every other /api/* route (including all reads) requires authentication —
 * downstream handlers additionally enforce role and org scoping.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { REQUEST_ID_HEADER, log, requestIdFrom } from '@/lib/log';

// Routes that don't require authentication.
// Note: /api/jobs, /api/scenarios and /api/criteria are deliberately NOT here —
// their reads are authenticated (Phase 2). /api/scenarios in particular leaked
// each scenario's hidden hints to anonymous callers.
//
// Matched by EXACT path — a public route does NOT make its subpaths public. In
// particular `/api/scenario-packs` (the public catalog) is public, but
// `/api/scenario-packs/import` (the admin import) is NOT: it stays gated here
// AND double-checks ADMIN in its handler.
const PUBLIC_EXACT_ROUTES = [
  '/',
  '/auth/signin',
  '/auth/signout',
  '/api/health',
  '/api/plans', // Public seat-plan catalog for the operator pricing/signup surface — no secrets, no tenant data
  '/api/scenario-packs', // Public starter scenario-library catalog (operator inventory) — hidden-mechanic-safe, no scripts, no tenant data
  '/api/telnyx/webhook', // Has its own signature verification
];

// Routes whose SUBPATHS are also public (prefix match).
//   - /api/auth      — NextAuth serves many paths under /api/auth/*
//   - /api/branding  — the client-facing brand read `/api/branding/[slug]` is
//     public by design (R-050): it returns ONLY brand-safe fields (name / logo /
//     colors, no tenant data) so an operator's brand can render on the login
//     shell before sign-in. It is read-only — there is no write verb under this
//     prefix (the admin write path is the gated `/api/orgs/[id]/branding`).
const PUBLIC_PREFIX_ROUTES = ['/api/auth', '/api/branding'];

export default function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Resolve a per-request correlation id (R-111): honour a caller-supplied
  // x-request-id, else mint one. Forwarded to downstream handlers as a request
  // header AND stamped on every response so a request is traceable end-to-end.
  const requestId = requestIdFrom(req.headers);
  const forwardHeaders = new Headers(req.headers);
  forwardHeaders.set(REQUEST_ID_HEADER, requestId);

  // Pass-through that preserves the forwarded id on the request and echoes it
  // on the response.
  const passThrough = (): NextResponse => {
    const res = NextResponse.next({ request: { headers: forwardHeaders } });
    res.headers.set(REQUEST_ID_HEADER, requestId);
    return res;
  };

  // Allow public routes — exact match, plus the explicit prefix allow-list.
  if (
    PUBLIC_EXACT_ROUTES.includes(pathname) ||
    PUBLIC_PREFIX_ROUTES.some((route) => pathname === route || pathname.startsWith(route + '/'))
  ) {
    return passThrough();
  }

  // Check for session cookie
  const sessionToken =
    req.cookies.get('authjs.session-token') ??
    req.cookies.get('__Secure-authjs.session-token');

  if (!sessionToken) {
    // For API routes, return 401 JSON
    if (pathname.startsWith('/api/')) {
      // Structured security-observability signal (R-112) — the id ties this
      // denial to the client-visible x-request-id on the same response.
      log('warn', 'auth.denied', { requestId, path: pathname, kind: 'api' });
      const res = NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
      res.headers.set(REQUEST_ID_HEADER, requestId);
      return res;
    }

    // For pages, redirect to sign-in
    log('warn', 'auth.denied', { requestId, path: pathname, kind: 'page' });
    const signInUrl = new URL('/auth/signin', req.url);
    signInUrl.searchParams.set('callbackUrl', req.url);
    const res = NextResponse.redirect(signInUrl);
    res.headers.set(REQUEST_ID_HEADER, requestId);
    return res;
  }

  return passThrough();
}

export const config = {
  // Protect admin routes and all API routes except the public list
  matcher: [
    '/admin/:path*',
    '/operator/:path*',
    '/api/:path*',
    '/simulate/:path*',
    '/sessions/:path*',
    '/analytics/:path*',
  ],
};
