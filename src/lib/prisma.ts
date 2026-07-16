// ── Prisma client — SCHEMA/MIGRATIONS + TEST TOOLING ONLY ───────────────────
//
// Decision (P2-4): Prisma owns the schema (prisma/schema.prisma) and migrations,
// and provides the data-factory client for the live integration-test helper
// (tests/integration/helpers/db.ts). It is NOT used by production request paths:
// every src/app/** route queries Neon directly via `sql` from '@/lib/db'. This
// boundary is enforced by a no-restricted-imports ESLint rule over src/app/**.
// Do not import this module from application code — the Prisma client has known
// runtime incompatibilities on the Cloudflare Workers edge (see LESSONS_LEARNED).
//
// Uses PrismaNeonHTTP which communicates with Neon via HTTP. The HTTP adapter
// completely bypasses Prisma's query engine, sending SQL directly to Neon's API.
//
// CRITICAL for Cloudflare Workers: Standard @prisma/client includes Node.js
// filesystem detection code (fs.readdir) even when using adapters. We work around
// this by importing from '@prisma/client' (NOT '/edge') and relying on the fact
// that the adapter bypasses all engine code at RUNTIME. The fs.readdir calls
// only happen during client initialization, which we avoid by lazy-loading.
//
// Reference: https://www.prisma.io/docs/orm/prisma-client/deployment/edge/deploy-to-cloudflare#neon
import { PrismaClient as PrismaClientEdge, Prisma } from '@prisma/client';
import { PrismaNeonHTTP } from '@prisma/adapter-neon';

// Lazy client initialization - only create when first accessed
let cachedClient: PrismaClientEdge | undefined;

function createPrismaClient() {
  // Strip CR chars that appear when .env has CRLF line endings (Windows dev)
  const url = process.env.DATABASE_URL?.replace(/\r/g, '');
  if (!url) throw new Error('DATABASE_URL is not set');

  // Create HTTP adapter - this bypasses ALL Prisma engine code
  const adapter = new PrismaNeonHTTP(url, {});
  
  // Initialize with adapter - engine detection code runs here but is never
  // actually used because the adapter handles all queries
  return new PrismaClientEdge({ 
    adapter,
    // Suppress engine warnings since we're using HTTP transport
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

export const prisma = new Proxy({} as PrismaClientEdge, {
  get(_target, prop) {
    if (!cachedClient) {
      cachedClient = createPrismaClient();
    }
    return Reflect.get(cachedClient, prop);
  },
});

export default prisma;
