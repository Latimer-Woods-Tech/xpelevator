'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface TrendPoint {
  date: string;
  avg: number;
  count: number;
}

interface JobBreakdown {
  name: string;
  sessions: number;
  avg: number | null;
}

interface CriteriaBreakdown {
  name: string;
  weight: number;
  avg: number | null;
  count: number;
}

interface TypeBreakdown {
  type: 'PHONE' | 'CHAT';
  sessions: number;
  avg: number | null;
}

interface AnalyticsData {
  totalSessions: number;
  overallAvg: number | null;
  scoreTrend: TrendPoint[];
  byJobTitle: JobBreakdown[];
  byCriteria: CriteriaBreakdown[];
  byType: TypeBreakdown[];
}

function ScoreBar({ value, max = 10 }: { value: number | null; max?: number }) {
  if (value === null) return <span className="text-slate-500 text-sm">—</span>;
  const pct = (value / max) * 100;
  const color =
    value >= 8 ? 'bg-green-500' : value >= 5 ? 'bg-yellow-400' : 'bg-red-500';
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span
        className={`text-sm font-semibold w-8 text-right ${
          value >= 8
            ? 'text-green-400'
            : value >= 5
            ? 'text-yellow-400'
            : 'text-red-400'
        }`}
      >
        {value.toFixed(1)}
      </span>
    </div>
  );
}

function TrendChart({ points }: { points: TrendPoint[] }) {
  if (points.length === 0) {
    return (
      <p className="text-slate-500 text-sm text-center py-8">No data yet.</p>
    );
  }

  const maxVal = 10;
  const chartH = 80; // px
  const barW = Math.max(6, Math.min(24, Math.floor(600 / points.length)));

  return (
    <div className="overflow-x-auto">
      <div className="flex items-end gap-1 min-w-max px-1" style={{ height: chartH + 28 }}>
        {points.map(pt => {
          const barH = Math.max(2, (pt.avg / maxVal) * chartH);
          const color =
            pt.avg >= 8 ? '#22c55e' : pt.avg >= 5 ? '#facc15' : '#ef4444';
          const label =
            pt.date.slice(5); // MM-DD
          return (
            <div
              key={pt.date}
              className="flex flex-col items-center"
              title={`${pt.date}: avg ${pt.avg.toFixed(1)} (${pt.count} session${pt.count !== 1 ? 's' : ''})`}
            >
              <div
                className="rounded-sm"
                style={{ width: barW, height: barH, backgroundColor: color }}
              />
              {points.length <= 30 && (
                <span
                  className="text-slate-500 mt-1 select-none"
                  style={{ fontSize: 9, writingMode: 'vertical-rl', transform: 'rotate(180deg)', lineHeight: 1 }}
                >
                  {label}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetch('/api/analytics')
      .then(res => {
        if (!res.ok) throw new Error(`Server error ${res.status}`);
        return res.json() as Promise<AnalyticsData>;
      })
      .then(d => {
        setData(d);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(
          err instanceof Error
            ? err.message
            : 'Failed to load analytics. Try again in a moment.'
        );
        setLoading(false);
      });
  };

  useEffect(() => {
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white">
      <div className="max-w-5xl mx-auto px-6 py-12">
        <Link href="/" className="text-blue-400 hover:text-blue-300 text-sm mb-8 inline-block">
          &larr; Back to Home
        </Link>

        <h1 className="text-3xl font-bold mb-8">Analytics</h1>

        {loading ? (
          <p className="text-slate-400">Loading analytics...</p>
        ) : error ? (
          <div className="text-center py-12">
            <p className="text-2xl mb-3">⚠️</p>
            <p className="text-red-400 mb-2 font-medium">Could not load analytics</p>
            <p className="text-slate-400 text-sm mb-6">{error}</p>
            <button
              onClick={load}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium transition-colors"
            >
              Retry
            </button>
          </div>
        ) : !data || data.totalSessions === 0 ? (
          <div className="text-center py-12">
            <p className="text-slate-400 mb-4">No completed sessions yet.</p>
            <Link href="/simulate" className="text-blue-400 hover:text-blue-300">
              Start a simulation &rarr;
            </Link>
          </div>
        ) : (
          <div className="space-y-8">
            {/* ── Summary cards ───────────────────────────────────────────── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Total Sessions" value={String(data.totalSessions)} />
              <StatCard
                label="Overall Avg Score"
                value={data.overallAvg !== null ? data.overallAvg.toFixed(1) + ' / 10' : '—'}
                highlight={data.overallAvg !== null ? data.overallAvg : undefined}
              />
              <StatCard
                label="Phone Sessions"
                value={String(data.byType.find(t => t.type === 'PHONE')?.sessions ?? 0)}
              />
              <StatCard
                label="Chat Sessions"
                value={String(data.byType.find(t => t.type === 'CHAT')?.sessions ?? 0)}
              />
            </div>

            {/* ── Score trend ─────────────────────────────────────────────── */}
            <Section title="Score Trend (last 60 days)">
              <p className="text-slate-400 text-xs mb-4">
                Daily average score across completed sessions. Color: green ≥ 8, yellow ≥ 5, red &lt; 5.
              </p>
              <TrendChart points={data.scoreTrend} />
            </Section>

            {/* ── By criteria ─────────────────────────────────────────────── */}
            <Section title="Performance by Criteria">
              <p className="text-slate-400 text-xs mb-4">Sorted weakest → strongest.</p>
              {data.byCriteria.length === 0 ? (
                <p className="text-slate-500 text-sm">No scored sessions yet.</p>
              ) : (
                <div className="space-y-3">
                  {data.byCriteria.map(c => (
                    <div key={c.name}>
                      <div className="flex justify-between text-xs text-slate-400 mb-1">
                        <span>{c.name}</span>
                        <span>{c.count} score{c.count !== 1 ? 's' : ''} · weight {c.weight}</span>
                      </div>
                      <ScoreBar value={c.avg} />
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* ── By job title ─────────────────────────────────────────────── */}
            <Section title="Performance by Job Title">
              {data.byJobTitle.length === 0 ? (
                <p className="text-slate-500 text-sm">No data yet.</p>
              ) : (
                <div className="space-y-3">
                  {data.byJobTitle.map(j => (
                    <div key={j.name}>
                      <div className="flex justify-between text-xs text-slate-400 mb-1">
                        <span>{j.name}</span>
                        <span>{j.sessions} session{j.sessions !== 1 ? 's' : ''}</span>
                      </div>
                      <ScoreBar value={j.avg} />
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* ── By simulation type ───────────────────────────────────────── */}
            <Section title="Phone vs Chat">
              <div className="grid grid-cols-2 gap-6">
                {data.byType.map(t => (
                  <div key={t.type} className="space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <span>{t.type === 'PHONE' ? '📞' : '💬'}</span>
                      <span>{t.type}</span>
                      <span className="text-slate-400 font-normal">— {t.sessions} sessions</span>
                    </div>
                    <ScoreBar value={t.avg} />
                  </div>
                ))}
              </div>
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: number;
}) {
  const textColor =
    highlight !== undefined
      ? highlight >= 8
        ? 'text-green-400'
        : highlight >= 5
        ? 'text-yellow-400'
        : 'text-red-400'
      : 'text-white';

  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
      <p className="text-slate-400 text-xs mb-1">{label}</p>
      <p className={`text-2xl font-bold ${textColor}`}>{value}</p>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
      <h2 className="text-lg font-semibold mb-4">{title}</h2>
      {children}
    </div>
  );
}
