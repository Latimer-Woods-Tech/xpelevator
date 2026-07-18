/**
 * UI tests for the operator-facing pricing surface (src/app/pricing/page.tsx).
 *
 * Deterministic: the page is a pure server component that reads the pure
 * seat-plan catalog (src/lib/plans.ts) — no auth, no DB, no network — so it
 * renders identically every run. These tests lock the operator-facing contract:
 *   - all three seat tiers render, in catalog order (chat → voice → phone)
 *   - each tier's cumulative modalities show as trainee-facing labels
 *   - no hard-coded money leaks onto the surface (wholesale = founder input)
 *   - the org copy rule holds: the word "AI" never appears
 *
 * Environment: happy-dom
 * Run:  npx vitest tests/ui/pricing-page.test.tsx
 */
// @vitest-environment happy-dom

/// <reference types="@testing-library/jest-dom" />
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

// ── Mock next/link (same shim the home-page test uses) ────────────────────────
import { vi } from 'vitest';
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

async function renderPricing() {
  vi.resetModules();
  const { default: Pricing } = await import('@/app/pricing/page');
  return render(<Pricing />);
}

describe('Pricing page — operator-facing seat catalog', () => {
  it('renders all three seat tiers in catalog order', async () => {
    await renderPricing();
    const headings = screen
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent?.trim());
    // The three seat tiers render first, in catalog order (chat → voice → phone);
    // the ICP wedge band's heading follows.
    expect(headings.slice(0, 3)).toEqual(['Chat', 'Voice', 'Phone']);
  });

  it('carries the E1 ICP wedge band (sales floors + coaching practices)', async () => {
    await renderPricing();
    expect(screen.getByText(/Who we built this for/i)).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /Sales floors and coaching practices/i }),
    ).toBeInTheDocument();
    // names the decided ICP and links to the demo-line pack in the library
    expect(
      screen.getByRole('link', { name: /Sales & Motivational Coaching demo line/i }),
    ).toBeInTheDocument();
  });

  it('shows cumulative modalities as trainee-facing labels', async () => {
    await renderPricing();
    // Chat tier → only text chat; Phone tier → all three modality labels.
    expect(screen.getAllByText('Text chat').length).toBe(3); // in every tier
    expect(screen.getAllByText('In-browser voice').length).toBe(2); // voice + phone
    expect(screen.getAllByText('Live phone calls').length).toBe(1); // phone only
  });

  it('speaks to operators (channel-first), with a Get started CTA', async () => {
    await renderPricing();
    expect(screen.getByText(/For training operators/i)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /get started/i }).length).toBe(3);
  });

  it('never hard-codes money and never says the banned word "AI"', async () => {
    const { container } = await renderPricing();
    const text = container.textContent ?? '';
    // No currency symbols / price patterns — wholesale amounts are a founder input.
    expect(text).not.toMatch(/[$€£]\s?\d/);
    expect(text).not.toMatch(/\/\s?mo\b\s?[$€£]/);
    // Org copy rule: "AI" must not appear as a standalone word on any surface.
    expect(text).not.toMatch(/\bAI\b/);
  });
});
