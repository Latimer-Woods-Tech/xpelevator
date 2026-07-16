import type { NextConfig } from "next";
import path from "path";

// ── Security headers (Phase 2 3/3) ──────────────────────────────────────────
// Applied to every response the OpenNext worker renders (HTML documents + API
// route handlers). Rationale for each directive:
//
//  • CSP — nonce-less on purpose (a next.config header list cannot mint a
//    per-request nonce). Next.js 15 App Router emits INLINE hydration/streaming
//    scripts, so a nonce-less enforcing policy must still permit 'unsafe-inline'
//    for scripts or the live site white-screens. 'unsafe-eval' is NOT required:
//    a production Next build ships no eval()/Function() on the client (that is a
//    dev-only Fast-Refresh/HMR need), and this app pulls in no eval-based client
//    library. Dropping it removes the most dangerous script-src bypass. Verified
//    two ways: (1) the built client bundle greps to ZERO eval()/Function() call
//    sites across every shipped chunk; (2) a real browser (Chromium) loads the
//    landing + /pricing + /auth/signin pages against a production `next start`
//    under this exact header and they render + hydrate clean — no page errors,
//    no CSP violations (the header is confirmed enforcing: a cross-origin
//    <script> IS blocked). This still delivers the other real wins —
//    `frame-ancestors 'none'` (clickjacking),
//    `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, and a
//    locked-down `connect-src` (the app makes NO client-side cross-origin fetches
//    today; all Groq/Telnyx calls are server-side). Tightening further to a
//    nonce-based CSP (drop 'unsafe-inline' too) via middleware is tracked
//    follow-up debt (needs the per-request nonce threaded through hydration).
//  • connect-src 'self' — SSE (/api/chat) is same-origin. When Phase E1 adds
//    browser-side ElevenLabs/Deepgram streaming, extend connect-src/media-src.
//  • media-src blob: — voice-mode audio playback uses blob URLs.
//  • Permissions-Policy — microphone=(self) MUST stay: browser voice mode uses
//    getUserMedia/Web Speech. Everything else is denied.
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "upgrade-insecure-requests",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(self), geolocation=(), payment=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Every route — HTML documents and /api/* handlers alike.
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
  // Required for OpenNext/Cloudflare Pages: generates .next/standalone/ which
  // OpenNext copies and bundles into the CF Worker.
  output: "standalone",
  // Suppress "multiple lockfiles detected" warning when running inside a
  // monorepo root (WSL workspace). Points Next.js at the correct project root.
  outputFileTracingRoot: path.join(__dirname),
  // Force-include packages that Next.js standalone trace misses.
  // @prisma/adapter-neon and @neondatabase/serverless are not auto-traced
  // because they're dynamic adapter dependencies; without this, the
  // OpenNext esbuild pass cannot find them and they're absent from the
  // CF Workers bundle, causing every DB call to fail at runtime.
  outputFileTracingIncludes: {
    '/**': [
      './node_modules/@prisma/adapter-neon/**',
      './node_modules/@neondatabase/serverless/**',
      './node_modules/@prisma/driver-adapter-utils/**',
      './node_modules/postgres-array/**',
    ],
  },
  // Required for Cloudflare Pages static image delivery
  images: {
    unoptimized: true,
  },
  // eslint-config-next@15 exports legacy ESLint v8 format, incompatible with
  // ESLint v9 flat config used in eslint.config.mjs. Skip lint during build;
  // run `npm run lint` separately for code quality checks.
  eslint: {
    ignoreDuringBuilds: true,
  },
  // ── WASM support (prepare for CF Workers deployment) ──────────────────────
  // When BL-045 (CF build) is resolved, the production build may switch to
  // @prisma/client/wasm for the CF Workers runtime. Required then.
  // Harmless to keep during local dev (asyncWebAssembly is inert if no .wasm imports).
  webpack: (config) => {
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    };
    return config;
  },
};

export default nextConfig;
