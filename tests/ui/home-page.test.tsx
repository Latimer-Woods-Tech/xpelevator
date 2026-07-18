/**
 * UI tests for the home page (src/app/page.tsx).
 *
 * page.tsx is a server component that calls auth() — if NextAuth is
 * misconfigured (e.g. missing AUTH_SECRET or undefined GitHub env vars
 * pre-fix), the entire page throws a 500 and *all* client-side fetches
 * (including /api/jobs from /simulate) fail.
 *
 * We test the rendered HTML snapshots for both authenticated and
 * unauthenticated states using a mocked auth module.
 *
 * Environment: jsdom
 * Run:  npx vitest tests/ui/home-page.test.tsx
 */
// @vitest-environment happy-dom

/// <reference types="@testing-library/jest-dom" />
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';

// ── Mock the auth module ──────────────────────────────────────────────────────
const mockAuth = vi.fn();
vi.mock('@/auth', () => ({
  auth: mockAuth,
  signOut: vi.fn(),
  signIn: vi.fn(),
  handlers: {},
}));

// ── Mock next/link ────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────

async function renderHome() {
  vi.resetModules();
  const { default: Home } = await import('@/app/page');
  // page.tsx is an async server component — await its JSX
  const element = await (Home as () => Promise<React.ReactElement>)();
  return render(element);
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Home page — unauthenticated state', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue(null);
  });

  it('renders XPElevator heading', async () => {
    await renderHome();
    // h1 contains "XP" + <span>Elevator</span> — check via heading role
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toBeInTheDocument();
    // textContent collapses child spans; strip whitespace before comparing
    expect(h1.textContent?.replace(/\s+/g, '')).toBe('XPElevator');
  });

  it('shows Sign in link when no session', async () => {
    await renderHome();
    const signInLink = screen.getByRole('link', { name: /sign in/i });
    expect(signInLink).toBeInTheDocument();
    expect(signInLink).toHaveAttribute('href', '/auth/signin');
  });

  it('shows all 4 navigation cards', async () => {
    await renderHome();
    // Scope to <main> — the persistent TopNav also links to these sections, so
    // an unscoped query would be ambiguous (e.g. two "Analytics" links).
    const main = within(screen.getByRole('main'));
    expect(main.getByRole('link', { name: /start simulation/i })).toBeInTheDocument();
    expect(main.getByRole('link', { name: /view sessions/i })).toBeInTheDocument();
    expect(main.getByRole('link', { name: /admin panel/i })).toBeInTheDocument();
    expect(main.getByRole('link', { name: /analytics/i })).toBeInTheDocument();
  });

  it('start simulation card links to /simulate', async () => {
    await renderHome();
    const main = within(screen.getByRole('main'));
    expect(main.getByRole('link', { name: /start simulation/i })).toHaveAttribute(
      'href',
      '/simulate'
    );
  });

  it('does not show Sign out when unauthenticated', async () => {
    await renderHome();
    expect(screen.queryByRole('button', { name: /sign out/i })).not.toBeInTheDocument();
  });

  // Org copy rule: "AI" must never appear as a standalone word in user-facing
  // copy (same guard the pricing page carries). The Sessions card previously
  // read "AI-generated performance scores"; it now reads "weighted performance
  // scores" — this asserts the banned word does not creep back.
  it('never says the banned word "AI"', async () => {
    const { container } = await renderHome();
    expect(container.textContent ?? '').not.toMatch(/\bAI\b/);
  });

  // E1 wedge (issue #16): the home surface must carry the decided-ICP
  // positioning (sales floors + coaching practices), not generic framing —
  // and point at the operator shop windows. Locked so the copy can't silently
  // regress to generic. Operator-first framing only (no retail marketing).
  it('renders the ICP wedge band naming sales floors + coaching practices', async () => {
    await renderHome();
    const main = within(screen.getByRole('main'));
    expect(main.getByText(/who we built this for/i)).toBeInTheDocument();
    expect(main.getByText(/sales floors and coaching practices/i)).toBeInTheDocument();
    expect(
      main.getByText(/personal-development coaching practices/i)
    ).toBeInTheDocument();
  });

  it('wedge band links to the /pricing and /library operator surfaces', async () => {
    await renderHome();
    const main = within(screen.getByRole('main'));
    expect(main.getByRole('link', { name: /wholesale seat plans/i })).toHaveAttribute(
      'href',
      '/pricing'
    );
    expect(
      main.getByRole('link', { name: /sales & motivational coaching demo line/i })
    ).toHaveAttribute('href', '/library');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Home page — authenticated state', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-1', name: 'Alex Trainer', email: 'alex@example.com' },
    });
  });

  it('shows welcome message with user name', async () => {
    await renderHome();
    expect(screen.getByText(/Alex Trainer/i)).toBeInTheDocument();
  });

  it('shows Sign out button when authenticated', async () => {
    await renderHome();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });

  it('does NOT show Sign in link when authenticated', async () => {
    await renderHome();
    expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Home page — auth() throws (misconfigured auth)', () => {
  it('re-throws auth errors so Next.js can render error boundary', async () => {
    mockAuth.mockRejectedValue(new Error('AUTH_SECRET not set'));
    vi.resetModules();
    const { default: Home } = await import('@/app/page');
    await expect(
      (Home as () => Promise<React.ReactElement>)()
    ).rejects.toThrow('AUTH_SECRET not set');
  });
});
