/**
 * UI tests for the decorative-emoji accessibility contract (P3a-9 residue).
 *
 * Standalone glyphs used purely as decoration — the ⚠️ on the crash screen, the
 * 🔴 on the Hang-Up control, the 🟡/🟢 call-status dots — carry meaning that the
 * adjacent visible text already states. Before this slice they were live in the
 * accessibility tree, so a screen reader read "warning sign Something went
 * wrong" and "large red circle Hang Up" — the glyph name is noise the sighted
 * user never hears. The fix marks each decorative glyph `aria-hidden="true"` so
 * assistive tech announces only the real label.
 *
 * These tests lock that contract (each is proof-of-rejection — it fails against
 * the pre-slice components, where the glyph had no aria-hidden wrapper):
 *   - the crash-screen warning glyph is hidden from AT
 *   - the Hang-Up control's accessible name is exactly "Hang Up" (no glyph)
 *   - the live-call status glyph is hidden, its text still announced
 *
 * Deterministic: both components are pure presentational client components; the
 * phone-call seams (fetch) are mocked, so they render identically every run.
 *
 * Environment: happy-dom
 * Run:  npx vitest tests/ui/decorative-emoji-a11y.test.tsx
 */
// @vitest-environment happy-dom

/// <reference types="@testing-library/jest-dom" />
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// error.tsx renders a next/link "Go Home" — mock it to a plain anchor so no
// router context is needed.
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

import ErrorBoundary from '@/app/error';
import PhoneInterface, {
  type PhoneInterfaceProps,
} from '@/components/PhoneInterface';

describe('crash screen (error.tsx) — decorative warning glyph', () => {
  it('hides the ⚠️ glyph from assistive tech', () => {
    render(<ErrorBoundary error={new Error('boom')} reset={vi.fn()} />);
    // Proof-of-rejection: pre-slice this element had no aria-hidden.
    const glyph = screen.getByText('⚠️');
    expect(glyph).toHaveAttribute('aria-hidden', 'true');
    // The real message is still reachable.
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
  });
});

describe('PhoneInterface — decorative call-control glyphs', () => {
  beforeEach(() => {
    // happy-dom does not implement scrollIntoView; the connected view auto-scrolls.
    Element.prototype.scrollIntoView = vi.fn();
    // Both call seams: POST /api/telnyx/call (connect) and the SSE transcript
    // stream. `body: null` makes startCallStreaming return before any read loop.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, body: null, json: async () => ({}) })) as unknown as typeof fetch
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function baseProps(): PhoneInterfaceProps {
    return {
      session: {
        scenario: { name: 'Refund dispute' },
        jobTitle: { name: 'Support Rep' },
      } as unknown as PhoneInterfaceProps['session'],
      messages: [],
      sendMessage: vi.fn().mockResolvedValue(undefined),
      setSession: vi.fn(),
      sessionId: 'sess-1',
      onEnded: vi.fn(),
    };
  }

  async function reachConnectedState() {
    const user = userEvent.setup();
    render(<PhoneInterface {...baseProps()} />);
    await user.type(screen.getByPlaceholderText('+12125550123'), '+12125550123');
    await user.click(screen.getByRole('button', { name: /start call/i }));
    // The sticky hang-up bar only renders once callStatus === 'connected'.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Hang Up' })).toBeInTheDocument()
    );
  }

  it('exposes the Hang-Up control with a glyph-free accessible name', async () => {
    await reachConnectedState();
    // Proof-of-rejection: pre-slice the name was "🔴 Hang Up".
    const hangUp = screen.getByRole('button', { name: 'Hang Up' });
    expect(hangUp).toBeInTheDocument();
    const glyph = screen.getByText('🔴');
    expect(glyph).toHaveAttribute('aria-hidden', 'true');
  });

  it('hides the live-call status glyph but still announces its text', async () => {
    await reachConnectedState();
    // messages is empty ⇒ lastRole null ⇒ "Your turn to speak" (🟢).
    expect(screen.getByText('Your turn to speak')).toBeInTheDocument();
    const glyph = screen.getByText('🟢');
    expect(glyph).toHaveAttribute('aria-hidden', 'true');
  });
});
