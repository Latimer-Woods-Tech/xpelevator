/**
 * Environment variable validation.
 *
 * Runs once on module import (server startup).
 * Warns in development; throws in production for hard-required vars.
 */

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

  const lines = missing.map(
    s => `  • ${s.key} — ${s.description}`
  );

  if (isDev) {
    console.warn(
      `\n⚠️  XPElevator: Missing environment variables:\n${lines.join('\n')}\n` +
        `  Check your .env file and add the missing values from secrets.txt.\n`
    );
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
 * Whether GitHub OAuth is configured.
 * The GitHub provider in src/auth.ts is only included when both of these are
 * set — without them NextAuth throws "server configuration" 500 errors on
 * every /api/auth/session call and cascades to useSession() in the UI.
 */
export const GITHUB_OAUTH_ENABLED =
  !!(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET);
