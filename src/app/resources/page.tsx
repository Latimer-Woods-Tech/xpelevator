import Link from 'next/link';
import { getPublicPlanCatalog, type SimulationType } from '@/lib/plans';

/**
 * Operator resources — "How the channel model works" (Phase 4, issue #16).
 *
 * An educational / navigational guide for the buyer we build for: the
 * **operator** (training consultancies, agencies, enablement / L&D shops) who
 * owns the end-client relationship, buys trainee seats at wholesale, and resells
 * at their own retail. It explains the channel model the rest of the product
 * already implements — wholesale → your retail, white-label branding, seat
 * tiers, scenario-pack inventory, and the self-serve onboarding path — and
 * points to the surfaces that do the work (`/pricing`, `/library`, `/operator`).
 *
 * This is a guide, not a marketing site: no retail / end-customer copy, no
 * testimonials, no invented figures, and — like `/pricing` — no hard-coded
 * money. Seat-tier names are read from the single source of truth
 * (`src/lib/plans.ts`, the same catalog `GET /api/plans` and `/pricing` serve);
 * wholesale amounts are a founder input held in Stripe, so nothing here prices a
 * seat. The channel-model facts below are sourced from the repo's design spine
 * (`docs/VISION.md`), not asserted independently.
 *
 * Public by design: `/resources` is intentionally absent from the middleware
 * matcher (which gates only /admin, /operator, /api, /simulate, /sessions,
 * /analytics), so logged-out operators evaluating the platform reach it — the
 * same way `/pricing` is public. Copy follows the org rule: the word "AI" never
 * appears on any user-facing surface; the product speaks in craft vocabulary
 * (simulated customers, performance scoring).
 *
 * Content-provenance note: shipped by the Content Factory loop (Factory#1949,
 * Phase 4 operator-collateral lane) as a draft for the XPElevator loop's review,
 * against the constraints it set on issue #16 (channel-first, operator-facing,
 * no retail marketing, no fabricated money, never "AI"). Where this page links
 * from is an IA call the owning loop makes.
 */
export const dynamic = 'force-static';

/** Trainee-facing label for each practice modality (mirrors `/pricing`). */
const MODALITY_LABEL: Record<SimulationType, string> = {
  CHAT: 'Text chat',
  VOICE: 'In-browser voice',
  PHONE: 'Live phone calls',
};

/** The three steps that stand up an operator workspace, in order. */
const ONBOARDING_STEPS: ReadonlyArray<{ title: string; body: React.ReactNode }> = [
  {
    title: 'Create your operator workspace',
    body: (
      <>
        Sign in and create your first client org. Doing so promotes your account
        to an operator — you become the parent that owns the client orgs beneath
        you. This is self-serve; there is no sales gate to open a workspace.
      </>
    ),
  },
  {
    title: 'Stock it with scenario packs',
    body: (
      <>
        An empty workspace has nothing to sell. Import a per-vertical{' '}
        <Link href="/library" className="text-blue-400 hover:underline">
          scenario pack
        </Link>{' '}
        — a role plus a spread of scenarios across difficulty and modality — to
        give your trainees realistic reps on day one. Packs are your inventory;
        each one is a sellable SKU.
      </>
    ),
  },
  {
    title: 'Brand it and invite trainees',
    body: (
      <>
        Apply your own name, logo, and colors so the experience reads as yours,
        create client orgs for the teams you serve, and add trainee seats. Every
        completed session is scored, so managers get a defensible number to coach
        against — the artifact you show your own clients.
      </>
    ),
  },
];

