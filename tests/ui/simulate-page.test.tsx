/**
 * UI component tests for /simulate page.
 *
 * Root causes covered:
 *   1. Uses useSession() — if auth misconfigured, this call fails and the page
 *      shows nothing, masking the jobs 500 underneath
 *   2. fetch('/api/jobs') 500 — renders error state and retry button
 *   3. Empty job list — shows empty state, not a broken UI
 *   4. Successful load — renders job cards correctly
 *   5. Scenario selection — selecting a job shows its scenarios
 *   6. Start simulation — POSTs to /api/simulations and navigates on success
 *
 * Environment: jsdom (vitest environmentMatchGlobs)
 * Run:  npx vitest tests/ui/simulate-page.test.tsx
 */

/// <reference types="@testing-library/jest-dom" />
import React from 'react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ── Mock next-auth/react to avoid real JWT initialisation ─────────────────────
const mockUseSession = vi.fn();
vi.mock('next-auth/react', () => ({
  useSession: mockUseSession,
  SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ── Mock next/navigation ──────────────────────────────────────────────────────
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

// ── Mock next/link ────────────────────────────────────────────────────────────
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    [k: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// ─────────────────────────────────────────────────────────────────────────────

const SAMPLE_JOBS = [
  {
    id: 'job-l1',
    name: 'Help Desk Technician',
    description: 'L1 support — first point of contact',
    scenarios: [
      { id: 'sc-001', name: 'Password Reset', description: null, type: 'CHAT' },
      { id: 'sc-002', name: 'Outlook Not Opening', description: null, type: 'PHONE' },
    ],
  },
  {
    id: 'job-l2',
    name: 'Desktop Support Specialist',
    description: 'L2 escalated support',
    scenarios: [
      { id: 'sc-003', name: 'Slow PC Investigation', description: null, type: 'CHAT' },
    ],
  },
];

function mockSession(name = 'Alex', id = 'user-123') {
  mockUseSession.mockReturnValue({
    data: { user: { id, name, email: `${name.toLowerCase()}@example.com` } },
    status: 'authenticated',
  });
}

function mockFetch(overrides: { jobs?: unknown; jobsStatus?: number; simStatus?: number } = {}) {
  global.fetch = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
    const urlStr = url.toString();
    if (urlStr.includes('/api/jobs')) {
      const status = overrides.jobsStatus ?? 200;
      const body =
        status === 200 ? JSON.stringify(overrides.jobs ?? SAMPLE_JOBS) : JSON.stringify({ error: `Server error ${status}` });
      return new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
    }
    if (urlStr.includes('/api/simulations')) {
      const status = overrides.simStatus ?? 201;
      const body = JSON.stringify({ id: 'session-abc', jobTitleId: 'job-l1', scenarioId: 'sc-001', userId: 'user-123', type: 'CHAT' });
      return new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 404 });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Lazy import so mocks are established before the module loads
// ─────────────────────────────────────────────────────────────────────────────

let SimulatePage: React.ComponentType;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import('@/app/simulate/page');
  SimulatePage = mod.default;
});

afterEach(() => {
  vi.restoreAllMocks();
  mockPush.mockReset();
  vi.resetModules();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('SimulatePage — auth states', () => {
  it('shows guest display when session has no user', async () => {
    mockUseSession.mockReturnValue({ data: null, status: 'unauthenticated' });
    mockFetch();
    render(<SimulatePage />);
    await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
    expect(screen.getByText('Guest')).toBeInTheDocument();
  });

  it('shows authenticated user display name', async () => {
    mockSession('Sandra Mitchell');
    mockFetch();
    render(<SimulatePage />);
    await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
    expect(screen.getByText(/Sandra Mitchell/i)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('SimulatePage — job loading', () => {
  beforeEach(() => mockSession());

  it('renders a loading state initially', () => {
    // fetch resolves slowly — keep the promise pending
    global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof globalThis.fetch;
    render(<SimulatePage />);
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
  });

  it('renders job cards when /api/jobs returns 200', async () => {
    mockFetch();
    render(<SimulatePage />);
    await waitFor(() => expect(screen.getByText('Help Desk Technician')).toBeInTheDocument());
    expect(screen.getByText('Desktop Support Specialist')).toBeInTheDocument();
  });

  it('renders empty state when job list is empty', async () => {
    mockFetch({ jobs: [] });
    render(<SimulatePage />);
    await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
    // Should not crash and should show no job cards
    expect(screen.queryByText('Help Desk Technician')).not.toBeInTheDocument();
  });

  it('shows error message and retry button when /api/jobs returns 500', async () => {
    mockFetch({ jobsStatus: 500 });
    render(<SimulatePage />);
    await waitFor(() => expect(screen.getByText(/Server error 500/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('retries the jobs fetch when retry button clicked', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'fail' }), { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(SAMPLE_JOBS), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    global.fetch = fetchMock;
    render(<SimulatePage />);
    const retryBtn = await screen.findByRole('button', { name: /retry/i });
    await userEvent.click(retryBtn);
    await waitFor(() => expect(screen.getByText('Help Desk Technician')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('SimulatePage — job and scenario selection', () => {
  beforeEach(() => mockSession());

  it('clicking a job card selects it and shows its scenarios', async () => {
    mockFetch();
    render(<SimulatePage />);
    const jobCard = await screen.findByText('Help Desk Technician');
    await userEvent.click(jobCard);
    await waitFor(() =>
      expect(screen.getByText('Password Reset')).toBeInTheDocument()
    );
    expect(screen.getByText('Outlook Not Opening')).toBeInTheDocument();
  });

  it('shows scenario type badge (CHAT / PHONE)', async () => {
    mockFetch();
    render(<SimulatePage />);
    await userEvent.click(await screen.findByText('Help Desk Technician'));
    await waitFor(() => expect(screen.getByText(/CHAT/i)).toBeInTheDocument());
    expect(screen.getByText(/PHONE/i)).toBeInTheDocument();
  });

  it('start button triggers POST to /api/simulations', async () => {
    mockFetch();
    render(<SimulatePage />);
    await userEvent.click(await screen.findByText('Help Desk Technician'));
    const startBtn = await screen.findByRole('button', { name: /start.*simulation|start/i });
    await userEvent.click(startBtn);
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/simulations'),
        expect.objectContaining({ method: 'POST' })
      )
    );
  });

  it('navigates to /simulate/[sessionId] after successful start', async () => {
    mockFetch({ simStatus: 201 });
    render(<SimulatePage />);
    await userEvent.click(await screen.findByText('Help Desk Technician'));
    const startBtn = await screen.findByRole('button', { name: /start.*simulation|start/i });
    await userEvent.click(startBtn);
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('/simulate/session-abc'))
    );
  });

  it('shows error when start simulation fails', async () => {
    mockFetch({ simStatus: 500 });
    render(<SimulatePage />);
    await userEvent.click(await screen.findByText('Help Desk Technician'));
    const startBtn = await screen.findByRole('button', { name: /start.*simulation|start/i });
    await userEvent.click(startBtn);
    await waitFor(() =>
      expect(screen.getByText(/failed|error/i)).toBeInTheDocument()
    );
  });
});
