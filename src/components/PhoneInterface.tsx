'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import MessageBubble from './MessageBubble';
import type { ChatSessionState } from '@/hooks/useChatSession';

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
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sync messages from parent (before call starts)
  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Live transcript poll while call is connected
  const startCallPolling = useCallback(() => {
    pollRef.current = setInterval(async () => {
      try {
        const data = await fetch(`/api/chat?sessionId=${sessionId}`).then(r => r.json());
        setMessages(data.messages);
        setSession(data);
        if (data.status === 'COMPLETED' || data.status === 'CANCELLED') {
          setCallStatus('ended');
          stopPolling();
          onEnded();
        }
      } catch {
        // ignore transient network errors
      }
    }, 3_000);
  }, [sessionId, setSession, stopPolling, onEnded]);

  // Call timer
  useEffect(() => {
    if (callStatus !== 'connected') return;
    const id = setInterval(() => setCallSeconds(s => s + 1), 1_000);
    return () => clearInterval(id);
  }, [callStatus]);

  // Cleanup on unmount
  useEffect(() => () => stopPolling(), [stopPolling]);

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
      startCallPolling();
    } catch (err) {
      setCallError(err instanceof Error ? err.message : 'Failed to start call');
      setCallStatus('idle');
    }
  };

  const hangUp = async () => {
    stopPolling();
    setCallStatus('ended');
    await sendMessage('[END]');
    const data = await fetch(`/api/chat?sessionId=${sessionId}`).then(r => r.json());
    setSession(data);
    onEnded();
  };

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
              <div className="text-5xl mb-6 animate-pulse">📞</div>
              <p className="text-slate-300 text-lg">Dialing {phoneNumber}…</p>
              <p className="text-slate-500 text-sm mt-2">Waiting for answer</p>
            </div>
          )}

          {callStatus === 'connected' && (
            <div>
              <div className="text-center mb-8">
                <div className="text-4xl mb-2">📞</div>
                <p className="text-green-400 font-semibold">Call in progress</p>
                <p className="text-slate-400 text-sm">Transcript updates every 3 seconds</p>
              </div>
              <div className="space-y-4 mb-8">
                {messages.length === 0 && (
                  <p className="text-center text-slate-500 py-8 animate-pulse">
                    Waiting for conversation to begin…
                  </p>
                )}
                {messages.map(msg => (
                  <MessageBubble key={msg.id} message={msg} />
                ))}
              </div>
              <div className="text-center">
                <button
                  onClick={hangUp}
                  className="px-8 py-3 bg-red-600 hover:bg-red-500 rounded-full font-semibold transition-colors"
                >
                  🔴 Hang Up
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
