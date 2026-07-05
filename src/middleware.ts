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
 *   /api/telnyx/webhook — external webhook (has own verification)
 *
 * Every other /api/* route (including all reads) requires authentication —
 * downstream handlers additionally enforce role and org scoping.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Routes that don't require authentication.
// Note: /api/jobs, /api/scenarios and /api/criteria are deliberately NOT here —
// their reads are authenticated (Phase 2). /api/scenarios in particular leaked
// each scenario's hidden hints to anonymous callers.
const PUBLIC_ROUTES = [
  '/',
  '/auth/signin',
  '/auth/signout',
  '/api/health',
  '/api/telnyx/webhook', // Has its own signature verification
  '/api/auth', // NextAuth handlers
];

export default function middleware(req: NextRequest) {
  // TESTING MODE: Bypass auth checks if DISABLE_AUTH is set — never in production.
  // TODO(phase-2/3): retire this crutch once the test-auth harness lands.
  if (process.env.DISABLE_AUTH === 'true' && process.env.NODE_ENV !== 'production') {
    return NextResponse.next();
  }

  const { pathname } = req.nextUrl;

  // Allow public routes
  if (PUBLIC_ROUTES.some((route) => pathname === route || pathname.startsWith(route + '/'))) {
    return NextResponse.next();
  }

  // Check for session cookie
  const sessionToken =
    req.cookies.get('authjs.session-token') ??
    req.cookies.get('__Secure-authjs.session-token');

  if (!sessionToken) {
    // For API routes, return 401 JSON
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // For pages, redirect to sign-in
    const signInUrl = new URL('/auth/signin', req.url);
    signInUrl.searchParams.set('callbackUrl', req.url);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Protect admin routes and all API routes except the public list
  matcher: [
    '/admin/:path*',
    '/api/:path*',
    '/simulate/:path*',
    '/sessions/:path*',
    '/analytics/:path*',
  ],
};
