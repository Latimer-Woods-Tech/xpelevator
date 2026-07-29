/**
 * UI component tests for /sessions (the trainee/manager session list).
 *
 * Root cause covered:
 *   The list icon was a two-way `type === 'PHONE' ? PhoneIcon : ChatIcon`
 *   split, so a VOICE session — a first-class, admin-selectable modality —
 *   rendered with the CHAT bubble, mislabelling the modality on the list a
 *   manager reviews. This is the session-list half of the voice-consistency
 *   sweep (analytics tiles were the other half, runs 58/59). Each modality
 *   now carries its own labelled glyph (role="img" + aria-label).
 *
 * Environment: happy-dom
 * Run:  npx vitest tests/ui/sessions-page.test.tsx
 */
// @vitest-environment happy-dom

/// <reference types="@testing-library/jest-dom" />
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const mockUseSession = vi.hoisted(() => vi.fn());

vi.mock('next-auth/react', () => ({
  useSession: mockUseSession,
  signOut: vi.fn(),
  SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

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

// One completed session per modality, so the list must render three distinct,
// correctly-labelled glyphs.
const SAMPLE_SESSIONS = [
  {
    id: 's-chat',
    status: 'COMPLETED',
    type: 'CHAT',
    startedAt: null,
    endedAt: null,
    createdAt: '2026-07-20T10:00:00Z',
    messages: [],
    scenario: { name: 'Password Reset', description: null, type: 'CHAT' },
    jobTitle: { name: 'Help Desk Technician' },
    scores: [{ id: 'c1', score: 7, feedback: null, criteria: { name: 'Empathy' } }],
  },
  {
    id: 's-phone',
    status: 'COMPLETED',
    type: 'PHONE',
    startedAt: null,
    endedAt: null,
    createdAt: '2026-07-20T11:00:00Z',
    messages: [],
    scenario: { name: 'Billing Dispute', description: null, type: 'PHONE' },
    jobTitle: { name: 'Support Specialist' },
    scores: [{ id: 'p1', score: 8, feedback: null, criteria: { name: 'Clarity' } }],
  },
  {
    id: 's-voice',
    status: 'COMPLETED',
    type: 'VOICE',
    startedAt: null,
    endedAt: null,
    createdAt: '2026-07-20T12:00:00Z',
    messages: [],
    scenario: { name: 'Angry Caller De-escalation', description: null, type: 'VOICE' },
    jobTitle: { name: 'Support Specialist' },
    scores: [{ id: 'v1', score: 6, feedback: null, criteria: { name: 'De-escalation' } }],
  },
];

function mockSession(name = 'Alex', id = 'user-123') {
  mockUseSession.mockReturnValue({
    data: { user: { id, name, email: `${name.toLowerCase()}@example.com` } },
    status: 'authenticated',
  });
}

function mockFetch(sessions: unknown = SAMPLE_SESSIONS, status = 200) {
  global.fetch = vi.fn(async (url: string | URL | Request) => {
    const urlStr = url.toString();
    if (urlStr.includes('/api/simulations')) {
      const body = status === 200 ? JSON.stringify(sessions) : JSON.stringify({ error: `Server error ${status}` });
      return new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 404 });
  }) as unknown as typeof globalThis.fetch;
}

import SessionsPage from '@/app/sessions/page';

beforeEach(() => mockSession());
afterEach(() => vi.restoreAllMocks());

describe('SessionsPage — modality glyph consistency', () => {
  it('labels each session with its own modality glyph (VOICE ≠ chat icon)', async () => {
    mockFetch();
    render(<SessionsPage />);
    await waitFor(() =>
      expect(screen.getByText('Angry Caller De-escalation')).toBeInTheDocument()
    );

    // Proof-of-rejection: pre-fix, the VOICE row rendered a decorative
    // (aria-hidden, unlabelled) ChatIcon, so there was no img named
    // "Voice session" — this assertion fails on the two-way revert.
    expect(screen.getByRole('img', { name: 'Voice session' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Phone session' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Chat session' })).toBeInTheDocument();
  });

  it('renders every session, one card per modality', async () => {
    mockFetch();
    render(<SessionsPage />);
    await waitFor(() => expect(screen.getByText('Password Reset')).toBeInTheDocument());
    expect(screen.getByText('Billing Dispute')).toBeInTheDocument();
    expect(screen.getByText('Angry Caller De-escalation')).toBeInTheDocument();
  });
});
