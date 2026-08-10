/**
 * UI tests for the streaming-chat accessibility contract
 * (src/components/ChatInterface.tsx — the flagship text modality).
 *
 * The core loop is a screen-reader user hearing the SIMULATED CUSTOMER's
 * replies. Before this slice the whole scrollback carried aria-live="polite",
 * so every streamed token re-announced the growing reply (chattery, broken)
 * and the trainee's own messages were read back to them. The fix routes ALL
 * assistive-tech speech through one dedicated visually-hidden polite region and
 * demotes the scrollback to a plain role="log".
 *
 * These tests lock that contract (each is proof-of-rejection — it fails against
 * the pre-slice component):
 *   - exactly one aria-live region exists, and it is the sr-only announcer
 *   - the scrollback is role="log" and is NOT itself a live region
 *   - a completed CUSTOMER reply is announced, verbatim, via the announcer
 *   - the "replying" pending state is announced before the first token
 *
 * Deterministic: ChatInterface is a pure presentational client component — no
 * auth, no DB, no network (sendMessage/endConversation are injected) — so it
 * renders identically every run.
 *
 * Environment: happy-dom
 * Run:  npx vitest tests/ui/chat-interface-a11y.test.tsx
 */
// @vitest-environment happy-dom

/// <reference types="@testing-library/jest-dom" />
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ChatInterface, {
  type ChatInterfaceProps,
} from '@/components/ChatInterface';
import type { Message } from '@/types';

function baseProps(overrides: Partial<ChatInterfaceProps> = {}): ChatInterfaceProps {
  return {
    // Only scenario.name + jobTitle.name are read by the component.
    session: {
      scenario: { name: 'Refund dispute' },
      jobTitle: { name: 'Support Rep' },
    } as unknown as ChatInterfaceProps['session'],
    messages: [],
    streamingText: '',
    sending: false,
    error: null,
    lastTiming: null,
    sendMessage: vi.fn().mockResolvedValue(undefined),
    endConversation: vi.fn(),
    ...overrides,
  };
}

const customerMsg = (id: string, content: string): Message => ({
  id,
  role: 'CUSTOMER',
  content,
  timestamp: '2026-01-01T00:00:00.000Z',
});
const agentMsg = (id: string, content: string): Message => ({
  id,
  role: 'AGENT',
  content,
  timestamp: '2026-01-01T00:00:00.000Z',
});

describe('ChatInterface — streaming-chat accessibility', () => {
  it('exposes exactly one aria-live region, and it is the sr-only announcer', () => {
    const { container } = render(<ChatInterface {...baseProps()} />);
    const liveRegions = container.querySelectorAll('[aria-live]');
    expect(liveRegions).toHaveLength(1);
    const announcer = liveRegions[0];
    expect(announcer).toHaveAttribute('aria-live', 'polite');
    expect(announcer).toHaveAttribute('role', 'status');
    // Visually hidden — announced, never seen.
    expect(announcer).toHaveClass('sr-only');
  });

  it('demotes the message scrollback to role="log" with no live region', () => {
    const { container } = render(<ChatInterface {...baseProps()} />);
    const log = container.querySelector('[role="log"]');
    expect(log).not.toBeNull();
    // Proof-of-rejection: pre-slice this element carried aria-live="polite".
    expect(log).not.toHaveAttribute('aria-live');
  });

  it('announces a completed simulated-customer reply verbatim', () => {
    render(
      <ChatInterface
        {...baseProps({
          messages: [
            agentMsg('a1', 'Hello, how can I help?'),
            customerMsg('c1', 'My order never arrived and I want a refund.'),
          ],
        })}
      />
    );
    const announcer = screen.getByRole('status');
    expect(announcer).toHaveTextContent(
      'Simulated customer said: My order never arrived and I want a refund.'
    );
  });

  it('does NOT read the trainee\'s own latest message back to them', () => {
    render(
      <ChatInterface
        {...baseProps({
          messages: [
            customerMsg('c1', 'I need help with a refund.'),
            agentMsg('a1', 'Sure, let me pull up your order.'),
          ],
        })}
      />
    );
    const announcer = screen.getByRole('status');
    // The announcer tracks the customer line, not the trainee's reply.
    expect(announcer).toHaveTextContent('Simulated customer said: I need help with a refund.');
    expect(announcer).not.toHaveTextContent('let me pull up your order');
  });

  it('announces the pending "replying" state before the first token streams', () => {
    render(<ChatInterface {...baseProps({ sending: true, streamingText: '' })} />);
    const announcer = screen.getByRole('status');
    expect(announcer).toHaveTextContent('Simulated customer is replying');
  });
});
