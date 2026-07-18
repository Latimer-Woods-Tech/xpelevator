import Link from 'next/link';
import {
  getPublicPackCatalog,
  type SimulationType,
  type ScenarioDifficulty,
} from '@/lib/scenario-packs';

/**
 * Operator-facing scenario-library surface (Phase 4, issue #16).
 *
 * The buyer we build for is the **operator** — training consultancies,
 * agencies, and enablement / L&D shops. An operator who signs up with an empty
 * workspace has nothing to sell; the starter library is their day-one sellable
 * inventory. This page is their shop window for that inventory, not a retail
 * marketing site.
 *
 * It renders the same catalog `GET /api/scenario-packs` serves — the single
 * source of truth in `src/lib/scenario-packs.ts`, read here via the pure
 * `getPublicPackCatalog()` (no self-fetch, SSR-safe). That helper is
 * hidden-mechanic-SAFE: it strips every scenario `script` (persona / objective /
 * hints), so this public surface shows only pack pitch, role, difficulty +
 * modality mix, and a non-revealing per-scenario summary — never the concealed
 * mechanics trainees must not see (R-021).
 *
 * Public by design: `/library` is intentionally absent from the middleware
 * matcher, so logged-out visitors reach it (like `/pricing` and the home page).
 * Copy follows the org rule — the word "AI" never appears on any user-facing
 * surface.
 */
export const dynamic = 'force-static';

/** Trainee-facing label for each practice modality. */
const MODALITY_LABEL: Record<SimulationType, string> = {
  CHAT: 'Text chat',
  VOICE: 'In-browser voice',
  PHONE: 'Live phone calls',
};

/** Operator-facing label + tint for each difficulty tier. */
const DIFFICULTY_LABEL: Record<ScenarioDifficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
};
const DIFFICULTY_CLASS: Record<ScenarioDifficulty, string> = {
  easy: 'bg-emerald-900/50 text-emerald-300',
  medium: 'bg-amber-900/50 text-amber-300',
  hard: 'bg-rose-900/50 text-rose-300',
};

export default function LibraryPage() {
  const catalog = getPublicPackCatalog();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white">
      {/* Header bar */}
      <header className="border-b border-slate-800">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between">
          <Link href="/" className="text-sm font-semibold">
            XP<span className="text-blue-400">Elevator</span>
          </Link>
          <div className="flex items-center gap-4 text-xs">
            <Link href="/pricing" className="text-slate-300 hover:text-white transition-colors">
              Pricing
            </Link>
            <Link
              href="/auth/signin"
              className="px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-600 transition-colors"
            >
              Sign in
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-16">
        {/* Hero — speaks to the operator, not the retail trainee */}
        <div className="text-center mb-14">
          <p className="text-xs uppercase tracking-widest text-blue-400 mb-3">
            Starter scenario library
          </p>
          <h1 className="text-4xl md:text-5xl font-bold mb-4 tracking-tight">
            Sellable training inventory on day one
          </h1>
          <p className="text-lg text-slate-300 max-w-2xl mx-auto">
            Every pack is a per-vertical bundle you can brand and resell — a role
            plus a spread of practice scenarios across difficulty and channel.
            Load a pack into a client workspace and their team can start
            practising against realistic simulated customers immediately.
          </p>
          {/* ICP wedge line — the decided go-to-market focus (E1 decision, issue #16):
              built first for sales-floor enablement and personal-development coaching
              operators; points at the Sales & Motivational Coaching demo line below. */}
          <p className="mt-5 text-sm text-blue-200/90 max-w-2xl mx-auto">
            Built first for{' '}
            <strong className="text-white">sales-floor enablement</strong> and{' '}
            <strong className="text-white">personal-development coaching</strong>{' '}
            operators — start from the{' '}
            <strong className="text-white">Sales &amp; Motivational Coaching</strong>{' '}
            demo line below.
          </p>
        </div>

        {/* Pack cards */}
        <div className="space-y-8">
          {catalog.packs.map((pack) => (
            <section
              key={pack.id}
              className="p-8 rounded-xl border border-slate-700 bg-slate-800/50"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
                <h2 className="text-2xl font-semibold">{pack.name}</h2>
                <span className="text-[11px] uppercase tracking-wide text-blue-400">
                  {pack.vertical}
                </span>
              </div>
              <p className="text-sm text-slate-400 mb-4">{pack.description}</p>

              <div className="flex flex-wrap items-center gap-3 mb-6 text-xs text-slate-300">
                <span className="px-2 py-0.5 rounded-full bg-slate-700/70">
                  Role: {pack.role}
                </span>
                <span className="px-2 py-0.5 rounded-full bg-slate-700/70">
                  {pack.scenarioCount} scenarios
                </span>
                {pack.modalities.map((m) => (
                  <span key={m} className="px-2 py-0.5 rounded-full bg-slate-700/70">
                    {MODALITY_LABEL[m]}
                  </span>
                ))}
              </div>

              <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {pack.scenarios.map((s) => (
                  <li
                    key={s.key}
                    className="p-4 rounded-lg bg-slate-900/50 border border-slate-800"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-sm font-medium text-slate-100">
                        {s.name}
                      </span>
                      <span
                        className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full ${DIFFICULTY_CLASS[s.difficulty]}`}
                      >
                        {DIFFICULTY_LABEL[s.difficulty]}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mb-2">{s.summary}</p>
                    <span className="text-[11px] text-blue-400">
                      {MODALITY_LABEL[s.type]}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        {/* Footer note — operator framing, no hard-coded money */}
        <p className="text-center text-xs text-slate-500 mt-12 max-w-2xl mx-auto">
          Packs are a starting point — you can edit every scenario, add your own,
          and set your own retail. Want a vertical that is not here?{' '}
          <Link href="/auth/signin" className="text-blue-400 hover:underline">
            Onboard your workspace
          </Link>{' '}
          and we will build the pack with you.
        </p>
      </main>
    </div>
  );
}
