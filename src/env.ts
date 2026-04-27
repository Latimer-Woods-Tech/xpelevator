/**
 * Cloudflare Worker environment bindings for xpelevator.
 * Extend this interface as you add Hyperdrive, KV, R2, or other bindings.
 */
export interface Env {
  // ── Cloudflare bindings ──────────────────────────────────────────────────
  DB: Hyperdrive;
  AUTH_RATE_LIMITER: RateLimit;

  // ── Secrets (set via wrangler secret put or GitHub Actions env secrets) ──
  JWT_SECRET: string;
  SENTRY_DSN: string;
  POSTHOG_KEY: string;
  ANTHROPIC_API_KEY: string;
  GROK_API_KEY: string;
  GROQ_API_KEY: string;
  RESEND_API_KEY: string;

  // ── Non-secret vars (wrangler.jsonc [vars]) ──────────────────────────────
  ENVIRONMENT: string;
  WORKER_NAME: string;
}
