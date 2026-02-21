import { PrismaClient } from '@prisma/client/edge';
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