export default function ResourcesPage() {
  const catalog = getPublicPlanCatalog();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white">
      {/* Header bar — mirrors /pricing */}
      <header className="border-b border-slate-800">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between">
          <Link href="/" className="text-sm font-semibold">
            XP<span className="text-blue-400">Elevator</span>
          </Link>
          <nav className="flex items-center gap-4 text-xs">
            <Link href="/pricing" className="text-slate-300 hover:text-blue-300 transition-colors">
              Pricing
            </Link>
            <Link
              href="/auth/signin"
              className="px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-600 transition-colors"
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-16">
        {/* Hero — operator-facing, educational framing */}
        <div className="mb-14">
          <p className="text-xs uppercase tracking-widest text-blue-400 mb-3">
            Operator guide
          </p>
          <h1 className="text-4xl md:text-5xl font-bold mb-4 tracking-tight">
            How the channel model works
          </h1>
          <p className="text-lg text-slate-300">
            XPElevator is built for the operator — a training consultancy, agency,
            or enablement / L&amp;D shop that owns end-client relationships. You buy
            trainee seats at wholesale, brand the experience as your own, and set
            your own retail. This guide walks through how the channel fits
            together and where each piece lives.
          </p>
        </div>

        {/* What you're reselling */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-3">What you resell</h2>
          <p className="text-slate-300 leading-relaxed">
            The product is conversation practice as sellable inventory. A trainee
            runs a simulated customer conversation — a persona with a concealed
            objective and a difficulty — then gets scored out of ten against your
            weighted, per-role criteria. Managers get a repeatable, measurable way
            to let staff do the reps against a difficult customer and get a
            defensible score, instead of role-play that doesn&apos;t scale and
            can&apos;t be scored objectively. That score-backed report is the
            artifact you show your own clients.
          </p>
        </section>

        {/* The channel — wholesale to retail */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-3">Wholesale in, your retail out</h2>
          <p className="text-slate-300 leading-relaxed mb-4">
            You buy seats at wholesale and resell at whatever retail you choose —
            the platform never sells to your end customers directly. A seat is one
            active trainee for one month, billed per active trainee, cancellable
            any time. Metering, invoicing, and rev-share settle automatically
            through the shared billing platform, so once your workspace is stood
            up the collection runs itself.
          </p>
          <p className="text-slate-300 leading-relaxed">
            Wholesale rates are set per operator agreement, so no price is quoted
            on this page. See the{' '}
            <Link href="/pricing" className="text-blue-400 hover:underline">
              seat pricing
            </Link>{' '}
            surface for the tiers and to start onboarding your workspace.
          </p>
        </section>

        {/* Seat tiers — read from the catalog, no money */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-3">Seat tiers</h2>
          <p className="text-slate-300 leading-relaxed mb-6">
            Seats come in three cumulative tiers — each higher tier includes every
            practice modality of the tiers below it. You choose which tier each of
            your client orgs runs on.
          </p>
          <ol className="space-y-4">
            {catalog.tiers.map((tier) => (
              <li
                key={tier.id}
                className="rounded-xl border border-slate-700 bg-slate-800/50 p-5"
              >
                <div className="flex items-baseline justify-between mb-2">
                  <h3 className="text-lg font-semibold">{tier.name}</h3>
                  <span className="text-[11px] uppercase tracking-wide text-slate-400">
                    Seat tier
                  </span>
                </div>
                <p className="text-sm text-slate-400 mb-3">{tier.description}</p>
                <ul className="flex flex-wrap gap-2">
                  {tier.modalities.map((m) => (
                    <li
                      key={m}
                      className="text-xs px-2.5 py-1 rounded-full bg-blue-950/50 border border-blue-800/60 text-slate-200"
                    >
                      {MODALITY_LABEL[m]}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          <p className="text-xs text-slate-400 mt-4">{catalog.billing.note}</p>
        </section>

        {/* White-label */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-3">Make it yours</h2>
          <p className="text-slate-300 leading-relaxed">
            Each operator workspace carries its own brand — name, logo, and colors
            — so trainees see your identity, not the platform&apos;s. You create
            and manage the client orgs beneath you, and the client-facing surfaces
            exist to make you look good, not to acquire retail customers.
          </p>
        </section>

        {/* Scenario packs as inventory */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-3">Scenario packs are your inventory</h2>
          <p className="text-slate-300 leading-relaxed">
            Per-vertical scenario packs give a brand-new workspace something to
            sell on day one. A pack bundles a role with a spread of scenarios
            across difficulty and modality; importing one materializes ready-to-run
            practice for your trainees. Browse the starter{' '}
            <Link href="/library" className="text-blue-400 hover:underline">
              scenario library
            </Link>{' '}
            to see what a pack contains — the trainee-facing summary only; the
            hidden mechanics that make each scenario work stay out of view.
          </p>
        </section>

        {/* Getting started — navigational */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-6">Getting started</h2>
          <ol className="space-y-6">
            {ONBOARDING_STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-4">
                <span
                  aria-hidden="true"
                  className="flex-none w-8 h-8 rounded-full bg-blue-700 text-white text-sm font-semibold flex items-center justify-center"
                >
                  {i + 1}
                </span>
                <div>
                  <h3 className="text-lg font-semibold mb-1">{step.title}</h3>
                  <p className="text-sm text-slate-300 leading-relaxed">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* Closing pointer — navigational, no CTA fluff */}
        <section className="rounded-xl border border-blue-800/60 bg-blue-950/30 p-8">
          <h2 className="text-xl font-semibold mb-2">Ready to stand up a workspace?</h2>
          <p className="text-sm text-slate-300 mb-5">
            Review the seat tiers on the pricing page, then sign in to create your
            operator workspace and its first client org.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/pricing"
              className="text-sm font-medium px-4 py-2.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white transition-colors"
            >
              View seat pricing
            </Link>
            <Link
              href="/auth/signin"
              className="text-sm font-medium px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors"
            >
              Sign in to onboard
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
