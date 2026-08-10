/**
 * UI test for the admin "Scenarios" surface (src/app/admin/page.tsx,
 * ScenariosTab). Each scenario row renders a modality badge whose colour must
 * be distinct per modality — VOICE is a first-class SimulationType and must not
 * be grouped with PHONE (the two-way `CHAT ? blue : purple` bug painted every
 * VOICE badge purple, the PHONE colour). Mirrors the three-way MODALITY_GLYPH
 * consistency work on /sessions + /simulate.
 *
 * Environment: happy-dom
 */
// @vitest-environment happy-dom

/// <reference types="@testing-library/jest-dom" />
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

async function renderAdmin() {
  vi.resetModules();
  const { default: Page } = await import('@/app/admin/page');
  const { FeedbackProvider } = await import('@/components/ui/feedback');
  return render(
    <FeedbackProvider>
      <Page />
    </FeedbackProvider>
  );
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const JOBS = [{ id: 'job-1', name: 'Support Agent', description: null }];

// One scenario per modality so each badge is uniquely addressable by its label.
const SCENARIOS = [
  { id: 's-chat', name: 'Chat scenario', description: null, type: 'CHAT', jobTitleId: 'job-1' },
  { id: 's-phone', name: 'Phone scenario', description: null, type: 'PHONE', jobTitleId: 'job-1' },
  { id: 's-voice', name: 'Voice scenario', description: null, type: 'VOICE', jobTitleId: 'job-1' },
];

function stubFetch() {
  const fetchSpy = vi.fn((url: string) => {
    if (url === '/api/scenarios') return Promise.resolve(jsonResponse(SCENARIOS));
    if (url === '/api/jobs') return Promise.resolve(jsonResponse(JOBS));
    if (url === '/api/criteria') return Promise.resolve(jsonResponse([]));
    return Promise.resolve(jsonResponse({}));
  });
  // @ts-expect-error – install the stub on the test global
  globalThis.fetch = fetchSpy;
  return fetchSpy;
}

async function openScenariosTab() {
  await renderAdmin();
  fireEvent.click(screen.getByRole('button', { name: 'Scenarios' }));
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
  globalThis.fetch = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
});

describe('Admin Scenarios — modality badge colour', () => {
  it('paints each modality badge a distinct colour (VOICE is not grouped with PHONE)', async () => {
    stubFetch();
    await openScenariosTab();

    await waitFor(() => expect(screen.getByText('CHAT')).toBeInTheDocument());
    const chatBadge = screen.getByText('CHAT');
    const phoneBadge = screen.getByText('PHONE');
    const voiceBadge = screen.getByText('VOICE');

    // Existing colours preserved.
    expect(chatBadge.className).toMatch(/blue/);
    expect(phoneBadge.className).toMatch(/purple/);

    // The fix: VOICE has its own colour and is NOT painted the PHONE purple.
    // Pre-fix (`CHAT ? blue : purple`), this badge was purple → this fails.
    expect(voiceBadge.className).toMatch(/emerald/);
    expect(voiceBadge.className).not.toMatch(/purple/);

    // All three modality colours are mutually distinct.
    const colourOf = (el: HTMLElement) =>
      (el.className.match(/blue|purple|emerald/) || [])[0];
    const colours = [chatBadge, phoneBadge, voiceBadge].map(colourOf);
    expect(new Set(colours).size).toBe(3);
  });
});

describe('Admin Scenarios — Duplicate action', () => {
  it('POSTs to the per-scenario duplicate endpoint and refreshes the list', async () => {
    const fetchSpy = stubFetch();
    await openScenariosTab();

    await waitFor(() => expect(screen.getByText('Chat scenario')).toBeInTheDocument());

    // One Duplicate button per scenario row; the first row is the CHAT scenario.
    const dupButtons = screen.getAllByRole('button', { name: 'Duplicate' });
    expect(dupButtons.length).toBe(SCENARIOS.length);

    fetchSpy.mockClear();
    fireEvent.click(dupButtons[0]);

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith('/api/scenarios/s-chat/duplicate', { method: 'POST' })
    );
    // The list is re-fetched after a successful duplicate.
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('/api/scenarios'));
  });
});
