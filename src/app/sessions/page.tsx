'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { SimulationSession as Session, ScoreItem } from '@/types';

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSessions = () => {
    setLoading(true);
    setError(null);
    fetch('/api/simulations')
      .then(res => {
        if (!res.ok) throw new Error(`Server error ${res.status}`);
        return res.json();
      })
      .then(data => {
        setSessions(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(
          err instanceof Error
            ? err.message
            : 'Failed to load sessions. The database may be waking up — try again in a moment.'
        );
        setLoading(false);
      });
  };

  useEffect(() => {
    loadSessions();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const avgScore = (scores: ScoreItem[]) => {
    if (!scores.length) return null;
    const total = scores.reduce((sum, s) => sum + s.score, 0);
    return (total / scores.length).toFixed(1);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white">
      <div className="max-w-5xl mx-auto px-6 py-12">
        <Link href="/" className="text-blue-400 hover:text-blue-300 text-sm mb-8 inline-block">
          &larr; Back to Home
        </Link>

        <h1 className="text-3xl font-bold mb-8">Simulation Sessions</h1>

        {loading ? (
          <p className="text-slate-400">Loading sessions...</p>
        ) : error ? (
          <div className="text-center py-12">
            <p className="text-2xl mb-3">⚠️</p>
            <p className="text-red-400 mb-2 font-medium">Could not load sessions</p>
            <p className="text-slate-400 text-sm mb-6">{error}</p>
            <button
              onClick={loadSessions}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium transition-colors"
            >
              Retry
            </button>
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-slate-400 mb-4">No sessions yet.</p>
            <Link href="/simulate" className="text-blue-400 hover:text-blue-300">
              Start a simulation &rarr;
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {sessions.map(session => (
              <div key={session.id} className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{session.type === 'PHONE' ? '📞' : '💬'}</span>
                    <div>
                      <h3 className="font-semibold">{session.scenario.name}</h3>
                      <p className="text-sm text-slate-400">{session.jobTitle.name}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className={`text-xs font-medium px-2 py-1 rounded ${
                      session.status === 'COMPLETED' ? 'bg-green-900/50 text-green-400' :
                      session.status === 'IN_PROGRESS' ? 'bg-yellow-900/50 text-yellow-400' :
                      'bg-slate-700 text-slate-400'
                    }`}>
                      {session.status}
                    </span>
                    {avgScore(session.scores) && (
                      <span className="text-2xl font-bold text-blue-400">
                        {avgScore(session.scores)}
                      </span>
                    )}
                  </div>
                </div>
                {session.scores.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {session.scores.map((s, i) => (
                      <div key={i}>
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-xs text-slate-400 truncate max-w-[70%]">{s.criteria.name}</span>
                          <span className={`text-xs font-bold ${
                            s.score >= 8 ? 'text-green-400' : s.score >= 5 ? 'text-yellow-400' : 'text-red-400'
                          }`}>{s.score}/10</span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              s.score >= 8 ? 'bg-green-500' : s.score >= 5 ? 'bg-yellow-400' : 'bg-red-500'
                            }`}
                            style={{ width: `${s.score * 10}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center justify-between mt-3">
                  <div className="text-xs text-slate-500">
                    {new Date(session.createdAt).toLocaleString()}
                  </div>
                  <div className="flex gap-4">
                    {session.status === 'IN_PROGRESS' && (
                      <Link
                        href={`/simulate/${session.id}`}
                        className="text-sm text-blue-400 hover:text-blue-300 font-medium"
                      >
                        Resume &rarr;
                      </Link>
                    )}
                    <Link
                      href={`/sessions/${session.id}`}
                      className="text-sm text-slate-400 hover:text-slate-200 font-medium"
                    >
                      View Details
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
