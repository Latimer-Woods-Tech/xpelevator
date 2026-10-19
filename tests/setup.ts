/**
 * Global Vitest setup — runs before every test file.
 *
 * Every tier that runs here is DETERMINISTIC: the unit (tests/unit) and ui
 * (tests/ui) tiers mock every seam (auth/next-auth/next-navigation/fetch/DB),
 * so no real credential or `.env` is ever read — the suite behaves identically
 * locally and in CI. This file now only installs deterministic env defaults and
 * test-environment shims.
 *
 * The last credential-bound suite — the out-of-band `test:e2e` harness
 * (`tests/e2e/full-simulation.ts`), which hit live Neon + Groq — was retired
 * (issue #156) along with the older live-API `smoke`/integration/voice tiers.
 * Live coverage is now the deterministic Playwright `smoke` tier in CI plus the
 * `uptime-monitor` health + scoring canary against prod. The old `.env` loader
 * that lived here existed only for that harness and was removed with it.
 *
 * Unit tests that need isolated behaviour can still use vi.mock() locally.
 */

import { vi } from 'vitest';

// ── Deterministic env defaults for optional/non-critical vars ─────────────────
// Set unconditionally-safe stubs so unit tests that read these never depend on a
// real credential. (Telnyx unit tests mock the HTTP seam; these just satisfy
// config-load guards.)
if (!process.env.TELNYX_API_KEY)       process.env.TELNYX_API_KEY = 'test-telnyx-key';
if (!process.env.TELNYX_CONNECTION_ID) process.env.TELNYX_CONNECTION_ID = 'test-conn-id';
if (!process.env.TELNYX_WEBHOOK_URL)   process.env.TELNYX_WEBHOOK_URL = 'https://example.com/api/telnyx/webhook';
if (!process.env.TELNYX_FROM_NUMBER)   process.env.TELNYX_FROM_NUMBER = '+15550000000';

// NODE_ENV — set to 'test' so logic branches use dev behaviour
(process.env as Record<string, string>).NODE_ENV = 'test';

// GitHub OAuth is intentionally NOT set — tests confirm the app works without it

// ── jest-dom matchers for component tests (jsdom environment) ─────────────────
if (typeof window !== 'undefined') {
  import('@testing-library/jest-dom').catch(() => {});
}

// ── Suppress console.error / console.warn noise in tests ─────────────────────
vi.spyOn(console, 'error').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
