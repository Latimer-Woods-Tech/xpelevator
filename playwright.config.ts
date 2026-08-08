import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright smoke tier (PLATFORM_STANDARDS §3-4 — "Playwright `smoke` tier
 * mandatory"; issue #156). Deterministic and credential-free: it drives a real
 * Chromium against a production `next start` of THIS build over the public,
 * DB-free surface — the landing page (`/`), the operator pricing shop-window
 * (`/pricing`, `force-static`), and the sign-in page (`/auth/signin`). These are
 * exactly the pages the `next.config.ts` CSP note already proved render + hydrate
 * clean in a headless browser, so the tier can be a required gate without
 * flaking on live Neon/Groq/Telnyx creds (the reason the integration/smoke
 * vitest tiers are NOT gated).
 *
 * What the deploy-time `curl` gates cannot see and this tier does: real DOM
 * render + hydration, the org "never the word 'AI' in user-facing copy" rule
 * enforced against rendered browser text (not source), and keyboard-focus a11y.
 *
 * The server is built once (`npm run build`) and started by Playwright's
 * `webServer` with the same dummy env the CI `build` job uses — no secrets, no
 * network egress. Browser binary: CI installs Chromium via
 * `npx playwright install --with-deps chromium`; locally the pre-installed
 * Chromium is discovered through `PLAYWRIGHT_BROWSERS_PATH`.
 */
const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3000);
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Playwright owns the server lifecycle so the gate is self-contained. Skipped
  // when PLAYWRIGHT_BASE_URL points at an already-running server (local reuse).
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: `npm run start -- -p ${PORT}`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          // Dummy, non-secret values — identical posture to the CI `build` job.
          // The smoke surface never touches the DB/LLM, so these are inert.
          DATABASE_URL: 'postgresql://user:pass@localhost/db',
          GROQ_API_KEY: 'dummy-key-for-smoke',
          AUTH_SECRET: 'dummy-secret-for-smoke-0123456789abcdef',
          // Trust the localhost origin so NextAuth's client session probe on
          // /auth/signin doesn't log UntrustedHost under the dummy env. Prod
          // sets its own AUTH_URL; this only affects the smoke server.
          AUTH_TRUST_HOST: 'true',
        },
      },
});
