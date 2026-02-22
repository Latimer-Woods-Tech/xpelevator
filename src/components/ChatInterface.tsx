'use client';

import { useRef, useState } from 'react';
import MessageBubble from './MessageBubble';
import type { ChatSessionState } from '@/hooks/useChatSession';

export type ChatInterfaceProps = Pick<
  ChatSessionState,
  | 'session'
  | 'messages'
  | 'streamingText'
  | 'sending'
  | 'error'
  | 'sendMessage'
  | 'endConversation'
>;

export default function ChatInterface({
  session,
  messages,
  streamingText,
  sending,
  error,
  sendMessage,
  endConversation,
}: ChatInterfaceProps) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    sendMessage(input).then(() => inputRef.current?.focus());
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as React.FormEvent);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white flex flex-col">
      {/* Header */}
      <div className="border-b border-slate-800 px-6 py-4 flex-shrink-0">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">💬</span>
              <h1 className="font-semibold">{session?.scenario.name}</h1>
            </div>
            <p className="text-sm text-slate-400">{session?.jobTitle.name}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-sm text-green-400">Live</span>
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

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-3xl mx-auto space-y-4">
          {messages.length === 0 && !streamingText && !sending && (
            <div className="text-center text-slate-500 py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-4" />
              <p>Starting conversation…</p>
              <p className="text-xs text-slate-600 mt-1">
                If this takes too long, check the browser console for errors.
              </p>
            </div>
          )}

          {messages.map(msg => (
            <MessageBubble key={msg.id} message={msg} />
          ))}

          {/* Streaming AI response */}
          {streamingText && (
            <div className="flex items-start gap-3">
              <span className="text-2xl flex-shrink-0">🤖</span>
              <div className="bg-slate-700/60 border border-slate-600 rounded-2xl rounded-tl-none px-4 py-3 max-w-[80%]">
                <p className="text-white text-sm whitespace-pre-wrap">{streamingText}</p>
                <span className="inline-block w-1 h-4 bg-blue-400 animate-pulse ml-0.5" />
              </div>
            </div>
          )}

          {/* Thinking indicator */}
          {sending && !streamingText && (
            <div className="flex items-start gap-3">
              <span className="text-2xl flex-shrink-0">🤖</span>
              <div className="bg-slate-700/60 border border-slate-600 rounded-2xl rounded-tl-none px-4 py-3">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                  <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                  <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" />
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="text-center text-red-400 text-sm py-2">{error}</div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-slate-800 px-6 py-4 flex-shrink-0">
        <div className="max-w-3xl mx-auto">
          <form onSubmit={handleSubmit} className="flex gap-3 items-end">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={sending}
              placeholder="Type your response… (Enter to send, Shift+Enter for new line)"
              rows={2}
              className="flex-1 bg-slate-800 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-500 resize-none focus:border-blue-500 focus:outline-none disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              className="bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 px-5 py-3 rounded-xl font-medium transition-colors flex-shrink-0"
            >
              Send
            </button>
          </form>
          <p className="text-xs text-slate-600 mt-2 text-center">
            You are the employee. Respond to the virtual customer above.
          </p>
        </div>
      </div>
    </div>
  );
}
