import { notFound } from 'next/navigation';
import Link from 'next/link';
import { sql } from '@/lib/db';


interface Props {
  params: Promise<{ id: string }>;
}

export default async function SessionDetailPage({ params }: Props) {
  const { id } = await params;

  const sessionResult = await sql`
    SELECT 
      ss.id,
      ss.user_id as "userId",
      ss.org_id as "orgId",
      ss.status,
      ss.type,
      ss.started_at as "startedAt",
      ss.ended_at as "endedAt",
      ss.created_at as "createdAt",
      json_build_object(
        'id', s.id,
        'name', s.name,
        'description', s.description
      ) as scenario,
      json_build_object(
        'id', jt.id,
        'name', jt.name
      ) as "jobTitle",
      COALESCE(
        json_agg(
          DISTINCT jsonb_build_object(
            'id', m.id,
            'role', m.role,
            'content', m.content,
            'timestamp', m.timestamp
          ) ORDER BY jsonb_build_object(
            'id', m.id,
            'role', m.role,
            'content', m.content,
            'timestamp', m.timestamp
          )
        ) FILTER (WHERE m.id IS NOT NULL),
        '[]'
      ) as messages,
      COALESCE(
        (
          SELECT json_agg(
            json_build_object(
              'id', sc.id,
              'score', sc.score,
              'feedback', sc.feedback,
              'criteria', json_build_object(
                'name', c.name
              )
            )
          )
          FROM scores sc
          LEFT JOIN criteria c ON c.id = sc.criteria_id
          WHERE sc.session_id = ss.id
        ),
        '[]'
      ) as scores
    FROM simulation_sessions ss
    LEFT JOIN scenarios s ON s.id = ss.scenario_id
    LEFT JOIN job_titles jt ON jt.id = ss.job_title_id
    LEFT JOIN chat_messages m ON m.session_id = ss.id
    WHERE ss.id = ${id}
    GROUP BY ss.id, s.id, jt.id
  `;

  if (sessionResult.length === 0) notFound();

  const session: any = sessionResult[0];

  const totalScore =
    session.scores.length > 0
      ? Math.round(session.scores.reduce((sum: number, s: { score: number }) => sum + s.score, 0) / session.scores.length)
      : null;

  // Scores are on a 1–10 scale
  const scoreColor = (s: number) =>
    s >= 8 ? 'text-green-400' : s >= 5 ? 'text-yellow-400' : 'text-red-400';

  const barColor = (s: number) =>
    s >= 8 ? 'bg-green-500' : s >= 5 ? 'bg-yellow-500' : 'bg-red-500';

  const statusColors: Record<string, string> = {
    IN_PROGRESS: 'bg-blue-900/50 text-blue-400',
    COMPLETED: 'bg-green-900/50 text-green-400',
    ABANDONED: 'bg-slate-700 text-slate-400',
  };

  const formatTime = (d: Date) =>
    new Date(d).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white">
      <div className="max-w-4xl mx-auto px-6 py-12">
        <Link href="/sessions" className="text-blue-400 hover:text-blue-300 text-sm mb-8 inline-block">
          &larr; Back to Sessions
        </Link>

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <h1 className="text-2xl font-bold">{session.scenario.name}</h1>
            <span className={`text-xs font-medium px-2 py-1 rounded ${statusColors[session.status] || 'bg-slate-700 text-slate-300'}`}>
              {session.status.replace('_', ' ')}
            </span>
          </div>
          <div className="text-slate-400 text-sm">
            {session.jobTitle.name} &middot; {formatTime(session.createdAt)}
            {session.userId && <span> &middot; {session.userId}</span>}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Transcript */}
          <div className="lg:col-span-2">
            <h2 className="text-lg font-semibold mb-4">Transcript</h2>
            {session.messages.length === 0 ? (
              <p className="text-slate-500 text-sm">No messages recorded.</p>
            ) : (
              <div className="space-y-3">
                {session.messages.map((msg: { id: string; role: string; content: string; timestamp: Date }) => (
                  <div
                    key={msg.id}
                    className={`flex gap-3 ${msg.role === 'USER' ? 'flex-row-reverse' : ''}`}
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-1 ${
                      msg.role === 'USER' ? 'bg-blue-600' : 'bg-slate-700'
                    }`}>
                      {msg.role === 'USER' ? 'You' : 'C'}
                    </div>
                    <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${
                      msg.role === 'USER'
                        ? 'bg-blue-600 text-white rounded-tr-sm'
                        : 'bg-slate-800 text-slate-200 rounded-tl-sm'
                    }`}>
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                      <p className={`text-xs mt-1 opacity-50 ${msg.role === 'USER' ? 'text-right' : ''}`}>
                        {formatTime(msg.timestamp)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Score breakdown */}
          <div>
            <h2 className="text-lg font-semibold mb-4">Score</h2>
            {totalScore === null ? (
              <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 text-center">
                <p className="text-slate-500 text-sm">
                  {session.status === 'IN_PROGRESS'
                    ? 'Complete the session to see scores.'
                    : 'No scores available.'}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 text-center">
                  <div className={`text-5xl font-bold mb-1 ${scoreColor(totalScore)}`}>
                    {totalScore}
                  </div>
                  <div className="text-slate-400 text-sm">Overall Score</div>
                </div>

                <div className="space-y-3">
                  {session.scores.map((s: { id: string; score: number; feedback: string | null; criteria: { name: string } }) => (
                    <div key={s.id} className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
                      <div className="flex justify-between items-start mb-2">
                        <span className="text-sm font-medium">{s.criteria.name}</span>
                        <span className={`text-sm font-bold ${scoreColor(s.score)}`}>{s.score}</span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden mb-2">
                        <div
                          className={`h-full rounded-full transition-all ${barColor(s.score)}`}
                          style={{ width: `${s.score * 10}%` }}
                        />
                      </div>
                      {s.feedback && (
                        <p className="text-xs text-slate-400 leading-relaxed">{s.feedback}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {session.status === 'IN_PROGRESS' && (
              <Link
                href={`/simulate/${session.id}`}
                className="mt-4 block w-full bg-blue-600 hover:bg-blue-500 py-3 rounded-xl text-center text-sm font-medium transition-colors"
              >
                Resume Session →
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
