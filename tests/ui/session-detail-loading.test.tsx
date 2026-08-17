/**
 * UI test for the session-detail route-segment loading fallback (P3a-8).
 *
 * The detail page is an async server component that awaits a multi-join Neon
 * query; this `loading.tsx` is the instant Suspense fallback. It must announce
 * the loading state to assistive tech (not render silent pulsing blocks).
 *
 * Environment: happy-dom
 */
// @vitest-environment happy-dom

/// <reference types="@testing-library/jest-dom" />
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import Loading from '@/app/sessions/[id]/loading';

describe('Session-detail loading fallback', () => {
  it('renders a named loading status region', () => {
    render(<Loading />);
    // Proof-of-rejection: a bare pulsing-div fallback (no SkeletonScreen) has
    // no status role — this query fails.
    expect(screen.getByRole('status', { name: /loading session/i })).toBeInTheDocument();
  });
});
