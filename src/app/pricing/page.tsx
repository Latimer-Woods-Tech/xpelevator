import Link from 'next/link';
import { getPublicPlanCatalog, type SimulationType } from '@/lib/plans';

/**
 * Operator-facing pricing / signup surface (Phase 4, issue #16).
 *
 * The buyer we build for is the **operator** — training consultancies,
 * agencies, and enablement / L&D shops who own the end-client relationship,
 * buy seats at wholesale, and resell at their own retail. This page is their
 * shop window, not a retail marketing site.
 *
 * It renders the same seat-plan catalog that `GET /api/plans` serves — the
 * single source of truth in `src/lib/plans.ts`. As a server component we read
 * the pure catalog directly (no self-fetch): identical data, SSR-safe, and no
 * absolute-URL round-trip. Wholesale amounts are a founder input held in Stripe
 * (`currency: null` here), so no money is ever hard-coded on this surface.
 *
 * Public by design: `/pricing` is intentionally absent from the middleware
 * matcher, so logged-out visitors reach it (like the home page). Copy follows
 * the org rule — the word "AI" never appears on any user-facing surface.
 */
export const dynamic = 'force-static';

/** Trainee-facing label for each practice modality. */
const MODALITY_LABEL: Record<SimulationType, string> = {
  CHAT: 'Text chat',
  VOICE: 'In-browser voice',
  PHONE: 'Live phone calls',
};

export default function PricingPage() {
  const catalog = getPublicPlanCatalog();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white">
      {/* Header bar */}
      <header className="border-b border-slate-800">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between">
          <Link href="/" className="text-sm font-semibold">
            XP<span className="text-blue-400">Elevator</span>
          </Link>
          <Link
            href="/auth/signin"
            className="text-xs px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-600 transition-colors"
          >
            Sign in
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-16">
        {/* Hero — speaks to the operator, not the retail trainee */}
        <div className="text-center mb-14">
          <p className="text-xs uppercase tracking-widest text-blue-400 mb-3">
            For training operators
          </p>
          <h1 className="text-4xl md:text-5xl font-bold mb-4 tracking-tight">
            Seat pricing built for resellers
          </h1>
          <p className="text-lg text-slate-300 max-w-2xl mx-auto">
            Buy trainee seats at wholesale, brand the experience as your own, and
            set your own retail. One seat is one active trainee for one month —
            billed per active trainee, cancel any time.
          </p>
        </div>

        {/* Tier cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {catalog.tiers.map((tier, i) => {
            const featured = i === catalog.tiers.length - 1;
            return (
              <div
                key={tier.id}
                className={`flex flex-col p-8 rounded-xl border transition-all ${
                  featured
                    ? 'bg-blue-950/40 border-blue-500 shadow-lg shadow-blue-500/10'
                    : 'bg-slate-800/50 border-slate-700'
                }`}
              >
                <div className="flex items-baseline justify-between mb-1">
                  <h2 className="text-2xl font-semibold">{tier.name}</h2>
                  {featured && (
                    <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-blue-600/70 text-white">
                      Full stack
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-400 mb-6">{tier.description}</p>

                <ul className="space-y-2 mb-8">
                  {tier.modalities.map((m) => (
                    <li key={m} className="flex items-center gap-2 text-sm text-slate-200">
                      <span className="text-blue-400" aria-hidden="true">
                        ✓
                      </span>
                      {MODALITY_LABEL[m]}
                    </li>
                  ))}
                </ul>

                <div className="mt-auto">
                  <p className="text-sm text-slate-400 mb-4">
                    Wholesale seat rate&nbsp;— you set retail
                  </p>
                  <Link
                    href="/auth/signin"
                    className={`block text-center text-sm font-medium px-4 py-2.5 rounded-lg transition-colors ${
                      featured
                        ? 'bg-blue-600 hover:bg-blue-500 text-white'
                        : 'bg-slate-700 hover:bg-slate-600 text-white'
                    }`}
                  >
                    Get started
                  </Link>
                </div>
              </div>
            );
          })}
        </div>

        {/* ICP wedge band — the decided go-to-market focus (E1 decision, issue #16).
            Names who the wholesale line is built for first: operators serving sales
            floors and personal-development / motivational-coaching practices. Operator
            framing only (they resell) — no retail marketing, no hard-coded money. */}
        <section className="mt-16 rounded-xl border border-blue-800/60 bg-blue-950/30 p-8 text-center">
          <p className="text-xs uppercase tracking-widest text-blue-400 mb-3">
            Who we built this for
          </p>
          <h2 className="text-2xl font-semibold mb-3">
            Sales floors and coaching practices
          </h2>
          <p className="text-sm text-slate-300 max-w-2xl mx-auto">
            The wholesale line is built first for one kind of operator — enablement
            and L&amp;D shops serving{' '}
            <strong className="text-white">sales teams</strong> and{' '}
            <strong className="text-white">personal-development coaching practices</strong>{' '}
            in the conviction-led, move-people-to-decide tradition. Your trainees
            rehearse the hesitant prospect, the burned skeptic, and the
            price-and-commitment stall against realistic simulated customers, then
            get scored on how they led. Start from the{' '}
            <Link href="/library" className="text-blue-400 hover:underline">
              Sales &amp; Motivational Coaching demo line
            </Link>
            .
          </p>
        </section>

        {/* Billing note — sourced from the catalog, no hard-coded money */}
        <p className="text-center text-xs text-slate-500 mt-10 max-w-2xl mx-auto">
          {catalog.billing.note} Seats are billed monthly per active trainee.
          Higher tiers include every modality below them. Wholesale rates are set
          per operator agreement — <Link href="/auth/signin" className="text-blue-400 hover:underline">get in touch</Link> to onboard your workspace.
        </p>
      </main>
    </div>
  );
}
