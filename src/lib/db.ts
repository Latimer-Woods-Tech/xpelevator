// ── Neon HTTP database client for Cloudflare Workers ────────────────────────
//
// Uses Neon's native HTTP client which is fully edge-compatible and has no
// Node.js filesystem dependencies. This completely bypasses Prisma to avoid
// the fs.readdir issues in Cloudflare Workers.
//
// Reference: https://neon.tech/docs/serverless/serverless-driver
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL?.replace(/\r/g, '');
if (!url) throw new Error('DATABASE_URL is not set');

// Create HTTP-based query function
export const sql = neon(url);

// Type-safe query helpers
export type QueryResult<T = any> = T[];

export default sql;
