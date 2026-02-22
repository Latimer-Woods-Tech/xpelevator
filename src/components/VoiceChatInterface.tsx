'use client';

/**
 * VoiceChatInterface — WebRTC browser-native voice mode for simulations.
 *
 * Uses the Web Speech API for both STT (SpeechRecognition) and TTS
 * (speechSynthesis), backed by the existing /api/chat SSE endpoint.
 * No Telnyx / no PSTN required. Works on localhost.
 *
 * Flow: AI speaks opening → user holds mic → speech recognised → text sent to
 *       /api/chat → SSE streams back → AI text spoken aloud → repeat.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import MessageBubble from './MessageBubble';
import type { ChatSessionState } from '@/hooks/useChatSession';

// ─── Web Speech API — self-contained type declarations ────────────────────────
// Defined here to avoid a dependency on @types/dom-speech-api; the Web Speech
// API is present in Chrome / Edge but not in the TypeScript DOM lib for all TS
// versions. These declarations match the subset of the API we actually use.

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}
interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
}
interface ISpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => ISpeechRecognition;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }
}

type VoicePhase =
  | 'starting'      // session loading / first AI opening on the way
  | 'ai-speaking'   // TTS playing AI response
  | 'idle'          // AI finished — waiting for trainee to tap mic
  | 'listening'     // SpeechRecognition active; trainee is speaking
  | 'processing'    // transcript submitted; waiting for AI SSE response
  | 'ended'         // session over
  | 'unsupported';  // Web Speech API not available in this browser

// Props are a direct slice of ChatSessionState (page lifts the hook)
export type VoiceChatInterfaceProps = Pick<
  ChatSessionState,
  | 'session'
  | 'messages'
  | 'streamingText'
  | 'sending'
  | 'error'
  | 'lastAiMessage'
  | 'sendMessage'
  | 'endConversation'
>;

// ─── Waveform bars (purely decorative) ───────────────────────────────────────

function Waveform({ active, color }: { active: boolean; color: string }) {
  const heights = [3, 6, 8, 5, 7, 4, 6];
  return (
    <div
      className={`flex items-end gap-[3px] w-14 h-10 transition-opacity duration-300 ${
        active ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {heights.map((h, i) => (
        <span
          key={i}
          className={`flex-1 rounded-full ${color}`}
          style={{
            height: `${h * 4}px`,
            transformOrigin: 'bottom',
            animation: active
              ? `bar-wave ${0.45 + i * 0.07}s ease-in-out infinite alternate`
              : 'none',
          }}
        />
      ))}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function VoiceChatInterface({
  session,
  messages,
  streamingText,
  sending,
  error,
  lastAiMessage,
  sendMessage,
  endConversation,
}: VoiceChatInterfaceProps) {
  const [phase, setPhase] = useState<VoicePhase>('starting');
  const [interimText, setInterimText] = useState('');
  const [handsFreeEnabled, setHandsFreeEnabled] = useState(false);

  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const finalTranscriptRef = useRef('');
  const phaseRef = useRef<VoicePhase>('starting');
  const handsFreeRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Keep ref in sync with state (ref is used inside SpeechRecognition callbacks)
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Keep hands-free ref in sync
  useEffect(() => {
    handsFreeRef.current = handsFreeEnabled;
  }, [handsFreeEnabled]);

  // ── Feature detection (client-only) ────────────────────────────────────────
  useEffect(() => {
    const hasStt = !!(window.SpeechRecognition ?? window.webkitSpeechRecognition);
    const hasTts = !!window.speechSynthesis;
    if (!hasStt || !hasTts) setPhase('unsupported');
  }, []);

  // ── Auto-scroll ─────────────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  // ── Speak AI message via TTS when lastAiMessage changes ────────────────────
  useEffect(() => {
    if (!lastAiMessage || phase === 'unsupported') return;

    const synth = window.speechSynthesis;
    synth.cancel();
    setPhase('ai-speaking');

    const utter = new SpeechSynthesisUtterance(lastAiMessage);
    utter.rate = 1.0;
    utter.pitch = 1.0;
    utter.volume = 1.0;

    // Prefer a natural-sounding English voice if available
    const pickVoice = () => {
      const voices = synth.getVoices();
      return (
        voices.find(
          v =>
            v.lang.startsWith('en') &&
            (v.name.includes('Natural') || v.name.includes('Neural') || v.name.includes('Online'))
        ) ??
        voices.find(v => v.lang.startsWith('en-US')) ??
        voices.find(v => v.lang.startsWith('en')) ??
        null
      );
    };

    const voice = pickVoice();
    if (voice) {
      utter.voice = voice;
    } else if (synth.getVoices().length === 0) {
      // Voices may not be loaded yet — wait for them
      synth.onvoiceschanged = () => {
        const v = pickVoice();
        if (v) utter.voice = v;
        synth.onvoiceschanged = null;
      };
    }

    utter.onend = () => setPhase('idle');
    utter.onerror = () => setPhase('idle'); // fall through to idle on TTS error

    synth.speak(utter);
  }, [lastAiMessage]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Track sending state ─────────────────────────────────────────────────────
  useEffect(() => {
    if (sending && phase !== 'ai-speaking') setPhase('processing');
  }, [sending]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cleanup on unmount ──────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      window.speechSynthesis?.cancel();
    };
  }, []);

  // ── Start listening ─────────────────────────────────────────────────────────
  const startListening = useCallback(() => {
    if (phaseRef.current !== 'idle') return;

    const SpeechRecognitionAPI =
      window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) return;

    // Interrupt any ongoing TTS
    window.speechSynthesis?.cancel();

    finalTranscriptRef.current = '';
    setInterimText('');
    setPhase('listening');

    const recognition = new SpeechRecognitionAPI();
    recognitionRef.current = recognition;

    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscriptRef.current += t;
          setInterimText('');
        } else {
          interim += t;
        }
      }
      if (interim) setInterimText(interim);
    };

    recognition.onend = () => {
      const transcript = finalTranscriptRef.current.trim();
      if (transcript && phaseRef.current === 'listening') {
        setPhase('processing');
        setInterimText('');
        finalTranscriptRef.current = '';
        sendMessage(transcript);
      } else if (phaseRef.current === 'listening') {
        // No speech detected — return to idle
        setPhase('idle');
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error !== 'aborted') {
        setPhase('idle');
      }
    };

    recognition.start();
  }, [sendMessage]);

  // ── Stop listening (release mic button) ─────────────────────────────────────
  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);
  // ── Hands-free: auto-start listening after AI finishes speaking ───────────
  // Placed after startListening/stopListening to satisfy the no-use-before-
  // declare rule. A short delay lets the TTS audio fully complete.
  useEffect(() => {
    if (phase !== 'idle' || !handsFreeRef.current) return;
    const timer = setTimeout(() => startListening(), 400);
    return () => clearTimeout(timer);
  }, [phase, startListening]);
  // ── Derived UI state ────────────────────────────────────────────────────────
  const statusMessages: Record<VoicePhase, string> = {
    starting: 'Starting conversation…',
    'ai-speaking': 'Virtual customer is speaking…',
    idle: 'Tap and hold the mic to respond',
    listening: interimText ? `"${interimText}"` : 'Listening… speak clearly',
    processing: 'Sending your response…',
    ended: 'Session ended',
    unsupported: 'Voice not supported — use Chrome or Edge',
  };

  const isMicActive = phase === 'listening';
  const isAiTalking = phase === 'ai-speaking' || (sending && !!streamingText);
  const canSpeak = !sending;
  const waveColor = isMicActive ? 'bg-red-400' : 'bg-purple-400';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-950 to-slate-900 text-white flex flex-col">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="border-b border-slate-800 px-6 py-4 flex-shrink-0">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">🎙️</span>
              <h1 className="font-semibold">{session?.scenario.name}</h1>
              <span className="text-xs px-2 py-0.5 rounded-full bg-purple-900/60 border border-purple-700/60 text-purple-300 font-medium tracking-wide uppercase">
                Voice
              </span>
            </div>
            <p className="text-sm text-slate-400">{session?.jobTitle.name}</p>
          </div>

          <div className="flex items-center gap-3">
            <span
              className={`h-2 w-2 rounded-full ${
                isMicActive ? 'bg-red-500 animate-pulse' : 'bg-green-500 animate-pulse'
              }`}
            />
            <span className={`text-sm ${isMicActive ? 'text-red-400' : 'text-green-400'}`}>
              {isMicActive ? 'Recording' : 'Live'}
            </span>
            <button
              onClick={endConversation}
              disabled={sending}
              className="ml-4 bg-red-900/30 hover:bg-red-900/50 border border-red-800 text-red-400 px-4 py-1.5 rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              End Session
            </button>
          </div>
        </div>
      </div>

      {/* ── Transcript ─────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-3xl mx-auto space-y-4">
          {messages.length === 0 && !streamingText && (
            <div className="text-center text-slate-500 py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500 mx-auto mb-4" />
              <p className="text-sm">Starting voice simulation…</p>
            </div>
          )}

          {messages.map(msg => (
            <MessageBubble key={msg.id} message={msg} />
          ))}

          {/* Streaming AI text (visible alongside TTS) */}
          {streamingText && (
            <div className="flex items-start gap-3">
              <span className="text-2xl flex-shrink-0">🤖</span>
              <div className="bg-slate-700/60 border border-slate-600 rounded-2xl rounded-tl-none px-4 py-3 max-w-[80%]">
                <p className="text-white text-sm whitespace-pre-wrap">{streamingText}</p>
                <span className="inline-block w-1 h-4 bg-purple-400 animate-pulse ml-0.5" />
              </div>
            </div>
          )}

          {error && (
            <div className="text-center text-red-400 text-sm py-2 bg-red-950/20 rounded-lg px-4">
              {error}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* ── Voice control panel ─────────────────────────────────────────────── */}
      <div className="border-t border-slate-800/60 bg-slate-900/60 backdrop-blur-sm px-6 py-8 flex-shrink-0">
        <div className="max-w-3xl mx-auto">
          {/* Status text */}
          <p className="text-sm text-center text-slate-400 mb-8 min-h-[1.25rem] transition-all duration-200">
            {statusMessages[phase]}
          </p>

          {/* Controls row */}
          <div className="flex items-center justify-center gap-10">
            <Waveform active={isAiTalking} color={waveColor} />

            {/* Microphone button */}
            <button
              onMouseDown={startListening}
              onMouseUp={stopListening}
              onTouchStart={e => { e.preventDefault(); startListening(); }}
              onTouchEnd={e => { e.preventDefault(); stopListening(); }}
              disabled={phase !== 'idle' || sending}
              aria-label={
                isMicActive ? 'Recording — release to send' : 'Hold to speak'
              }
              className={`
                relative w-24 h-24 rounded-full flex items-center justify-center text-4xl
                border-4 transition-all duration-200 shadow-2xl select-none
                ${
                  isMicActive
                    ? 'bg-red-600 border-red-400 scale-110 shadow-red-900/60'
                    : canSpeak
                    ? 'bg-purple-700 border-purple-500 hover:bg-purple-600 hover:scale-105 active:scale-110 active:bg-red-600 active:border-red-400 cursor-pointer'
                    : 'bg-slate-800 border-slate-600 opacity-40 cursor-not-allowed'
                }
              `}
            >
              {isMicActive ? '⏺' : '🎙️'}
              {/* Ripple ring when recording */}
              {isMicActive && (
                <span className="absolute inset-0 rounded-full border-2 border-red-400 animate-ping opacity-50" />
              )}
            </button>

            <Waveform active={isAiTalking || isMicActive} color={waveColor} />
          </div>

          {/* Hands-free toggle */}
          {phase !== 'unsupported' && (
            <div className="flex items-center justify-center gap-2 mt-6">
              <button
                onClick={() => setHandsFreeEnabled(prev => !prev)}
                aria-pressed={handsFreeEnabled}
                className={`
                  flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-medium
                  border transition-colors duration-200
                  ${
                    handsFreeEnabled
                      ? 'bg-purple-700/50 border-purple-500 text-purple-200'
                      : 'bg-slate-800/60 border-slate-600 text-slate-400 hover:border-slate-500'
                  }
                `}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    handsFreeEnabled ? 'bg-purple-400 animate-pulse' : 'bg-slate-600'
                  }`}
                />
                Hands-free {handsFreeEnabled ? 'on' : 'off'}
              </button>
            </div>
          )}

          <p className="text-xs text-slate-600 text-center mt-6">
            {phase === 'unsupported'
              ? 'Switch to Chrome or Edge to use voice mode.'
              : 'Hold the mic, speak your response, then release. The virtual customer will reply aloud.'}
          </p>
        </div>
      </div>
    </div>
  );
}
