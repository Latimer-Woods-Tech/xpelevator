/**
 * Behavioral (state-machine) tests for the PHONE modality UI
 * (src/components/PhoneInterface.tsx — the top paid tier).
 *
 * The phone path is the product's differentiating, highest-value modality, and
 * both of its SERVER routes are already under the deterministic CI gate
 * (`api/telnyx/call` + `api/telnyx/webhook`, P2-7/P2-8). Its CLIENT was the
 * remaining untested half: the existing `decorative-emoji-a11y.test.tsx` renders
 * this component but stubs `fetch` with `body: null` so `startCallStreaming`
 * returns before any read loop — it asserts only aria-hidden glyphs, never the
 * call state machine. This file closes that gap (#16, P2-8 — "the interface
 * components — still untested").
 *
 * Every seam is mocked and deterministic — no live Neon/Groq/Telnyx:
 *   - `global.fetch` is a router keyed on (url, method): POST /api/telnyx/call
 *     (connect), GET /api/chat?…&stream=true (the live-transcript SSE, whose
 *     `.body` is a real `ReadableStream<Uint8Array>`), and GET /api/chat?…
 *     (the post-hangup session re-fetch).
 *   - `sendMessage` / `setSession` / `onEnded` are injected `vi.fn()`s (the
 *     component owns its own fetches but delegates these to the hook).
 *
 * Each case is proof-of-rejection: the assertion is a specific state transition
 * the component performs, so it fails against a component that doesn't (Standing
 * Law 1). Complements — does not duplicate — the a11y contract test.
 *
 * Environment: happy-dom
 * Run:  npx vitest tests/ui/phone-interface.test.tsx
 */
// @vitest-environment happy-dom

/// <reference types="@testing-library/jest-dom" />
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import PhoneInterface, {
  type PhoneInterfaceProps,
} from '@/components/PhoneInterface';
import type { Message } from '@/types';

// ── Test data ────────────────────────────────────────────────────────────────
const SESSION_ID = 'sess-phone-1';
const PHONE = '+12125550123';

function baseProps(overrides: Partial<PhoneInterfaceProps> = {}): PhoneInterfaceProps {
  return {
    // The component only reads session?.scenario.name + session?.jobTitle.name.
    session: {
      scenario: { name: 'Refund dispute' },
      jobTitle: { name: 'Support Rep' },
    } as unknown as PhoneInterfaceProps['session'],
    messages: [],
    sendMessage: vi.fn().mockResolvedValue(undefined),
    setSession: vi.fn(),
    sessionId: SESSION_ID,
    onEnded: vi.fn(),
    ...overrides,
  };
}

const msg = (id: string, role: Message['role'], content: string): Message => ({
  id,
  role,
  content,
  timestamp: '2026-01-01T00:00:00.000Z',
});

// ── fetch router + SSE builders ──────────────────────────────────────────────
type FetchResponse = {
  ok: boolean;
  body?: ReadableStream<Uint8Array> | null;
  json: () => Promise<unknown>;
};

function jsonResponse(obj: unknown, ok = true): FetchResponse {
  return { ok, body: null, json: async () => obj };
}

/** An SSE response whose `.body` streams the given `data:` frames as UTF-8. */
function sseResponse(frames: string[]): FetchResponse {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(enc.encode(f));
      controller.close();
    },
  });
  return { ok: true, body, json: async () => ({}) };
}

/** One SSE `data:` frame in the shape PhoneInterface's line-parser reads. */
function frame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/**
 * Install a fetch mock routing by (url, method):
 *   - POST /api/telnyx/call        → opts.call()      (connect result)
 *   - GET  /api/chat?…&stream=true → opts.stream()     (live-transcript SSE)
 *   - GET  /api/chat?…             → opts.getSession() (post-hangup re-fetch)
 */
