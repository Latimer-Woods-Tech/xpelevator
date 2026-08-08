import { expect, test, type Page } from '@playwright/test';

/**
 * Public-surface smoke tier (issue #156; PLATFORM_STANDARDS §3-4).
 *
 * Scope is deliberately the DB-free public surface so the gate is deterministic
 * and needs no live creds: `/`, `/pricing`, `/auth/signin`. Each check asserts
 * something a `curl` gate cannot — real browser render, rendered-text copy
 * rules, response security headers, and keyboard-focus a11y.
 */

/** The org rule: the literal word "AI" must never appear in user-facing copy.
 * Matched as a standalone token so substrings ("email", "available", "detail",
 * "training") never trip it — the same boundary the copy-pass gate uses. */
const AI_TOKEN = /\bAI\b/;

async function bodyText(page: Page): Promise<string> {
  return (await page.locator('body').innerText()).trim();
}

test.describe('public surface smoke', () => {
  test('landing page renders, is copy-clean, and carries security headers', async ({ page }) => {
    const res = await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(res, 'no response for /').not.toBeNull();
    expect(res!.status(), 'GET / must be 200').toBe(200);

    // Security headers the deploy-time curl gate also checks, verified here on
    // the document response through a real browser navigation.
    const headers = res!.headers();
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");

    // The product's one-line promise renders.
    await expect(
      page.getByText('Virtual customer simulator for training employees'),
    ).toBeVisible();

    // Wordmark heading present.
    await expect(page.locator('h1').first()).toContainText('Elevator');

    // Copy rule: no standalone "AI" anywhere in the rendered page text.
    expect(AI_TOKEN.test(await bodyText(page)), 'landing copy must not contain the word "AI"').toBe(
      false,
    );
  });

  test('pricing page shows the full operator seat catalog, copy-clean', async ({ page }) => {
    const res = await page.goto('/pricing', { waitUntil: 'domcontentloaded' });
    expect(res!.status(), 'GET /pricing must be 200').toBe(200);

    // Operator-first framing (channel-first, not retail).
    await expect(page.getByRole('heading', { name: 'Seat pricing built for resellers' })).toBeVisible();

    // All three seat tiers from the single-source catalog (src/lib/plans.ts).
    for (const tier of ['Chat', 'Voice', 'Phone']) {
      await expect(page.getByRole('heading', { name: tier, exact: true })).toBeVisible();
    }

    expect(AI_TOKEN.test(await bodyText(page)), 'pricing copy must not contain the word "AI"').toBe(
      false,
    );
  });

  test('sign-in page renders and the primary control is keyboard-focusable', async ({ page }) => {
    const res = await page.goto('/auth/signin', { waitUntil: 'domcontentloaded' });
    expect(res!.status(), 'GET /auth/signin must be 200').toBe(200);

    // A11y: at least one interactive control exists and can take keyboard focus
    // (the curl gates give zero a11y/keyboard signal — this is the gap §3 names).
    const controls = page.getByRole('button').or(page.getByRole('link'));
    await expect(controls.first()).toBeVisible();
    await page.keyboard.press('Tab');
    const focusedTag = await page.evaluate(() => document.activeElement?.tagName ?? '');
    expect(['A', 'BUTTON', 'INPUT'], 'Tab must move focus to an interactive element').toContain(
      focusedTag,
    );
  });
});
