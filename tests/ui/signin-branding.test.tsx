/**
 * UI tests for the client-facing white-label render surface on the sign-in
 * shell (src/app/auth/signin/page.tsx, R-050).
 *
 * When a trainee arrives via `/auth/signin?org=<slug>` OR via an operator
 * subdomain (resolved host-side by GET /api/branding/by-host, R-055), the shell
 * fetches the operator's brand-safe branding and presents the operator's name /
 * logo / colors. With no slug and no operator subdomain (the apex → by-host
 * 404) it falls back to the default XPElevator presentation. These tests lock:
 *   - default (no ?org, by-host 404s): the XPElevator wordmark renders, no
 *     operator logo, and the shell probed the host-resolved read
 *   - branded (?org=acme, fetch returns branding): operator name + logo render,
 *     and the primary color is applied to the Continue button
 *   - the org copy rule holds: the word "AI" never appears
 *
 * Environment: happy-dom
 * Run:  npx vitest tests/ui/signin-branding.test.tsx
 */
// @vitest-environment happy-dom

/// <reference types="@testing-library/jest-dom" />
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// ── Mocks: next-auth/react (signIn) + next/navigation (useSearchParams) ───────
vi.mock('next-auth/react', () => ({
  signIn: vi.fn(),
}));

let searchParamsValue = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParamsValue,
}));

async function renderSignIn() {
  vi.resetModules();
  const { default: SignIn } = await import('@/app/auth/signin/page');
  return render(<SignIn />);
}

const BRANDING = {
  slug: 'acme',
  displayName: 'Acme Training',
  logoUrl: 'https://cdn.acme.example/logo.svg',
  primaryColor: '#aa1122',
  accentColor: '#22bbcc',
};

beforeEach(() => {
  searchParamsValue = new URLSearchParams();
  vi.restoreAllMocks();
});

afterEach(() => {
  // @ts-expect-error – clean up the stubbed global between tests
  delete globalThis.fetch;
});

describe('Sign-in shell — default (no operator brand)', () => {
  it('probes the host-resolved read and renders the wordmark when it 404s', async () => {
    // No ?org slug → the shell probes `/api/branding/by-host`; on the apex that
    // 404s, so the default XPElevator presentation stays.
    const fetchSpy = vi
      .fn()
      .mockResolvedValue({ ok: false, json: async () => ({ error: 'not found' }) });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await renderSignIn();

    // Wordmark split across "XP" + "Elevator" — assert the container text.
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toContain('XP');
    expect(heading.textContent).toContain('Elevator');
    // No operator logo image; the host-resolved read was probed (no slug path).
    expect(screen.queryByRole('img')).toBeNull();
    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith('/api/branding/by-host')
    );
    // Org copy rule.
    expect(document.body.textContent).not.toMatch(/\bAI\b/);
  });
});

describe('Sign-in shell — branded via ?org=<slug>', () => {
  it('fetches the brand and renders the operator name, logo, and primary color', async () => {
    searchParamsValue = new URLSearchParams({ org: 'acme' });
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => BRANDING,
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await renderSignIn();

    // The brand read is same-origin + slug-scoped.
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('/api/branding/acme'));

    // Operator name replaces the default wordmark.
    await waitFor(() => expect(screen.getByText('Acme Training')).toBeInTheDocument());
    expect(screen.queryByText('Elevator')).toBeNull();

    // Operator logo renders with an accessible alt.
    const logo = screen.getByRole('img');
    expect(logo).toHaveAttribute('src', BRANDING.logoUrl);
    expect(logo).toHaveAttribute('alt', 'Acme Training');

    // Primary color is applied to the Continue button.
    const continueBtn = screen.getByRole('button', { name: /continue$/i });
    expect(continueBtn.getAttribute('style') ?? '').toContain('aa1122');

    expect(document.body.textContent).not.toMatch(/\bAI\b/);
  });

  it('falls back to the default when the brand read 404s (unknown slug)', async () => {
    searchParamsValue = new URLSearchParams({ org: 'nope' });
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, json: async () => ({ error: 'not found' }) }) as unknown as typeof fetch;

    await renderSignIn();

    const heading = screen.getByRole('heading', { level: 1 });
    await waitFor(() => expect(heading.textContent).toContain('Elevator'));
    expect(screen.queryByRole('img')).toBeNull();
  });
});
