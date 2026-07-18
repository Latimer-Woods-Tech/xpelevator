/**
 * UI tests for the operator-facing scenario-library surface
 * (src/app/library/page.tsx).
 *
 * Deterministic: the page is a pure server component that reads the pure pack
 * catalog (src/lib/scenario-packs.ts) — no auth, no DB, no network — so it
 * renders identically every run. These tests lock the operator-facing contract:
 *   - every starter pack renders, with its role and scenario count
 *   - each scenario shows its trainee-facing summary + difficulty
 *   - the hidden mechanics (persona / objective / hints) NEVER reach the DOM
 *   - the org copy rule holds: the word "AI" never appears
 *
 * Environment: happy-dom
 * Run:  npx vitest tests/ui/library-page.test.tsx
 */
// @vitest-environment happy-dom

/// <reference types="@testing-library/jest-dom" />
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SCENARIO_PACKS } from '@/lib/scenario-packs';

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

async function renderLibrary() {
  vi.resetModules();
  const { default: Library } = await import('@/app/library/page');
  return render(<Library />);
}

describe('Library page — operator-facing scenario inventory', () => {
  it('renders every starter pack with its role and a scenario-count chip', async () => {
    await renderLibrary();
    for (const pack of SCENARIO_PACKS) {
      expect(
        screen.getByRole('heading', { level: 2, name: pack.name }),
      ).toBeInTheDocument();
      // role chip is unique per pack
      expect(screen.getByText(`Role: ${pack.jobTitle.name}`)).toBeInTheDocument();
      // each pack carries its own scenario-count chip (count may repeat across packs)
      const countChips = screen.getAllByText(`${pack.scenarios.length} scenarios`);
      expect(countChips.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('shows each scenario name + summary but NEVER the hidden mechanics', async () => {
    const { container } = await renderLibrary();
    const text = container.textContent ?? '';
    for (const pack of SCENARIO_PACKS) {
      for (const s of pack.scenarios) {
        expect(text).toContain(s.name);
        expect(text).toContain(s.summary);
        // hidden mechanics must not leak onto the public surface (R-021)
        expect(text).not.toContain(s.script.customerPersona);
        expect(text).not.toContain(s.script.customerObjective);
        for (const h of s.script.hints ?? []) {
          expect(text).not.toContain(h);
        }
      }
    }
  });

  it('speaks to operators (channel-first inventory framing)', async () => {
    await renderLibrary();
    expect(screen.getByText(/Starter scenario library/i)).toBeInTheDocument();
    // operator-facing hero headline
    expect(
      screen.getByRole('heading', { name: /Sellable training inventory on day one/i }),
    ).toBeInTheDocument();
    // an explicit operator onboarding CTA
    expect(
      screen.getByRole('link', { name: /Onboard your workspace/i }),
    ).toBeInTheDocument();
  });

  it('carries the E1 ICP wedge line (sales-floor enablement + coaching)', async () => {
    const { container } = await renderLibrary();
    const text = container.textContent ?? '';
    // the decided go-to-market focus (E1) is named on the shop window
    expect(text).toMatch(/sales-floor enablement/i);
    expect(text).toMatch(/personal-development coaching/i);
    expect(text).toMatch(/Sales & Motivational Coaching/i);
  });

  it('never says the banned word "AI" (org copy rule)', async () => {
    const { container } = await renderLibrary();
    expect(container.textContent ?? '').not.toMatch(/\bAI\b/);
  });
});
