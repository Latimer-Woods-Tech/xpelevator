export const runtime = 'edge';
import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white">
      {/* Header bar */}
      <header className="border-b border-slate-800">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between">
          <span className="text-sm font-semibold">
            XP<span className="text-blue-400">Elevator</span>
          </span>
          <Link
            href="/admin"
            className="text-xs px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 transition-colors"
          >
            Admin
          </Link>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6 py-20">
        <div className="text-center mb-16">
          <h1 className="text-5xl font-bold mb-4 tracking-tight">
            XP<span className="text-blue-400">Elevator</span>
          </h1>
          <p className="text-xl text-slate-300 max-w-2xl mx-auto">
            Virtual customer simulator for training employees on real-world interactions.
            Practice phone calls and chat conversations, scored against customizable criteria.
          </p>

        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Link
            href="/simulate"
            className="group block p-8 rounded-xl bg-slate-800/50 border border-slate-700 hover:border-blue-500 transition-all hover:shadow-lg hover:shadow-blue-500/10"
          >
            <div className="text-3xl mb-4">🎯</div>
            <h2 className="text-xl font-semibold mb-2 group-hover:text-blue-400 transition-colors">
              Start Simulation
            </h2>
            <p className="text-slate-400 text-sm">
              Select a job title and practice customer interactions via phone or chat.
            </p>
          </Link>

          <Link
            href="/sessions"
            className="group block p-8 rounded-xl bg-slate-800/50 border border-slate-700 hover:border-blue-500 transition-all hover:shadow-lg hover:shadow-blue-500/10"
          >
            <div className="text-3xl mb-4">📊</div>
            <h2 className="text-xl font-semibold mb-2 group-hover:text-blue-400 transition-colors">
              View Sessions
            </h2>
            <p className="text-slate-400 text-sm">
              Review completed simulation sessions, full transcripts, and AI-generated performance scores.
            </p>
          </Link>

          <Link
            href="/admin"
            className="group block p-8 rounded-xl bg-slate-800/50 border border-slate-700 hover:border-blue-500 transition-all hover:shadow-lg hover:shadow-blue-500/10"
          >
            <div className="text-3xl mb-4">⚙️</div>
            <h2 className="text-xl font-semibold mb-2 group-hover:text-blue-400 transition-colors">
              Admin Panel
            </h2>
            <p className="text-slate-400 text-sm">
              Manage job titles, scenarios, scoring criteria, and job–criteria assignments.
            </p>
          </Link>

          <Link
            href="/analytics"
            className="group block p-8 rounded-xl bg-slate-800/50 border border-slate-700 hover:border-blue-500 transition-all hover:shadow-lg hover:shadow-blue-500/10"
          >
            <div className="text-3xl mb-4">📈</div>
            <h2 className="text-xl font-semibold mb-2 group-hover:text-blue-400 transition-colors">
              Analytics
            </h2>
            <p className="text-slate-400 text-sm">
              Track score trends over time, per-criteria performance, and phone vs chat breakdowns.
            </p>
          </Link>
        </div>
      </div>
    </div>
  );
}
