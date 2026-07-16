import type { ComponentType } from 'react';
import { auth, signOut } from '@/auth';
import { PageShell, Container, Card, Wordmark } from '@/components/ui';
import { TopNav } from '@/components/ui/TopNav';
import { TargetIcon, BarChartIcon, SettingsIcon, TrendingUpIcon, BuildingIcon } from '@/components/ui/icons';

const CARDS: Array<{
  href: string;
  Icon: ComponentType<{ className?: string }>;
  title: string;
  body: string;
}> = [
  {
    href: '/simulate',
    Icon: TargetIcon,
    title: 'Start Simulation',
    body: 'Select a job title and practice customer interactions via phone or chat.',
  },
  {
    href: '/sessions',
    Icon: BarChartIcon,
    title: 'View Sessions',
    body: 'Review completed simulation sessions, full transcripts, and automated performance scores.',
  },
  {
    href: '/admin',
    Icon: SettingsIcon,
    title: 'Admin Panel',
    body: 'Manage job titles, scenarios, scoring criteria, and job–criteria assignments.',
  },
  {
    href: '/analytics',
    Icon: TrendingUpIcon,
    title: 'Analytics',
    body: 'Track score trends over time, per-criteria performance, and phone vs chat breakdowns.',
  },
  {
    href: '/operator',
    Icon: BuildingIcon,
    title: 'Operator Workspace',
    body: 'Create and manage the client organisations beneath you — buy seats wholesale, set your own retail.',
  },
];

export default async function Home() {
  const session = await auth();
  const user = session?.user;

  async function handleSignOut() {
    'use server';
    await signOut({ redirectTo: '/auth/signin' });
  }

  return (
    <PageShell>
      <TopNav user={user} signOutAction={user ? handleSignOut : undefined} />

      <main>
        <Container className="py-20">
          <div className="mb-16 text-center">
            <h1 className="mb-4 text-5xl font-bold tracking-tight">
              <Wordmark />
            </h1>
            <p className="mx-auto max-w-2xl text-xl text-slate-300">
              Virtual customer simulator for training employees on real-world interactions.
              Practice phone calls and chat conversations, scored against customizable criteria.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {CARDS.map((c) => (
              <a key={c.href} href={c.href} className="group block">
                <Card interactive className="h-full p-8">
                  <c.Icon className="mb-4 h-8 w-8 text-brand-soft" />
                  <h2 className="mb-2 text-xl font-semibold transition-colors group-hover:text-brand-soft">
                    {c.title}
                  </h2>
                  <p className="text-sm text-slate-400">{c.body}</p>
                </Card>
              </a>
            ))}
          </div>
        </Container>
      </main>
    </PageShell>
  );
}
