'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import { useChatSession } from '@/hooks/useChatSession';
import ChatInterface from '@/components/ChatInterface';
import VoiceChatInterface from '@/components/VoiceChatInterface';
import PhoneInterface from '@/components/PhoneInterface';

export default function SimulationPage() {
  const params = useParams();
  const sessionId = params.sessionId as string;

  const hook = useChatSession(sessionId);
  const {
    session,
    setSession,
    messages,
    streamingText,
    sending,
    error,
    ended,
    lastAiMessage,
    loading,
    sendMessage,
    endConversation,
  } = hook;

  // ── Trigger first AI message once session is loaded ─────────────────────────
  useEffect(() => {
    if (!session || loading || messages.length > 0 || ended) return;
    sendMessage('[START]', true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, loading]);

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white flex items-center justify-center">
        <div className="animate-pulse text-slate-400">Loading simulation…</div>
      </div>
    );
  }

  // ── Load error ───────────────────────────────────────────────────────────────
  if (error && !session) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <Link href="/simulate" className="text-blue-400 hover:text-blue-300">
            &larr; Back to simulations
          </Link>
        </div>
      </div>
    );
  }

  // ── Completed: score summary ─────────────────────────────────────────────────
  if (ended && session) {
    const avgScore = session.scores?.length
      ? (session.scores.reduce((sum, s) => sum + s.score, 0) / session.scores.length).toFixed(1)
      : null;

    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white">
        <div className="max-w-3xl mx-auto px-6 py-12">
          <div className="text-center mb-10">
            <div className="text-5xl mb-4">✅</div>
            <h1 className="text-3xl font-bold mb-2">Simulation Complete</h1>
            <p className="text-slate-400">{session.scenario.name}</p>
            <span className="inline-block mt-2 text-xs px-3 py-1 rounded-full bg-slate-800 border border-slate-700 text-slate-400 uppercase tracking-wide">
              {session.type}
            </span>
          </div>

          {avgScore && (
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 mb-8 text-center">
              <div className="text-6xl font-bold text-blue-400 mb-1">{avgScore}</div>
              <div className="text-slate-400 text-sm">Overall Score / 10</div>
            </div>
          )}

          {session.scores && session.scores.length > 0 ? (
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 mb-8">
              <h2 className="text-lg font-semibold mb-4">Score Breakdown</h2>
              <div className="space-y-4">
                {session.scores.map(s => (
                  <div key={s.id}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium">{s.criteria.name}</span>
                      <span
                        className={`text-sm font-bold ${
                          s.score >= 8
                            ? 'text-green-400'
                            : s.score >= 6
                            ? 'text-blue-400'
                            : s.score >= 4
                            ? 'text-yellow-400'
                            : 'text-red-400'
                        }`}
                      >
                        {s.score}/10
                      </span>
                    </div>
                    <div className="w-full bg-slate-700 rounded-full h-1.5 mb-1">
                      <div
                        className={`h-1.5 rounded-full ${
                          s.score >= 8
                            ? 'bg-green-500'
                            : s.score >= 6
                            ? 'bg-blue-500'
                            : s.score >= 4
                            ? 'bg-yellow-500'
                            : 'bg-red-500'
                        }`}
                        style={{ width: `${s.score * 10}%` }}
                      />
                    </div>
                    {s.feedback && (
                      <p className="text-xs text-slate-400 mt-1">{s.feedback}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 mb-8 text-center text-slate-400">
              No scores recorded for this session.
            </div>
          )}

          <div className="flex gap-4 justify-center">
            <Link
              href="/simulate"
              className="bg-blue-600 hover:bg-blue-500 px-6 py-3 rounded-lg font-medium transition-colors"
            >
              New Simulation
            </Link>
            <Link
              href="/sessions"
              className="border border-slate-600 hover:border-slate-400 text-slate-300 px-6 py-3 rounded-lg font-medium transition-colors"
            >
              View All Sessions
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Active session — dispatch to correct interface ───────────────────────────
  const sharedProps = {
    session,
    messages,
    streamingText,
    sending,
    error,
    sendMessage,
    endConversation,
  };

  if (session?.type === 'VOICE') {
    return (
      <VoiceChatInterface
        {...sharedProps}
        lastAiMessage={lastAiMessage}
      />
    );
  }

  if (session?.type === 'PHONE') {
    return (
      <PhoneInterface
        session={session}
        messages={messages}
        sendMessage={sendMessage}
        setSession={setSession}
        sessionId={sessionId}
        onEnded={() => {
          fetch(`/api/chat?sessionId=${sessionId}`)
            .then(r => r.json())
            .then(setSession);
        }}
      />
    );
  }

  // Default: CHAT
  return <ChatInterface {...sharedProps} />;
}
