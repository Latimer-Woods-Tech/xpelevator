/**
 * Single source of truth for score → color mapping.
 *
 * Previously each page reimplemented this with DIFFERENT thresholds — a 4-tier
 * scale on the active-session summary vs a 3-tier scale on the sessions list and
 * analytics — so the same /10 score rendered a different color depending on
 * which screen you were on. For a product whose whole value is a trustworthy
 * score, that inconsistency quietly undermines it. One scale, used everywhere.
 *
 * Bands (out of 10): >=8 strong · >=6 good · >=4 fair · else weak.
 * Pure and dependency-free.
 */

export type ScoreBand = 'strong' | 'good' | 'fair' | 'weak';

export function scoreBand(score: number): ScoreBand {
  if (score >= 8) return 'strong';
  if (score >= 6) return 'good';
  if (score >= 4) return 'fair';
  return 'weak';
}

/** Tailwind text color class for a score. */
export function scoreTextClass(score: number): string {
  return {
    strong: 'text-emerald-400',
    good: 'text-sky-400',
    fair: 'text-amber-400',
    weak: 'text-rose-400',
  }[scoreBand(score)];
}

/** Tailwind background color class for a score bar/fill. */
export function scoreBarClass(score: number): string {
  return {
    strong: 'bg-emerald-500',
    good: 'bg-sky-500',
    fair: 'bg-amber-500',
    weak: 'bg-rose-500',
  }[scoreBand(score)];
}
