// ── Prisma client with Neon HTTP adapter ────────────────────────────────────
//
// IMPORTANT: Must import from '@prisma/client', NOT '@prisma/client/edge'.
//
// In Prisma v6 with driverAdapters previewFeature + adapter option:
//   - @prisma/client (standard) resolves to wasm.js in CF Workers (workerd
//     condition). With an adapter, Prisma uses DriverAdapterQueryEngine and
//     the WASM module (query_engine_bg.wasm) is NOT loaded at all.
//   - @prisma/client/edge throws PrismaClientValidationError when adapter
//     option is passed ("imported via /edge endpoint").
//
// References:
//   https://www.prisma.io/docs/orm/prisma-client/deployment/edge/deploy-to-cloudflare#neon
import { PrismaClient } from '@prisma/client';
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
