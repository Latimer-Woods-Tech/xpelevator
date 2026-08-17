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
import { render, screen, waitFor, within } from '@testing-library/react';

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

// The page now renders the shared TopNav, which reads the session.
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { name: 'Manager' } }, status: 'authenticated' }),
  signOut: vi.fn(),
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

  it('shows a content skeleton (not bare text) while analytics loads (P3a-8)', () => {
    render(<AnalyticsPage />);
    // Proof-of-rejection: revert to the old `<p>Loading analytics…</p>` and
    // this fails — a bare paragraph is not an announced status region.
    expect(
      screen.getByRole('status', { name: /loading analytics/i })
    ).toBeInTheDocument();
    // Real dashboard data has not rendered yet.
    expect(screen.queryByText('Total Sessions')).not.toBeInTheDocument();
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

describe('AnalyticsPage — score-trend chart has a text alternative (P3a-9, WCAG 1.1.1 / 1.4.1)', () => {
  const withTrend = (scoreTrend: { date: string; avg: number; count: number }[]) => {
    const data = {
      totalSessions: 3,
      overallAvg: 6.5,
      scoringHealth: { scored: 3, failed: 0, notScorable: 0, unknown: 0 },
      scoreTrend,
      byJobTitle: [],
      byCriteria: [],
      byType: [{ type: 'CHAT', sessions: 3, avg: 6.5 }],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) })
      )
    );
  };

  it('exposes the daily series as an accessible data table (not just coloured bars)', async () => {
    withTrend([
      { date: '2026-08-15', avg: 8.4, count: 2 },
      { date: '2026-08-16', avg: 5.0, count: 1 },
    ]);
    render(<AnalyticsPage />);
    await screen.findByText('Score Trend (last 60 days)');
    // Proof-of-rejection: the bars are `aria-hidden`, so the ONLY thing a
    // screen reader can read is this table. Remove it (revert to bars-only) and
    // this query finds nothing — the chart becomes silent to assistive tech.
    const table = screen.getByRole('table', { name: /daily average score/i });
    expect(table).toBeInTheDocument();
    // The real numbers are present as text, per row.
    expect(within(table).getByRole('row', { name: /2026-08-15/ })).toBeInTheDocument();
    expect(within(table).getByText('8.4')).toBeInTheDocument();
    expect(within(table).getByText('5.0')).toBeInTheDocument();
  });

  it('names the band as words so status is not conveyed by colour alone', async () => {
    withTrend([
      { date: '2026-08-15', avg: 8.4, count: 2 }, // Strong
      { date: '2026-08-16', avg: 5.0, count: 1 }, // Fair
    ]);
    render(<AnalyticsPage />);
    const table = await screen.findByRole('table', { name: /daily average score/i });
    expect(within(table).getByText('Strong')).toBeInTheDocument();
    expect(within(table).getByText('Fair')).toBeInTheDocument();
  });

  it('renders no trend table when there is no trend data', async () => {
    withTrend([]);
    render(<AnalyticsPage />);
    // Scope to the Score Trend section — "No data yet." is also the empty state
    // of other breakdown panels, so assert the empty state within this section.
    const heading = await screen.findByRole('heading', { name: /score trend/i });
    const section = heading.parentElement as HTMLElement;
    expect(screen.queryByRole('table', { name: /daily average score/i })).not.toBeInTheDocument();
    expect(within(section).getByText('No data yet.')).toBeInTheDocument();
  });
});

describe('AnalyticsPage — per-modality highlight tiles reconcile with total', () => {
  /**
   * Mounts the page with a full three-modality breakdown. The top-of-page
   * highlight tiles must surface EVERY modality (PHONE, CHAT, and VOICE) so a
   * manager's per-modality counts reconcile with Total Sessions. VOICE was
   * previously dropped from the highlights, so its sessions vanished from the
   * top of the page and the modality tiles undercounted the total.
   */
  const withThreeModalities = () => {
    const data = {
      totalSessions: 6,
      overallAvg: 6.5,
      scoringHealth: { scored: 6, failed: 0, notScorable: 0, unknown: 0 },
      scoreTrend: [],
      byJobTitle: [],
      byCriteria: [],
      byType: [
        { type: 'PHONE', sessions: 2, avg: 7 },
        { type: 'CHAT', sessions: 1, avg: 6 },
        { type: 'VOICE', sessions: 3, avg: 6.5 },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) })
      )
    );
  };

  /** Read the value rendered in the StatCard whose label matches `label`. */
  const tileValue = (label: string): string => {
    const card = screen.getByText(label).parentElement as HTMLElement;
    return within(card).getByText(/^[\d.]+( \/ 10)?$/).textContent ?? '';
  };

  it('renders a Voice Sessions highlight tile with the correct count', async () => {
    withThreeModalities();
    render(<AnalyticsPage />);
    // Fails before the fix — the highlights had no Voice tile at all.
    expect(await screen.findByText('Voice Sessions')).toBeInTheDocument();
    expect(tileValue('Voice Sessions')).toBe('3');
  });

  it('per-modality highlight counts sum to Total Sessions', async () => {
    withThreeModalities();
    render(<AnalyticsPage />);
    await screen.findByText('Voice Sessions');
    const phone = Number(tileValue('Phone Sessions'));
    const chat = Number(tileValue('Chat Sessions'));
    const voice = Number(tileValue('Voice Sessions'));
    const total = Number(tileValue('Total Sessions'));
    // The reconciliation invariant the dropped-VOICE bug broke.
    expect(phone + chat + voice).toBe(total);
    expect(total).toBe(6);
  });
});
