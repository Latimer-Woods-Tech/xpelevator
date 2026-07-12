/**
 * Shared UI kit.
 *
 * Extracted so the gradient shell, card, button, badge, and score bar stop
 * being hand-copied (with drifting classes) across ~15 pages. Everything is
 * token-driven (see globals.css) so a re-skin / white-label flows through here.
 *
 * These are intentionally tiny, dependency-free presentational components — no
 * client state — so they work in both server and client components.
 */
import React from 'react';
import Link from 'next/link';
import { scoreTextClass, scoreBarClass } from '@/lib/score-color';

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** The XPElevator wordmark — one definition instead of five hand-rolled copies. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx('font-semibold tracking-tight', className)}>
      XP<span className="text-brand-soft">Elevator</span>
    </span>
  );
}

/** Full-height gradient page background. */
export function PageShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('app-gradient min-h-dvh text-foreground', className)}>{children}</div>
  );
}

/** Centered content column with consistent horizontal padding. */
export function Container({
  children,
  className,
  size = 'md',
}: {
  children: React.ReactNode;
  className?: string;
  size?: 'md' | 'lg';
}) {
  return (
    <div
      className={cx(
        'mx-auto px-6',
        size === 'lg' ? 'max-w-5xl' : 'max-w-4xl',
        className
      )}
    >
      {children}
    </div>
  );
}

/** Surface card. Set `interactive` for hover affordance (links/buttons). */
export function Card({
  children,
  className,
  interactive = false,
}: {
  children: React.ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <div
      className={cx(
        'rounded-xl border border-surface-border bg-surface',
        interactive &&
          'transition-all hover:border-brand hover:shadow-lg hover:shadow-brand/10',
        className
      )}
    >
      {children}
    </div>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
type ButtonSize = 'sm' | 'md';

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand hover:bg-brand-strong text-brand-contrast',
  secondary: 'bg-slate-700 hover:bg-slate-600 text-foreground',
  danger: 'bg-rose-800/70 hover:bg-rose-700/70 text-foreground',
  ghost: 'bg-transparent hover:bg-slate-800 text-slate-300',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'text-xs px-3 py-1.5',
  md: 'text-sm px-4 py-2',
};

function buttonClass(variant: ButtonVariant, size: ButtonSize, className?: string) {
  return cx(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className);
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  ref?: React.Ref<HTMLButtonElement>;
}) {
  // React 19 ref-as-prop — `ref` flows through {...props} to the button.
  return <button className={buttonClass(variant, size, className)} {...props} />;
}

/** A Link styled as a button (same variants). */
export function ButtonLink({
  href,
  variant = 'primary',
  size = 'md',
  className,
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)}>
      {children}
    </Link>
  );
}

type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-slate-700 text-slate-200',
  brand: 'bg-brand/20 text-brand-soft',
  success: 'bg-emerald-500/20 text-emerald-300',
  warning: 'bg-amber-500/20 text-amber-300',
  danger: 'bg-rose-500/20 text-rose-300',
};

export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cx(
        'inline-block rounded px-2 py-0.5 text-xs font-medium',
        BADGE_TONES[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

/**
 * Horizontal score bar with a consistent color scale (see score-color.ts).
 * `max` defaults to 10. Announces its value to assistive tech.
 */
export function ScoreBar({
  score,
  max = 10,
  showValue = true,
  className,
}: {
  score: number;
  max?: number;
  showValue?: boolean;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, (score / max) * 100));
  return (
    <div className={cx('flex items-center gap-2', className)}>
      <div
        className="h-2 flex-1 overflow-hidden rounded-full bg-slate-700"
        role="meter"
        aria-valuenow={Math.round(score * 10) / 10}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={`Score ${score.toFixed(1)} out of ${max}`}
      >
        <div className={cx('h-full rounded-full', scoreBarClass(score))} style={{ width: `${pct}%` }} />
      </div>
      {showValue && (
        <span className={cx('w-10 shrink-0 text-right text-sm font-semibold', scoreTextClass(score))}>
          {score.toFixed(1)}
        </span>
      )}
    </div>
  );
}
