/**
 * Behavioral (composer state-machine) tests for the CHAT modality UI
 * (src/components/ChatInterface.tsx — the base text tier).
 *
 * The existing `chat-interface-a11y.test.tsx` locks only the *accessibility*
 * contract (the single sr-only announcer + the role="log" scrollback). The
 * component's actual interaction loop — the trainee types a reply, sends it,
 * and the composer clears/locks while the simulated customer responds — had no
 * behavioral coverage. This file closes that half of the P2-8 gap (#16 —
 * "VoiceChatInterface + ChatInterface behavioral coverage").
 *
 * Deterministic: ChatInterface is a pure presentational client component — no
 * auth, no DB, no network. `sendMessage`/`endConversation` are injected
 * `vi.fn()`s, so every case renders identically each run.
 *
 * Each case is proof-of-rejection (Standing Law 1): the assertion is a specific
 * composer transition the component performs (send-and-clear, Enter-submits vs
 * Shift+Enter-newlines, the whitespace guard, the sending lockout), so it fails
 * against a component that omits that behavior.
 *
 * Environment: happy-dom
 * Run:  npx vitest tests/ui/chat-interface-behavior.test.tsx
 */
// @vitest-environment happy-dom

/// <reference types="@testing-library/jest-dom" />
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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

const composer = () =>
  screen.getByPlaceholderText(/Type your response/i) as HTMLTextAreaElement;
const sendBtn = () => screen.getByRole('button', { name: 'Send' });
const endBtn = () => screen.getByRole('button', { name: 'End Session' });

beforeEach(() => {
  // happy-dom lacks scrollIntoView; the transcript auto-scrolls on mount.
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.restoreAllMocks());

describe('ChatInterface — composer gating', () => {
  it('renders the scenario + job title and disables Send until non-whitespace input', async () => {
    render(<ChatInterface {...baseProps()} />);
    expect(screen.getByRole('heading', { name: 'Refund dispute' })).toBeInTheDocument();
    expect(screen.getByText('Support Rep')).toBeInTheDocument();

    expect(sendBtn()).toBeDisabled();

    const user = userEvent.setup();
    await user.type(composer(), '   '); // whitespace only
    expect(sendBtn()).toBeDisabled();

    await user.type(composer(), 'hello');
    expect(sendBtn()).toBeEnabled();
  });

  it('shows the "Starting conversation…" empty state before any message arrives', () => {
    render(<ChatInterface {...baseProps()} />);
    expect(screen.getByText(/Starting conversation/i)).toBeInTheDocument();
  });
});

describe('ChatInterface — send', () => {
  it('sends the typed text via sendMessage and clears the composer', async () => {
    const props = baseProps();
    const user = userEvent.setup();
    render(<ChatInterface {...props} />);

    await user.type(composer(), 'I understand your frustration.');
    await user.click(sendBtn());

    expect(props.sendMessage).toHaveBeenCalledTimes(1);
    expect(props.sendMessage).toHaveBeenCalledWith('I understand your frustration.');
    // Composer is cleared for the next turn.
    await waitFor(() => expect(composer()).toHaveValue(''));
  });

  it('submits on Enter but inserts a newline (no send) on Shift+Enter', async () => {
    const props = baseProps();
    const user = userEvent.setup();
    render(<ChatInterface {...props} />);

    // Shift+Enter must NOT submit.
    await user.type(composer(), 'line one{Shift>}{Enter}{/Shift}');
    expect(props.sendMessage).not.toHaveBeenCalled();

    // A bare Enter submits the accumulated content.
    await user.type(composer(), 'line two{Enter}');
    expect(props.sendMessage).toHaveBeenCalledTimes(1);
    expect(String((props.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0])).toContain('line one');
    expect(String((props.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0])).toContain('line two');
  });

  it('does not send whitespace-only input on Enter', async () => {
    const props = baseProps();
    const user = userEvent.setup();
    render(<ChatInterface {...props} />);

    await user.type(composer(), '   {Enter}');
    expect(props.sendMessage).not.toHaveBeenCalled();
  });
});

describe('ChatInterface — sending lockout', () => {
  it('disables the composer, Send, and End Session while a reply is in flight', () => {
    render(
      <ChatInterface
        {...baseProps({ sending: true, messages: [customerMsg('c1', 'I want a refund.')] })}
      />
    );
    expect(composer()).toBeDisabled();
    expect(sendBtn()).toBeDisabled();
    expect(endBtn()).toBeDisabled();
  });

  it('renders the streaming reply text as it arrives', () => {
    render(
      <ChatInterface
        {...baseProps({ sending: true, streamingText: 'Let me pull up your order' })}
      />
    );
    expect(screen.getByText('Let me pull up your order')).toBeInTheDocument();
  });

  it('surfaces an error message from the hook', () => {
    render(<ChatInterface {...baseProps({ error: 'Scoring engine unavailable' })} />);
    expect(screen.getByText('Scoring engine unavailable')).toBeInTheDocument();
  });
});

describe('ChatInterface — end session', () => {
  it('calls endConversation when End Session is clicked', async () => {
    const props = baseProps();
    const user = userEvent.setup();
    render(<ChatInterface {...props} />);

    await user.click(endBtn());
    expect(props.endConversation).toHaveBeenCalledTimes(1);
  });
});
