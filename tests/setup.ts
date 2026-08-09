/**
 * Global Vitest setup — runs before every test file.
 *
 * Loads real credentials from .env when present, for the credential-bound
 * out-of-band `test:e2e` script (`tests/e2e/full-simulation.ts`) — the only
 * remaining live-credential suite. The deterministic unit/ui tiers that run in
 * CI mock every seam and need none of this. (The old live-API `smoke` vitest
 * tier was retired — issue #156; live smoke is now the deterministic Playwright
 * tier in CI plus the `uptime-monitor` scoring canary against prod.)
 *
 * Unit tests that need isolated behaviour can still use vi.mock() locally.
 */

import { vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── Load .env into process.env (real credentials for live testing) ────────────
try {
  const envPath = resolve(process.cwd(), '.env');
  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.replace(/\r$/, '').trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    // Strip surrounding quotes from values
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    // Only set if not already present (allows CI overrides)
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  // .env not found — rely on process.env already being set (CI / Cloudflare)
}

// ── Fallback stubs for optional/non-critical vars not in .env ─────────────────
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
