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
import { render, screen, waitFor } from '@testing-library/react';

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

describe('AnalyticsPage — scoring health surface', () => {
  const withData = (health: {
    scored: number;
    failed: number;
    notScorable: number;
    unknown: number;
  }) => {
    const data = {
      totalSessions: health.scored + health.failed + health.notScorable + health.unknown,
      overallAvg: 6.5,
      scoringHealth: health,
      scoreTrend: [],
      byJobTitle: [],
      byCriteria: [],
      byType: [
        { type: 'PHONE', sessions: 0, avg: null },
        { type: 'CHAT', sessions: 1, avg: 6.5 },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) })
      )
    );
  };

  it('renders the scoring-health breakdown from the analytics payload', async () => {
    withData({ scored: 4, failed: 1, notScorable: 2, unknown: 0 });
    render(<AnalyticsPage />);
    expect(await screen.findByText('Scoring Health')).toBeInTheDocument();
    // "Not scorable" appears both as a chip label and in the explanatory prose.
    expect(screen.getAllByText('Not scorable').length).toBeGreaterThan(0);
    // The chip values render (scored=4, failed=1, notScorable=2).
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('warns the manager when sessions failed to score', async () => {
    withData({ scored: 3, failed: 2, notScorable: 0, unknown: 0 });
    render(<AnalyticsPage />);
    expect(
      await screen.findByText(/2 sessions could not be scored/i)
    ).toBeInTheDocument();
  });

  it('omits the failure warning when nothing failed', async () => {
    withData({ scored: 5, failed: 0, notScorable: 1, unknown: 0 });
    render(<AnalyticsPage />);
    await screen.findByText('Scoring Health');
    await waitFor(() =>
      expect(screen.queryByText(/could not be scored/i)).not.toBeInTheDocument()
    );
  });
});
