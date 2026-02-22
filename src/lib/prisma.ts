// ── Prisma client with Neon HTTP adapter ────────────────────────────────────
//
// We use the STANDARD @prisma/client (Node.js native binary) here.
//
// @prisma/client/wasm is only required for true edge runtimes (CF Workers) where the
// native binary cannot run. When deploying to Cloudflare via @opennextjs/cloudflare,
// the esbuild bundle step handles the CF Workers compatibility. For local development
// (Next.js dev server, Node.js) the WASM approach fails with "Unknown file extension
// .wasm" because Node.js ESM does not load .wasm files without --experimental-wasm-modules.
//
// References:
//   https://www.prisma.io/docs/orm/prisma-client/deployment/edge/deploy-to-cloudflare-workers
//   BL-045 — CF build currently broken; WASM strategy to be revisited
import { PrismaClient } from '@prisma/client';
import { PrismaNeonHTTP } from '@prisma/adapter-neon';

function createPrismaClient() {
  // Strip CR chars that appear when .env has CRLF line endings (Windows dev)
  const url = process.env.DATABASE_URL?.replace(/\r/g, '');
  if (!url) throw new Error('DATABASE_URL is not set');

  console.log('DATABASE_URL available:', !!url);
  console.log('DATABASE_URL starts with:', url.substring(0, 20) + '...');

  // PrismaNeonHTTP uses the Neon HTTP API — works in both Node.js and CF Workers
  const adapter = new PrismaNeonHTTP(url, {});
  return new PrismaClient({ adapter });
}

// Reuse across hot-reloads in development
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;
