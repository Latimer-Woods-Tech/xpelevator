/**
 * Global Vitest setup — runs before every test file.
 * Sets required environment variables so imports of src/lib/env.ts don't throw.
 */

import { vi } from 'vitest';

// ── Environment variables required by src/lib/env.ts ─────────────────────────
// NODE_ENV is read-only in TypeScript strict mode — cast to bypass the check.
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.GROQ_API_KEY = 'test-groq-key-00000000000000000000';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/xpelevator_test';
process.env.AUTH_SECRET = 'test-auth-secret-32chars-minimum!!';
process.env.TELNYX_API_KEY = 'test-telnyx-key';
process.env.TELNYX_CONNECTION_ID = 'test-conn-id';
process.env.TELNYX_WEBHOOK_URL = 'https://example.com/api/telnyx/webhook';
process.env.TELNYX_FROM_NUMBER = '+15550000000';
// GitHub OAuth is intentionally NOT set — tests confirm the app works without it

// ── jest-dom matchers for component tests (jsdom environment) ─────────────────
// Only imported when running under jsdom — safe no-op in node environment
if (typeof window !== 'undefined') {
  // Dynamic import avoids pulling into node environment where it's not needed
  import('@testing-library/jest-dom').catch(() => {
    // Package not yet installed — run `npm install` to enable UI tests
  });
}

// ── Suppress console.error / console.warn noise in tests ─────────────────────
vi.spyOn(console, 'error').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
