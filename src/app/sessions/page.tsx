'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession, signOut } from 'next-auth/react';
import type { SimulationSession as Session, ScoreItem } from '@/types';
import { PageShell, Container, Card, Badge, Button, ButtonLink, ScoreBar } from '@/components/ui';
import { TopNav } from '@/components/ui/TopNav';
import { PhoneIcon, ChatIcon, AlertTriangleIcon } from '@/components/ui/icons';
import { scoreTextClass } from '@/lib/score-color';

function statusTone(status: string): 'success' | 'warning' | 'neutral' {
  if (status === 'COMPLETED') return 'success';
  if (status === 'IN_PROGRESS') return 'warning';
  return 'neutral';
}

export default function SessionsPage() {
  const { data: authSession } = useSession();
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

  const avgScore = (scores: ScoreItem[]): number | null => {
    if (!scores.length) return null;
    return scores.reduce((sum, s) => sum + s.score, 0) / scores.length;
  };

  return (
    <PageShell>
      <TopNav user={authSession?.user} signOutAction={authSession?.user ? () => signOut() : undefined} />
      <main>
        <Container size="lg" className="py-12">
          <h1 className="mb-8 text-3xl font-bold">Simulation Sessions</h1>

          {loading ? (
            <p className="text-slate-400">Loading sessions…</p>
          ) : error ? (
            <div className="py-12 text-center">
              <AlertTriangleIcon className="mx-auto mb-3 h-8 w-8 text-rose-400" />
              <p className="mb-2 font-medium text-rose-400">Could not load sessions</p>
              <p className="mb-6 text-sm text-slate-400">{error}</p>
              <Button onClick={loadSessions}>Retry</Button>
            </div>
          ) : sessions.length === 0 ? (
            <div className="py-12 text-center">
              <p className="mb-4 text-slate-400">No sessions yet.</p>
              <ButtonLink href="/simulate" variant="ghost">Start a simulation →</ButtonLink>
            </div>
          ) : (
            <div className="space-y-4">
              {sessions.map(session => {
                const avg = avgScore(session.scores);
                return (
                  <Card key={session.id} className="p-6">
                    <div className="mb-3 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        {session.type === 'PHONE'
                          ? <PhoneIcon className="h-5 w-5 text-brand-soft" />
                          : <ChatIcon className="h-5 w-5 text-brand-soft" />}
                        <div>
                          <h2 className="font-semibold">{session.scenario.name}</h2>
                          <p className="text-sm text-slate-400">{session.jobTitle.name}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <Badge tone={statusTone(session.status)}>{session.status}</Badge>
                        {avg !== null && (
                          <span className={`text-2xl font-bold ${scoreTextClass(avg)}`}>
                            {avg.toFixed(1)}
                          </span>
                        )}
                      </div>
                    </div>

                    {session.scores.length > 0 && (
                      <div className="mt-4 space-y-2">
                        {session.scores.map((s, i) => (
                          <div key={i}>
                            <div className="mb-1 flex items-center justify-between">
                              <span className="max-w-[70%] truncate text-xs text-slate-400">
                                {s.criteria.name}
                              </span>
                            </div>
                            <ScoreBar score={s.score} />
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="mt-3 flex items-center justify-between">
                      <div className="text-xs text-slate-500">
                        {new Date(session.createdAt).toLocaleString()}
                      </div>
                      <div className="flex gap-4">
                        {session.status === 'IN_PROGRESS' && (
                          <Link
                            href={`/simulate/${session.id}`}
                            className="text-sm font-medium text-brand-soft hover:text-brand"
                          >
                            Resume →
                          </Link>
                        )}
                        <Link
                          href={`/sessions/${session.id}`}
                          className="text-sm font-medium text-slate-400 hover:text-slate-200"
                        >
                          View Details
                        </Link>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </Container>
      </main>
    </PageShell>
  );
}
