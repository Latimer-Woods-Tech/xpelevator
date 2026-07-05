import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
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
