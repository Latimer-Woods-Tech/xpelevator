// ── Postgres client for Cloudflare Workers ───────────────────────────────────
//
// postgres.js over TCP (cloudflare:sockets via nodejs_compat). Speaks the same
// tagged-template interface the previous Neon HTTP driver exposed, so call
// sites are unchanged. Works against any Postgres origin — the self-hosted
// OCI pair or Neon — selected purely by DATABASE_URL.
//
// Workers must not share a socket client across requests ("Cannot perform I/O
// on behalf of a different request"), so each query opens a short-lived
// single-connection client and closes it after the result resolves.
import postgres from 'postgres';

const url = process.env.DATABASE_URL?.replace(/\r/g, '');
if (!url) throw new Error('DATABASE_URL is not set');

// Type-safe query helpers
export type QueryResult<T = any> = T[];

export const sql = async <T = any>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<T[]> => {
  const client = postgres(url, { max: 1, prepare: false });
  try {
    return (await client(strings as TemplateStringsArray, ...(values as never[]))) as unknown as T[];
  } finally {
    client.end({ timeout: 2 }).catch(() => {});
  }
};

export default sql;
