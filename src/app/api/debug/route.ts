import { NextResponse } from 'next/server';

// GET /api/debug — tests Prisma + DB connection, returns full error info
// TODO: Remove before shipping to real customers
export async function GET() {
  const results: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL
      ? process.env.DATABASE_URL.substring(0, 30) + '...'
      : 'MISSING',
  };

  // 1. Test raw Neon HTTP
  try {
    const { neon } = await import('@neondatabase/serverless');
    const url = process.env.DATABASE_URL?.replace(/\r/g, '');
    if (!url) throw new Error('DATABASE_URL missing');
    const sql = neon(url);
    const rows = await sql`SELECT COUNT(*) as cnt FROM job_titles`;
    results.neonRaw = { ok: true, count: rows[0]?.cnt };
  } catch (e) {
    results.neonRaw = { ok: false, error: String(e) };
  }

  // 2. Test Prisma client init
  try {
    const { PrismaNeonHTTP } = await import('@prisma/adapter-neon');
    const { PrismaClient } = await import('@prisma/client');
    const url = process.env.DATABASE_URL?.replace(/\r/g, '');
    if (!url) throw new Error('DATABASE_URL missing');
    const adapter = new PrismaNeonHTTP(url, {});
    const prisma = new PrismaClient({ adapter });
    results.prismaInit = { ok: true };
    // 3. Test Prisma query
    try {
      const count = await prisma.jobTitle.count();
      results.prismaQuery = { ok: true, count };
    } catch (e) {
      results.prismaQuery = { ok: false, error: String(e) };
    }
  } catch (e) {
    results.prismaInit = { ok: false, error: String(e) };
  }

  return NextResponse.json(results);
}
