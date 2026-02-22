'use client';

/**
 * useChatSession — core state + SSE message loop for all simulation modes
 * (CHAT, VOICE). Extracted so UI components (text chat, voice) share one
 * source of truth without prop-drilling.
 */

import { useCallback, useEffect, useState } from 'react';
import type { Message, SimulationSession as Session } from '@/types';

export interface ChatSessionState {
  session: Session | null;
  messages: Message[];
  streamingText: string;
  loading: boolean;
  sending: boolean;
  error: string | null;
  ended: boolean;
  /** Full text of the most recent AI message — consumed by voice mode for TTS */
  lastAiMessage: string | null;
  sendMessage: (content: string, silent?: boolean) => Promise<void>;
  endConversation: () => void;
  setSession: React.Dispatch<React.SetStateAction<Session | null>>;
}

export function useChatSession(sessionId: string): ChatSessionState {
  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [lastAiMessage, setLastAiMessage] = useState<string | null>(null);

  // ── 1. Load session on mount ────────────────────────────────────────────────
  useEffect(() => {
    fetch(`/api/chat?sessionId=${sessionId}`)
      .then(res => {
        if (!res.ok) throw new Error('Session not found');
        return res.json();
      })
      .then((data: Session) => {
        setSession(data);
        setMessages(data.messages);
        if (data.status === 'COMPLETED' || data.status === 'CANCELLED') {
          setEnded(true);
        }
        setLoading(false);
      })
      .catch(err => {
        setError(err instanceof Error ? err.message : 'Failed to load session');
        setLoading(false);
      });
  }, [sessionId]);

  // ── 2. Send message + consume SSE stream ────────────────────────────────────
  const sendMessage = useCallback(
    async (content: string, silent = false) => {
      if (sending || !content.trim()) return;

      setSending(true);
      setStreamingText('');
      setError(null);
      setLastAiMessage(null);

      // Optimistic agent message (skip for silent system signals like [START])
      if (!silent) {
        setMessages(prev => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'AGENT',
            content: content.trim(),
            timestamp: new Date().toISOString(),
          },
        ]);
      }

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, content }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({ error: 'Unknown error' }));
          throw new Error(errData.error ?? 'Failed to send message');
        }

        const contentType = res.headers.get('content-type') ?? '';

        if (contentType.includes('text/event-stream')) {
          const reader = res.body!.getReader();
          const decoder = new TextDecoder();
          let accumulated = '';

          outer: while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const text = decoder.decode(value);
            const lines = text.split('\n').filter(l => l.startsWith('data:'));

            for (const line of lines) {
              try {
                const data = JSON.parse(line.slice(5).trim());

                if (data.type === 'chunk') {
                  accumulated += data.content;
                  setStreamingText(accumulated);
                } else if (data.type === 'done') {
                  const aiMsg: Message = {
                    id: crypto.randomUUID(),
                    role: 'CUSTOMER',
                    content: data.content,
                    timestamp: new Date().toISOString(),
                  };
                  setMessages(prev => [...prev, aiMsg]);
                  setLastAiMessage(data.content);
                  setStreamingText('');
                } else if (data.type === 'session_ending') {
                  const aiMsg: Message = {
                    id: crypto.randomUUID(),
                    role: 'CUSTOMER',
                    content: data.content,
                    timestamp: new Date().toISOString(),
                  };
                  setMessages(prev => [...prev, aiMsg]);
                  setLastAiMessage(data.content);
                  setStreamingText('');
                } else if (data.type === 'session_ended') {
                  const updated: Session = await fetch(
                    `/api/chat?sessionId=${sessionId}`
                  ).then(r => r.json());
                  setSession(updated);
                  setMessages(updated.messages);
                  setEnded(true);
                  break outer;
                } else if (data.type === 'error') {
                  throw new Error(data.message);
                }
              } catch {
                // skip malformed SSE lines
              }
            }
          }
        } else {
          // Non-streaming end-session response
          const data = await res.json();
          if (data.ended && data.session) {
            setSession(data.session);
            setMessages(data.session.messages);
            setEnded(true);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setSending(false);
      }
    },
    [sending, sessionId]
  );

  const endConversation = useCallback(() => {
    sendMessage('[END]');
  }, [sendMessage]);

  return {
    session,
    setSession,
    messages,
    streamingText,
    loading,
    sending,
    error,
    ended,
    lastAiMessage,
    sendMessage,
    endConversation,
  };
}
