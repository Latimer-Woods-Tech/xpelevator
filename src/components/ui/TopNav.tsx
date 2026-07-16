/**
 * Persistent top navigation.
 *
 * Replaces the per-page hand-rolled headers and the eight "← Back to Home"
 * links, and removes the "bounce through Home to get anywhere" dead-end: every
 * primary section is reachable from here. Presentational — the caller passes
 * the current user and a sign-out server action.
 */
import React from 'react';
import Link from 'next/link';
import { Wordmark, Button, ButtonLink } from './index';

export interface TopNavUser {
  name?: string | null;
}

const SECTIONS: Array<{ href: string; label: string }> = [
  { href: '/simulate', label: 'Practice' },
  { href: '/sessions', label: 'Sessions' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/admin', label: 'Admin' },
  { href: '/pricing', label: 'Pricing' },
];

export function TopNav({
  user,
  signOutAction,
}: {
  user?: TopNavUser | null;
  signOutAction?: () => void | Promise<void>;
}) {
  return (
    <header className="border-b border-surface-border">
      <nav className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-3">
        <div className="flex items-center gap-6">
          <Link href="/" aria-label="XPElevator home">
            <Wordmark className="text-sm" />
          </Link>
          <div className="hidden items-center gap-1 sm:flex">
            {SECTIONS.map((s) => (
              <Link
                key={s.href}
                href={s.href}
                className="rounded-lg px-3 py-1.5 text-xs text-slate-300 transition-colors hover:bg-slate-800 hover:text-foreground"
              >
                {s.label}
              </Link>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {user ? (
            <>
              <span className="hidden text-sm text-slate-300 sm:inline">
                {user.name}
              </span>
              {signOutAction && (
                <form action={signOutAction}>
                  <Button type="submit" variant="danger" size="sm">
                    Sign out
                  </Button>
                </form>
              )}
            </>
          ) : (
            <ButtonLink href="/auth/signin" variant="primary" size="sm">
              Sign in
            </ButtonLink>
          )}
        </div>
      </nav>
    </header>
  );
}