function installFetch(opts: {
  call?: () => FetchResponse;
  stream?: () => FetchResponse;
  getSession?: () => FetchResponse;
}) {
  const fn = vi.fn(async (url: string, init?: { method?: string }) => {
    if (init?.method === 'POST') {
      return opts.call ? opts.call() : jsonResponse({ ok: true });
    }
    if (url.includes('stream=true')) {
      return opts.stream ? opts.stream() : jsonResponse({}, true);
    }
    return opts.getSession ? opts.getSession() : jsonResponse({ messages: [] });
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

beforeEach(() => {
  // happy-dom does not implement scrollIntoView; the connected view auto-scrolls.
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** Type a valid number and click Start Call; resolves once connected. */
async function connect(props: PhoneInterfaceProps) {
  const user = userEvent.setup();
  render(<PhoneInterface {...props} />);
  await user.type(screen.getByPlaceholderText(PHONE), PHONE);
  await user.click(screen.getByRole('button', { name: /start call/i }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Hang Up' })).toBeInTheDocument()
  );
  return user;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('PhoneInterface — idle setup', () => {
  it('renders the call setup and disables Start Call until a number is entered', async () => {
    installFetch({});
    render(<PhoneInterface {...baseProps()} />);

    expect(screen.getByRole('heading', { name: 'Ready to Call' })).toBeInTheDocument();
    // Scenario + job title come from the session prop.
    expect(screen.getByText('Refund dispute')).toBeInTheDocument();
    expect(screen.getByText('Support Rep')).toBeInTheDocument();

    const start = screen.getByRole('button', { name: /start call/i });
    expect(start).toBeDisabled();
  });

  it('enables Start Call once a phone number is typed', async () => {
    installFetch({});
    const user = userEvent.setup();
    render(<PhoneInterface {...baseProps()} />);

    const start = screen.getByRole('button', { name: /start call/i });
    expect(start).toBeDisabled();

    await user.type(screen.getByPlaceholderText(PHONE), PHONE);
    expect(start).toBeEnabled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('PhoneInterface — connect', () => {
  it('POSTs the dial with {sessionId,to} and enters the live-call view on success', async () => {
    const fetchFn = installFetch({
      call: () => jsonResponse({ ok: true }),
      stream: () => sseResponse([]), // empty stream: connect, then close
    });
    await connect(baseProps());

    // Live-call view is showing (rendered as "● Live Call").
    expect(screen.getByText(/Live Call/)).toBeInTheDocument();
    // The initial call timer renders 00:00.
    expect(screen.getByText('00:00')).toBeInTheDocument();

    // The dial POST carried the right route + body.
    const post = fetchFn.mock.calls.find(
      ([, init]) => (init as { method?: string } | undefined)?.method === 'POST'
    );
    expect(post).toBeDefined();
    expect(String(post![0])).toContain('/api/telnyx/call');
    const body = JSON.parse(String((post![1] as { body?: string }).body));
    expect(body).toEqual({ sessionId: SESSION_ID, to: PHONE });
  });

  it('surfaces the dial error and stays on the setup screen when the call fails', async () => {
    installFetch({ call: () => jsonResponse({ error: 'No voice seats available' }, false) });
    const user = userEvent.setup();
    render(<PhoneInterface {...baseProps()} />);

    await user.type(screen.getByPlaceholderText(PHONE), PHONE);
    await user.click(screen.getByRole('button', { name: /start call/i }));

    // Error is shown, and we are back in idle (Start Call still present; no Hang Up).
    await waitFor(() =>
      expect(screen.getByText('No voice seats available')).toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: /start call/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hang Up' })).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('PhoneInterface — live transcript (SSE)', () => {
  it('renders customer + agent turns pushed by a transcript frame', async () => {
    installFetch({
      call: () => jsonResponse({ ok: true }),
      stream: () =>
        sseResponse([
          frame({
            type: 'transcript',
            messages: [
              msg('c1', 'CUSTOMER', 'Hi, my invoice is wrong.'),
              msg('a1', 'AGENT', 'Let me take a look at that.'),
            ],
          }),
        ]),
    });
    await connect(baseProps());

    await waitFor(() =>
      expect(screen.getByText('Hi, my invoice is wrong.')).toBeInTheDocument()
    );
    expect(screen.getByText('Let me take a look at that.')).toBeInTheDocument();
  });

  it('shows "Customer responding…" while the last turn is the trainee (agent)', async () => {
    installFetch({
      call: () => jsonResponse({ ok: true }),
      stream: () =>
        sseResponse([
          frame({
            type: 'transcript',
            messages: [msg('a1', 'AGENT', 'How can I help today?')],
          }),
        ]),
    });
    await connect(baseProps());

    // lastRole === 'AGENT' ⇒ customerIsThinking ⇒ "Customer responding…".
    await waitFor(() =>
      expect(screen.getByText('Customer responding…')).toBeInTheDocument()
    );
    expect(screen.queryByText('Your turn to speak')).not.toBeInTheDocument();
  });

  it('finalizes on an "ended" frame: updates the session and calls onEnded', async () => {
    // The `ended` frame drives connected → ended synchronously, so the
    // "connected" view is transient — assert the finalize side effects
    // directly rather than routing through `connect()` (which waits on the
    // now-vanished Hang-Up control).
    const endedSession = {
      status: 'COMPLETED',
      messages: [msg('c1', 'CUSTOMER', 'Thanks, bye.')],
    };
    const props = baseProps();
    installFetch({
      call: () => jsonResponse({ ok: true }),
      stream: () =>
        sseResponse([frame({ type: 'ended', session: endedSession })]),
    });

    const user = userEvent.setup();
    render(<PhoneInterface {...props} />);
    await user.type(screen.getByPlaceholderText(PHONE), PHONE);
    await user.click(screen.getByRole('button', { name: /start call/i }));

    await waitFor(() => expect(props.onEnded).toHaveBeenCalledTimes(1));
    expect(props.setSession).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'COMPLETED' })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('PhoneInterface — hang up', () => {
  it('sends [END], re-fetches the session, and calls onEnded', async () => {
    const finalSession = { status: 'CANCELLED', messages: [] };
    const props = baseProps();
    const fetchFn = installFetch({
      call: () => jsonResponse({ ok: true }),
      stream: () => sseResponse([]),
      getSession: () => jsonResponse(finalSession),
    });
    const user = await connect(props);

    await user.click(screen.getByRole('button', { name: 'Hang Up' }));

    await waitFor(() => expect(props.onEnded).toHaveBeenCalled());
    expect(props.sendMessage).toHaveBeenCalledWith('[END]');
    expect(props.setSession).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'CANCELLED' })
    );
    // The post-hangup re-fetch was a plain (non-stream) GET on the session.
    const getCall = fetchFn.mock.calls.find(
      ([url, init]) =>
        (init as { method?: string } | undefined)?.method !== 'POST' &&
        String(url).includes(`sessionId=${SESSION_ID}`) &&
        !String(url).includes('stream=true')
    );
    expect(getCall).toBeDefined();
  });
});
