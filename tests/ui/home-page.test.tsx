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

/// <reference types="@testing-library/jest-dom" />
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

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
    expect(screen.getByText(/XPElevator|XP.*Elevator/i)).toBeInTheDocument();
  });

  it('shows Sign in link when no session', async () => {
    await renderHome();
    const signInLink = screen.getByRole('link', { name: /sign in/i });
    expect(signInLink).toBeInTheDocument();
    expect(signInLink).toHaveAttribute('href', '/auth/signin');
  });

  it('shows all 4 navigation cards', async () => {
    await renderHome();
    expect(screen.getByRole('link', { name: /start simulation/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view sessions/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /admin panel/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /analytics/i })).toBeInTheDocument();
  });

  it('start simulation card links to /simulate', async () => {
    await renderHome();
    expect(screen.getByRole('link', { name: /start simulation/i })).toHaveAttribute(
      'href',
      '/simulate'
    );
  });

  it('does not show Sign out when unauthenticated', async () => {
    await renderHome();
    expect(screen.queryByRole('button', { name: /sign out/i })).not.toBeInTheDocument();
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
