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

/**
 * Human-facing text label for a score's band (out of 10). Lets a surface convey
 * the band as words, so status is never carried by colour alone — the text
 * alternative an assistive-tech user needs for the score-trend chart, and the
 * "don't rely on colour" fallback anywhere a band is shown (WCAG 1.4.1).
 */
export function scoreBandLabel(score: number): string {
  return {
    strong: 'Strong',
    good: 'Good',
    fair: 'Fair',
    weak: 'Weak',
  }[scoreBand(score)];
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

/**
 * Raw hex for a score bar/fill — the same four bands as {@link scoreBarClass},
 * for surfaces that must colour with an inline `backgroundColor` (an SVG-style
 * bar) rather than a Tailwind class. The values mirror Tailwind's `*-500` shades
 * so a bar coloured here is visually identical to one coloured with the class.
 *
 * This exists so the analytics score-trend chart stops carrying its OWN
 * threshold table: it previously used a divergent 3-tier hex scale (green ≥8 ·
 * yellow ≥5 · red) that disagreed with the canonical 4-tier band on the same
 * surface — a 6.5 rendered yellow in the trend but sky ("good") in every other
 * score readout, exactly the per-page divergence this module was created to
 * kill. One scale, used everywhere — as classes or as hex.
 */
export function scoreBarHex(score: number): string {
  return {
    strong: '#10b981', // emerald-500
    good: '#0ea5e9', // sky-500
    fair: '#f59e0b', // amber-500
    weak: '#f43f5e', // rose-500
  }[scoreBand(score)];
}
