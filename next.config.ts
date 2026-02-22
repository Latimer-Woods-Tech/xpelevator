import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Suppress "multiple lockfiles detected" warning when running inside a
  // monorepo root (WSL workspace). Points Next.js at the correct project root.
  outputFileTracingRoot: path.join(__dirname),
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
