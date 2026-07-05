'use client';

import Link from 'next/link';
import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[app error]', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white flex items-center justify-center">
      <div className="text-center max-w-md px-6">
        <div className="text-5xl mb-6">⚠️</div>
        <h1 className="text-2xl font-bold mb-3">Something went wrong</h1>
        <p className="text-slate-400 mb-6 text-sm">
          {error.message || 'An unexpected error occurred. Please try again.'}
        </p>
        <div className="flex gap-4 justify-center">
          <button
            onClick={reset}
            className="bg-blue-600 hover:bg-blue-500 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
          >
            Try Again
          </button>
          <Link
            href="/"
            className="border border-slate-600 hover:border-slate-400 text-slate-300 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
          >
            Go Home
          </Link>
        </div>
      </div>
    </div>
  );
}
