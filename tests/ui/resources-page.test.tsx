/**
 * UI tests for the operator resources guide (src/app/resources/page.tsx).
 *
 * Deterministic: the page is a pure server component that reads the pure
 * seat-plan catalog (src/lib/plans.ts) — no auth, no DB, no network — so it
 * renders identically every run. These tests lock the operator-collateral
 * contract the XPElevator loop set on issue #16 for Content-Factory content:
 *   - it is an operator-facing channel-model guide (not retail marketing)
 *   - the three seat tiers render, in catalog order (chat → voice → phone)
 *   - it points navigationally at the real surfaces (/pricing, /library)
 *   - no hard-coded money leaks onto the surface (wholesale = founder input)
 *   - the org copy rule holds: the word "AI" never appears
 *
 * Environment: happy-dom
 * Run:  npx vitest tests/ui/resources-page.test.tsx
 */
// @vitest-environment happy-dom

/// <reference types="@testing-library/jest-dom" />
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// ── Mock next/link (same shim the pricing/home-page tests use) ────────────────
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

async function renderResources() {
  vi.resetModules();
  const { default: Resources } = await import('@/app/resources/page');
  return render(<Resources />);
}

describe('Resources page — operator channel-model guide', () => {
  it('leads with the operator-guide, channel-model framing', async () => {
    await renderResources();
    expect(screen.getByText(/Operator guide/i)).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: /How the channel model works/i }),
    ).toBeInTheDocument();
  });

  it('renders all three seat tiers in catalog order', async () => {
    await renderResources();
    const headings = screen
      .getAllByRole('heading', { level: 3 })
      .map((h) => h.textContent?.trim());
    // The three seat-tier names appear first among the h3s, in catalog order.
    expect(headings.slice(0, 3)).toEqual(['Chat', 'Voice', 'Phone']);
  });

  it('shows cumulative modalities as trainee-facing labels', async () => {
    await renderResources();
    // Chat tier → text chat only; each higher tier adds one modality.
    expect(screen.getAllByText('Text chat').length).toBe(3); // every tier
    expect(screen.getAllByText('In-browser voice').length).toBe(2); // voice + phone
    expect(screen.getAllByText('Live phone calls').length).toBe(1); // phone only
  });

  it('points navigationally at the real operator surfaces', async () => {
    const { container } = await renderResources();
    const hrefs = Array.from(container.querySelectorAll('a')).map((a) =>
      a.getAttribute('href'),
    );
    expect(hrefs).toContain('/pricing');
    expect(hrefs).toContain('/library');
    expect(hrefs).toContain('/auth/signin');
  });

  it('is operator-facing, not retail marketing', async () => {
    const { container } = await renderResources();
    const text = container.textContent ?? '';
    // Channel-model vocabulary is present…
    expect(text).toMatch(/wholesale/i);
    expect(text).toMatch(/\bretail\b/i);
    expect(text).toMatch(/operator/i);
  });

  it('never hard-codes money and never says the banned word "AI"', async () => {
    const { container } = await renderResources();
    const text = container.textContent ?? '';
    // No currency symbols / price patterns — wholesale amounts are a founder input.
    expect(text).not.toMatch(/[$€£]\s?\d/);
    // Org copy rule: "AI" must not appear as a standalone word on any surface.
    expect(text).not.toMatch(/\bAI\b/);
  });
});
