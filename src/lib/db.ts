// Postgres client for OpenNext-on-Cloudflare.
//
// Workers/Pages cannot open a direct TCP connection to Postgres (the
// nodejs_compat TLS upgrade hangs), so all traffic goes through a Hyperdrive
// binding. The connection string is resolved per query from the Cloudflare
// request context (getCloudflareContext) - the same runtime-binding accessor
// already used by groq-fetch.ts / telnyx.ts - never at module load.
//
// postgres.js speaks the normal Postgres wire protocol, so the interface is
// the same tagged-template `sql` the previous Neon HTTP driver exposed and all
// call sites are unchanged. A short-lived per-query client is used because a
// Worker must not share a socket client across requests.
import postgres from 'postgres';
import { getCloudflareContext } from '@opennextjs/cloudflare';

function resolveConnectionString(): string {
  try {
    const env = getCloudflareContext().env as Record<string, unknown>;
    const hyperdrive = env?.HYPERDRIVE as { connectionString?: string } | undefined;
    if (hyperdrive?.connectionString) return hyperdrive.connectionString;
  } catch {
    // Not inside a Cloudflare request context (build / test) - fall through.
  }
  const url = process.env.DATABASE_URL?.replace(/\r/g, '');
  if (!url) throw new Error('No HYPERDRIVE binding and DATABASE_URL is not set');
  return url;
}

// Type-safe query helpers
export type QueryResult<T = any> = T[];

export const sql = async <T = any>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<T[]> => {
  const client = postgres(resolveConnectionString(), { max: 1, prepare: false });
  try {
    return (await client(strings as TemplateStringsArray, ...(values as never[]))) as unknown as T[];
  } finally {
    client.end({ timeout: 2 }).catch(() => {});
  }
};

export default sql;
