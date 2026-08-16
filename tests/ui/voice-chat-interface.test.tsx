/**
 * Behavioral (voice state-machine) tests for the VOICE modality UI
 * (src/components/VoiceChatInterface.tsx — the browser-native voice tier).
 *
 * This was the last untested "interface component" called out in #16 P2-8.
 * Voice mode drives a phase machine (starting → ai-speaking → idle → listening
 * → processing) over the Web Speech API — SpeechRecognition (STT) and
 * speechSynthesis (TTS) — neither of which happy-dom implements. We install
 * deterministic fakes for both and exercise the real transitions:
 *
 *   - unsupported browser (no STT/TTS) → text-fallback form; typing sends
 *   - supported browser → mic control + hands-free toggle, no text fallback
 *   - hands-free toggle flips aria-pressed
 *   - a streamed reply chunk drives TTS (speechSynthesis.speak) + "speaking" status
 *   - the full mic loop: TTS settles → idle → hold mic → STT final result →
 *     onend → sendMessage(transcript)
 *   - End Session delegates to endConversation (and is locked while sending)
 *
 * Every seam is a `vi.fn()`; each case is proof-of-rejection (Standing Law 1) —
 * the assertion is a specific transition, so it fails against a component that
 * doesn't perform it. Complements the a11y/emoji contract already covered.
 *
 * Environment: happy-dom
 * Run:  npx vitest tests/ui/voice-chat-interface.test.tsx
 */
// @vitest-environment happy-dom

/// <reference types="@testing-library/jest-dom" />
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import VoiceChatInterface, {
  type VoiceChatInterfaceProps,
} from '@/components/VoiceChatInterface';

// ── Fake SpeechRecognition — captures every instance the component constructs ──
class FakeRecognition {
  static instances: FakeRecognition[] = [];
  continuous = false;
  interimResults = false;
  lang = '';
  maxAlternatives = 1;
  onresult: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
  constructor() {
    FakeRecognition.instances.push(this);
  }
  /** Deliver a single final transcript, then fire onend (as a real stop would). */
  finalize(transcript: string) {
    this.onresult?.({
      resultIndex: 0,
      results: { length: 1, 0: { isFinal: true, 0: { transcript } } },
    });
    this.onend?.();
  }
}

