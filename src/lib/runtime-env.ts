import { getCloudflareContext } from '@opennextjs/cloudflare';

/**
 * Resolve a secret/config value the way the deployed OpenNext Worker actually
 * carries it: the Cloudflare runtime binding first, with a `process.env`
 * fallback for local `next dev` and tests.
 *
 * Why not read `process.env.*` directly?
 * webpack's DefinePlugin inlines `process.env.*` at BUILD time, so a runtime
 * secret set via `wrangler pages secret put` / a CF binding is simply absent
 * from `process.env` in the deployed Worker. `getCloudflareContext().env` is a
 * true runtime binding — never touched by webpack — so it always carries the
 * real value. Reading a binding-only secret through `process.env` is exactly
 * what took the phone modality dark (#125) and is why the scoring path
 * (`getGroqClient`) and the Telnyx helpers already resolve binding-first.
 *
 * The value is trimmed because a stray trailing newline/CR (the GCP Secret
 * Manager trap) corrupts downstream use. Returns `undefined` when the value is
 * unset or whitespace-only, so callers can apply their own default rule.
 */
export function getRuntimeEnv(key: string): string | undefined {
  let value: string | undefined;

  // 1. Cloudflare runtime binding (production) — NOT inlined at build time
  try {
    const { env } = getCloudflareContext();
    value = (env as Record<string, string | undefined>)[key];
  } catch {
    // Not in a CF Worker context (local dev / tests) — fall through
  }

  // 2. process.env fallback for local development
  value ??= process.env[key];

  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
