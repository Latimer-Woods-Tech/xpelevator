/**
 * UI test for the analytics page's manager-reporting entry point.
 *
 * Verifies the "Download CSV" affordance is always present in the header (it
 * points at `GET /api/reports/sessions`, the admin-only export) regardless of
 * the analytics fetch state, and that the surface stays copy-clean (no "AI").
 *
 * Environment: happy-dom
 */
// @vitest-environment happy-dom

/// <reference types="@testing-library/jest-dom" />
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// next/link → plain anchor so href assertions work in jsdom.
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
    <a href={typeof href === 'string' ? href : '#'} className={className}>
      {children}
    </a>
  ),
}));

import AnalyticsPage from '@/app/analytics/page';

describe('AnalyticsPage — manager reporting export', () => {
  beforeEach(() => {
    // Never-resolving fetch keeps the component in its initial render so the
    // test exercises the always-present header, independent of live data.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
  });

  it('renders a Download CSV link to the admin sessions report', () => {
    render(<AnalyticsPage />);
    const link = screen.getByRole('link', { name: /download csv/i });
    expect(link).toHaveAttribute('href', '/api/reports/sessions');
  });

  it('renders a Download PDF link to the same report in PDF form', () => {
    render(<AnalyticsPage />);
    const link = screen.getByRole('link', { name: /download pdf/i });
    expect(link).toHaveAttribute('href', '/api/reports/sessions?format=pdf');
  });

  it('keeps the surface copy-clean (never the word "AI")', () => {
    const { container } = render(<AnalyticsPage />);
    expect(container.textContent ?? '').not.toMatch(/\bAI\b/);
  });
});