// ── Fake speechSynthesis + utterance ─────────────────────────────────────────
class FakeUtterance {
  text: string;
  voice: unknown = null;
  rate = 1;
  pitch = 1;
  volume = 1;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

interface FakeSynth {
  speaking: boolean;
  pending: boolean;
  onvoiceschanged: (() => void) | null;
  getVoices: () => unknown[];
  speak: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  spoken: FakeUtterance[];
}

function makeSynth(): FakeSynth {
  const spoken: FakeUtterance[] = [];
  const s: FakeSynth = {
    speaking: false,
    pending: false,
    onvoiceschanged: null,
    getVoices: () => [],
    // A real engine reports `speaking === true` from the moment speak() is
    // called until the utterance's onend fires. Model that so the component's
    // "return to idle" guard doesn't fire prematurely.
    speak: vi.fn((u: FakeUtterance) => {
      spoken.push(u);
      s.speaking = true;
    }),
    cancel: vi.fn(),
    spoken,
  };
  return s;
}

const W = () => window as unknown as Record<string, unknown>;

function installVoiceSupport(): FakeSynth {
  FakeRecognition.instances = [];
  const synth = makeSynth();
  W().SpeechRecognition = FakeRecognition;
  W().webkitSpeechRecognition = FakeRecognition;
  W().speechSynthesis = synth;
  W().SpeechSynthesisUtterance = FakeUtterance;
  (globalThis as unknown as Record<string, unknown>).SpeechSynthesisUtterance = FakeUtterance;
  return synth;
}

function removeVoiceSupport() {
  delete W().SpeechRecognition;
  delete W().webkitSpeechRecognition;
  delete W().speechSynthesis;
}

// ── Test data ────────────────────────────────────────────────────────────────
function baseProps(overrides: Partial<VoiceChatInterfaceProps> = {}): VoiceChatInterfaceProps {
  return {
    session: {
      scenario: { name: 'Angry caller', script: {} },
      jobTitle: { name: 'Phone Agent' },
    } as unknown as VoiceChatInterfaceProps['session'],
    messages: [],
    streamingText: '',
    sending: false,
    error: null,
    speechChunks: [],
    sendMessage: vi.fn().mockResolvedValue(undefined),
    endConversation: vi.fn(),
    ...overrides,
  };
}

const micButton = () =>
  screen.getByRole('button', { name: /Hold to speak|Recording — release to send/i });

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  removeVoiceSupport();
  delete (globalThis as unknown as Record<string, unknown>).SpeechSynthesisUtterance;
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('VoiceChatInterface — unsupported browser fallback', () => {
  it('falls back to a text composer when the Web Speech API is absent, and sends typed text', async () => {
    removeVoiceSupport();
    const props = baseProps();
    render(<VoiceChatInterface {...props} />);

    // Feature-detection effect flips the phase to "unsupported".
    await waitFor(() =>
      expect(screen.getByText(/Voice not available in this browser/i)).toBeInTheDocument()
    );
    // No mic control in unsupported mode.
    expect(screen.queryByRole('button', { name: /Hold to speak/i })).not.toBeInTheDocument();

    const user = userEvent.setup();
    const input = screen.getByPlaceholderText(/Type your response/i);
    await user.type(input, 'I need to escalate this.');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(props.sendMessage).toHaveBeenCalledWith('I need to escalate this.');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('VoiceChatInterface — supported browser', () => {
  it('renders the mic control + hands-free toggle and no text fallback', async () => {
    installVoiceSupport();
    render(<VoiceChatInterface {...baseProps()} />);

    // Header identity comes from the session prop.
    expect(screen.getByRole('heading', { name: 'Angry caller' })).toBeInTheDocument();
    expect(screen.getByText('Phone Agent')).toBeInTheDocument();

    // Voice mode → mic control present, text fallback absent.
    expect(micButton()).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Type your response/i)).not.toBeInTheDocument();

    // Starts in the "starting" phase before the first customer turn.
    expect(screen.getByText(/Starting conversation/i)).toBeInTheDocument();
  });

  it('toggles hands-free mode, flipping aria-pressed', async () => {
    installVoiceSupport();
    const user = userEvent.setup();
    render(<VoiceChatInterface {...baseProps()} />);

    const toggle = screen.getByRole('button', { name: /Hands-free/i });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(toggle).toHaveTextContent(/Hands-free on/i);

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });

  it('speaks a streamed reply chunk aloud and shows the "speaking" status', async () => {
    const synth = installVoiceSupport();
    render(
      <VoiceChatInterface {...baseProps({ speechChunks: ['I am very upset about this.'] })} />
    );

    await waitFor(() => expect(synth.speak).toHaveBeenCalledTimes(1));
    expect(synth.spoken[0].text).toBe('I am very upset about this.');
    expect(screen.getByText(/Virtual customer is speaking/i)).toBeInTheDocument();
  });

  it('drives the full mic loop: TTS settles → idle → hold mic → final result → sendMessage', async () => {
    const synth = installVoiceSupport();
    const props = baseProps({ speechChunks: ['How can I help you today?'] });
    render(<VoiceChatInterface {...props} />);

    // The opening chunk is spoken; when its utterance ends (nothing else
    // speaking/pending, not sending), the component settles into idle.
    await waitFor(() => expect(synth.speak).toHaveBeenCalledTimes(1));
    // Simulate the engine finishing the utterance: it stops "speaking", then
    // fires the onend the component wired as its settle handler → idle.
    await act(async () => {
      synth.speaking = false;
      synth.spoken[0].onend?.();
    });
    await waitFor(() =>
      expect(screen.getByText(/Tap and hold the mic to respond/i)).toBeInTheDocument()
    );

    // Hold the mic → listening phase + a new recognition session started.
    await act(async () => {
      fireEvent.mouseDown(micButton());
    });
    await waitFor(() =>
      expect(screen.getByText(/Listening… speak clearly/i)).toBeInTheDocument()
    );
    const rec = FakeRecognition.instances.at(-1)!;
    expect(rec.start).toHaveBeenCalled();

    // A final STT transcript, then onend → the transcript is sent as the turn.
    await act(async () => {
      rec.finalize('I would like a full refund please');
    });
    expect(props.sendMessage).toHaveBeenCalledWith('I would like a full refund please');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('VoiceChatInterface — end session', () => {
  it('calls endConversation on End Session and locks it while sending', async () => {
    installVoiceSupport();
    const props = baseProps();
    const user = userEvent.setup();
    const { rerender } = render(<VoiceChatInterface {...props} />);

    await user.click(screen.getByRole('button', { name: 'End Session' }));
    expect(props.endConversation).toHaveBeenCalledTimes(1);

    // While a reply is in flight the control is disabled (no double-end).
    rerender(<VoiceChatInterface {...baseProps({ sending: true })} />);
    expect(screen.getByRole('button', { name: 'End Session' })).toBeDisabled();
  });
});
