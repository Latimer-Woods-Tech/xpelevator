// ── Prisma client with Neon HTTP adapter ────────────────────────────────────
//
// IMPORTANT: Must import from '@prisma/client/edge', NOT '@prisma/client'.
//
// Root cause (discovered via bundle analysis):
//   - @prisma/client (standard) resolves to wasm.js in CF Workers (workerd
//     condition), which needs query_engine_bg.wasm loaded via dynamic import.
//   - OpenNext/esbuild does NOT bundle .wasm files, so the dynamic import fails
//     at runtime with "wasm module unexpectedly null" → 500 on every DB call.
//
// Solution: @prisma/client/edge always resolves to edge.js (runtime/edge.js)
//   - edge.js has ZERO WebAssembly/wasm references
//   - edge.js has driverAdapters in previewFeatures → accepts adapter option
//   - edge.js is designed for Vercel Edge, CF Workers, Deno Deploy, etc.
//   - All queries are routed through PrismaNeonHTTP adapter (Neon HTTP API)
//
// References:
//   https://www.prisma.io/docs/orm/prisma-client/deployment/edge/deploy-to-cloudflare#neon
import { PrismaClient } from '@prisma/client/edge';
import { PrismaNeonHTTP } from '@prisma/adapter-neon';

function createPrismaClient() {
  // Strip CR chars that appear when .env has CRLF line endings (Windows dev)
  const url = process.env.DATABASE_URL?.replace(/\r/g, '');
  if (!url) throw new Error('DATABASE_URL is not set');

  // PrismaNeonHTTP uses the Neon HTTP API — works in both Node.js and CF Workers
  const adapter = new PrismaNeonHTTP(url, {});
  return new PrismaClient({ adapter });
}

// Reuse across hot-reloads in development
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;
