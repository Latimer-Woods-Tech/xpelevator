/**
 * Environment variable validation.
 *
 * Runs once on module import (server startup).
 * Warns in development; throws in production for hard-required vars.
 */

import { log } from '@/lib/log';

const isDev = process.env.NODE_ENV !== 'production';

type EnvVarSpec = {
  key: string;
  required: boolean;
  description: string;
};

const ENV_VARS: EnvVarSpec[] = [
  {
    key: 'DATABASE_URL',
    required: true,
    description: 'Neon Postgres connection string — all database queries will fail without this',
  },
  {
    key: 'AUTH_SECRET',
    required: true,
    description: 'NextAuth secret — /api/auth/session returns 500 without this',
  },
  {
    key: 'GROQ_API_KEY',
    required: true,
    description: 'Groq API key for AI-powered virtual customer responses',
  },
  {
    key: 'SENTRY_DSN',
    required: false,
    description:
      'Sentry ingest DSN (#154 observability) — server error sink. Optional: absent → the sink no-ops, requests are unaffected.',
  },
  {
    key: 'POSTHOG_KEY',
    required: false,
    description:
      'PostHog project ingest key (#154 observability) — product-event sink. Optional: absent → the sink no-ops, requests are unaffected.',
  },
];

function validateEnv(): void {
  const missing: EnvVarSpec[] = [];

  for (const spec of ENV_VARS) {
    const value = process.env[spec.key];
    if (!value || value.trim() === '') {
      missing.push(spec);
    }
  }

  if (missing.length === 0) return;

  if (isDev) {
    log('warn', 'env.missing_variables', {
      missing: missing.map(s => ({ key: s.key, description: s.description })),
      hint: 'Check your .env file and add the missing values.',
    });
  } else {
    // In production, hard-required vars must be present
    const hardMissing = missing.filter(s => s.required);
    if (hardMissing.length > 0) {
      const hardLines = hardMissing.map(s => `  • ${s.key}`).join('\n');
      throw new Error(
        `Missing required environment variables:\n${hardLines}\n` +
          `Set these in your deployment environment.`
      );
    }
  }
}

// Run validation on import (once, at server startup)
validateEnv();

// ─── Validated accessors ─────────────────────────────────────────────────────

/** Groq API key — may be undefined in dev if not yet configured. */
export const GROQ_API_KEY = process.env.GROQ_API_KEY ?? '';

/** Neon Postgres connection string */
export const DATABASE_URL = process.env.DATABASE_URL ?? '';

/** NextAuth secret — required for session signing */
export const AUTH_SECRET = process.env.AUTH_SECRET ?? '';

/**
 * Sentry ingest DSN for the server error sink (#154). Optional — an empty value
 * makes `@/lib/sentry` no-op, so a DSN-less deploy runs unaffected. Read directly
 * from `process.env` by the sink itself to stay off the env→log→sentry cycle;
 * exported here only so the var is documented in one canonical registry.
 */
export const SENTRY_DSN = process.env.SENTRY_DSN ?? '';

/**
 * PostHog project ingest key for the product-event sink (#154). Optional — an
 * empty value makes `@/lib/posthog` no-op, so a key-less deploy runs unaffected.
 * Read directly from `process.env` by the sink itself; exported here only so the
 * var is documented in one canonical registry (mirrors `SENTRY_DSN`).
 */
export const POSTHOG_KEY = process.env.POSTHOG_KEY ?? '';

/**
 * Whether GitHub OAuth is configured.
 * The GitHub provider in src/auth.ts is only included when both of these are
 * set — without them NextAuth throws "server configuration" 500 errors on
 * every /api/auth/session call and cascades to useSession() in the UI.
 */
export const GITHUB_OAUTH_ENABLED =
  !!(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET);
