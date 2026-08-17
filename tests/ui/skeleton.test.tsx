/**
 * UI tests for the shared loading-skeleton primitives (P3a-8).
 *
 * The contract these lock in:
 *  - a `Skeleton` bar is decorative (`aria-hidden`) so a screen reader isn't
 *    read a stutter of empty pulsing blocks;
 *  - a `SkeletonScreen` exposes a single polite status region whose accessible
 *    name is the loading label, so assistive tech hears "Loading…" instead of
 *    silence while a surface fills in.
 *
 * Environment: happy-dom
 */
// @vitest-environment happy-dom

/// <reference types="@testing-library/jest-dom" />
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { Skeleton, SkeletonScreen, SkeletonList } from '@/components/ui';

describe('Skeleton primitives', () => {
  it('renders a decorative (aria-hidden) pulsing bar', () => {
    const { container } = render(<Skeleton className="h-4 w-20" />);
    const bar = container.firstChild as HTMLElement;
    // Proof-of-rejection: drop `aria-hidden` on the bar and this fails.
    expect(bar).toHaveAttribute('aria-hidden', 'true');
    expect(bar).toHaveClass('animate-pulse');
    expect(bar).toHaveClass('h-4', 'w-20');
  });

  it('SkeletonScreen announces the loading state via a named status region', () => {
    render(
      <SkeletonScreen label="Loading analytics">
        <Skeleton className="h-4 w-full" />
      </SkeletonScreen>
    );
    // Proof-of-rejection: remove the sr-only label span (or the role) and the
    // status region loses its accessible name — this query fails.
    const status = screen.getByRole('status', { name: /loading analytics/i });
    expect(status).toHaveAttribute('aria-busy', 'true');
  });

  it('SkeletonScreen falls back to a generic "Loading" label', () => {
    render(
      <SkeletonScreen>
        <Skeleton className="h-4 w-full" />
      </SkeletonScreen>
    );
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
  });

  it('SkeletonList renders the requested number of decorative rows under one status', () => {
    const { container } = render(<SkeletonList rows={3} />);
    // Exactly one announcement for the whole list, not one per row.
    expect(screen.getAllByRole('status')).toHaveLength(1);
    // Each row is a bordered surface card (decorative bars live inside).
    const rows = container.querySelectorAll('.border-surface-border');
    expect(rows).toHaveLength(3);
  });
});
