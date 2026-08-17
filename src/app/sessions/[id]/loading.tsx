import { PageShell, Container, Skeleton, SkeletonScreen } from '@/components/ui';

/**
 * Route-segment loading fallback for the session-detail page. The page itself
 * is an async server component that awaits a multi-join Neon query, so this
 * skeleton renders instantly via Suspense while that runs — content-shaped
 * (header, transcript column, score sidebar) so the view doesn't reflow when
 * the real data lands, and announced once to assistive tech by `SkeletonScreen`.
 */
export default function Loading() {
  return (
    <PageShell>
      <Container className="py-12">
        <Skeleton className="mb-8 h-4 w-32" />
        <SkeletonScreen label="Loading session" className="space-y-8">
          {/* Header: title + status + meta */}
          <div className="space-y-3">
            <Skeleton className="h-7 w-72" />
            <Skeleton className="h-4 w-56" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Transcript column */}
            <div className="lg:col-span-2 space-y-3">
              <Skeleton className="mb-1 h-5 w-32" />
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className={i % 2 === 0 ? 'h-12 w-4/5' : 'ml-auto h-12 w-3/5'} />
              ))}
            </div>

            {/* Score sidebar */}
            <div className="space-y-4">
              <div className="rounded-xl border border-surface-border bg-surface p-6 space-y-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-10 w-20" />
              </div>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="rounded-xl border border-surface-border bg-surface p-4 space-y-2">
                  <Skeleton className="h-3 w-28" />
                  <Skeleton className="h-2 w-full" />
                </div>
              ))}
            </div>
          </div>
        </SkeletonScreen>
      </Container>
    </PageShell>
  );
}
