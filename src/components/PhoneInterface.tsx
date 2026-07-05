'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import MessageBubble from './MessageBubble';
import type { ChatSessionState } from '@/hooks/useChatSession';
import type { Message } from '@/types';

export type PhoneInterfaceProps = Pick<
  ChatSessionState,
  'session' | 'messages' | 'sendMessage' | 'setSession'
> & {
  sessionId: string;
  onEnded: () => void;
};

type CallStatus = 'idle' | 'calling' | 'connected' | 'ended';

export default function PhoneInterface({
  session,
  messages: initialMessages,
  sendMessage,
  setSession,
  sessionId,
  onEnded,
}: PhoneInterfaceProps) {
  const [messages, setMessages] = useState(initialMessages);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [callStatus, setCallStatus] = useState<CallStatus>('idle');
  const [callError, setCallError] = useState<string | null>(null);
  const [callSeconds, setCallSeconds] = useState(0);
  // BL-054: SSE reader ref replaces setInterval poll ref
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  // Auto-scroll anchor
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Sync messages from parent (before call starts)
  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const stopStreaming = useCallback(() => {
    readerRef.current?.cancel().catch(() => {});
    readerRef.current = null;
  }, []);

  // BL-054: Start SSE-based live transcript stream (replaces 3-second poll)
  const startCallStreaming = useCallback(async () => {
    try {
      const res = await fetch(`/api/chat?sessionId=${sessionId}&stream=true`);
      if (!res.ok || !res.body) return;

      const reader = res.body.getReader();
      readerRef.current = reader;
      const decoder = new TextDecoder();

      (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const text = decoder.decode(value, { stream: true });
            const lines = text.split('\n').filter(l => l.startsWith('data:'));

            for (const line of lines) {
              try {
                const data = JSON.parse(line.slice(5).trim()) as {
                  type: string;
                  messages?: Message[];
                  status?: string;
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  session?: any;
                };

                if (data.type === 'transcript' && data.messages) {
                  setMessages(data.messages);
                } else if (data.type === 'ended' && data.session) {
                  setMessages(data.session.messages);
                  setSession(data.session);
                  setCallStatus('ended');
                  stopStreaming();
                  onEnded();
                  return;
                }
              } catch {
                // skip malformed SSE lines
              }
            }
          }
        } catch {
          // stream cancelled or connection lost
        }
      })();
    } catch (err) {
      console.error('[PhoneInterface] SSE stream error:', err);
    }
  }, [sessionId, setSession, stopStreaming, onEnded]);

  // Call timer
  useEffect(() => {
    if (callStatus !== 'connected') return;
    const id = setInterval(() => setCallSeconds(s => s + 1), 1_000);
    return () => clearInterval(id);
  }, [callStatus]);

  // Cleanup on unmount
  useEffect(() => () => stopStreaming(), [stopStreaming]);

  const initiateCall = async () => {
    if (!phoneNumber.trim()) return;
    setCallError(null);
    setCallStatus('calling');
    try {
      const res = await fetch('/api/telnyx/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, to: phoneNumber.trim() }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? 'Call initiation failed');
      }
      setCallStatus('connected');
      startCallStreaming();
    } catch (err) {
      setCallError(err instanceof Error ? err.message : 'Failed to start call');
      setCallStatus('idle');
    }
  };

  const hangUp = async () => {
    stopStreaming();
    setCallStatus('ended');
    await sendMessage('[END]');
    const data = await fetch(`/api/chat?sessionId=${sessionId}`).then(r => r.json());
    setSession(data);
    onEnded();
  };

  const lastRole = messages.length > 0 ? messages[messages.length - 1].role : null;
  const customerIsThinking = callStatus === 'connected' && lastRole !== null && lastRole !== 'CUSTOMER';

  const fmt = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white flex flex-col">
      {/* Header */}
      <div className="border-b border-slate-800 px-6 py-4 flex-shrink-0">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">📞</span>
              <h1 className="font-semibold">{session?.scenario.name}</h1>
            </div>
            <p className="text-sm text-slate-400">{session?.jobTitle.name}</p>
          </div>
          {callStatus === 'connected' && (
            <div className="flex items-center gap-3">
              <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-sm font-mono text-green-400">{fmt(callSeconds)}</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-3xl mx-auto">
          {callStatus === 'idle' && (
            <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-8 max-w-sm mx-auto text-center">
              <div className="text-5xl mb-6">📞</div>
              <h2 className="text-xl font-semibold mb-2">Ready to Call</h2>
              <p className="text-slate-400 text-sm mb-6">
                Telnyx will dial your number and connect you to the virtual customer.
              </p>
              <div className="text-left mb-4">
                <label className="block text-sm text-slate-400 mb-1">
                  Your phone number (E.164)
                </label>
                <input
                  type="tel"
                  value={phoneNumber}
                  onChange={e => setPhoneNumber(e.target.value)}
                  placeholder="+12125550123"
                  className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-xl text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </div>
              {callError && <p className="text-red-400 text-sm mb-4">{callError}</p>}
              <button
                onClick={initiateCall}
                disabled={!phoneNumber.trim()}
                className="w-full py-3 bg-green-600 hover:bg-green-500 disabled:bg-slate-600 disabled:text-slate-400 rounded-xl font-semibold transition-colors"
              >
                Start Call
              </button>
              <p className="text-xs text-slate-500 mt-3">
                Requires TELNYX_API_KEY + TELNYX_CONNECTION_ID configured.
              </p>
            </div>
          )}

          {callStatus === 'calling' && (
            <div className="text-center py-20">
              {/* Ripple rings */}
              <div className="relative inline-flex items-center justify-center mb-8">
                <span className="absolute inline-flex h-24 w-24 rounded-full bg-green-500 opacity-20 animate-ping" />
                <span className="absolute inline-flex h-16 w-16 rounded-full bg-green-500 opacity-30 animate-ping [animation-delay:0.3s]" />
                <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-green-600 text-2xl">
                  📞
                </span>
              </div>
              <p className="text-slate-300 text-lg font-medium">Dialing {phoneNumber}…</p>
              <p className="text-slate-500 text-sm mt-2">Waiting for answer</p>
            </div>
          )}

          {callStatus === 'connected' && (
            <div className="pb-20">
              {/* Status bar */}
              <div className="text-center mb-6">
                <p className="text-green-400 font-semibold text-sm uppercase tracking-widest">
                  ● Live Call
                </p>
                <p className="text-slate-500 text-xs mt-1">Transcript updates as you speak</p>
              </div>

              {/* Messages */}
              <div className="space-y-4 mb-4">
                {messages.length === 0 && (
                  <p className="text-center text-slate-500 py-8 animate-pulse">
                    Connecting to virtual customer…
                  </p>
                )}
                {messages.map(msg => (
                  <MessageBubble key={msg.id} message={msg} />
                ))}

                {/* "Customer is thinking…" indicator */}
                {customerIsThinking && (
                  <div className="flex items-center gap-3">
                    <span className="text-2xl flex-shrink-0">👤</span>
                    <div className="bg-slate-700/60 border border-slate-600 rounded-2xl rounded-tl-none px-4 py-3">
                      <span className="flex gap-1 items-center">
                        <span className="h-2 w-2 rounded-full bg-slate-400 animate-bounce [animation-delay:0ms]" />
                        <span className="h-2 w-2 rounded-full bg-slate-400 animate-bounce [animation-delay:150ms]" />
                        <span className="h-2 w-2 rounded-full bg-slate-400 animate-bounce [animation-delay:300ms]" />
                      </span>
                    </div>
                  </div>
                )}

                {/* Auto-scroll anchor */}
                <div ref={messagesEndRef} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sticky hang-up bar — shown only during connected call */}
      {callStatus === 'connected' && (
        <div className="sticky bottom-0 border-t border-slate-800 bg-slate-900/90 backdrop-blur-sm px-6 py-4 flex-shrink-0">
          <div className="max-w-3xl mx-auto flex items-center justify-between">
            <p className="text-slate-400 text-sm">
              {customerIsThinking ? '🟡 Customer responding…' : '🟢 Your turn to speak'}
            </p>
            <button
              onClick={hangUp}
              className="flex items-center gap-2 px-6 py-2.5 bg-red-600 hover:bg-red-500 rounded-full font-semibold transition-colors text-sm"
            >
              🔴 Hang Up
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
