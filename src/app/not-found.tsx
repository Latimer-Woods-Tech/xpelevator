import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white flex items-center justify-center">
      <div className="text-center max-w-md px-6">
        <div className="text-6xl font-bold text-slate-700 mb-4">404</div>
        <h1 className="text-2xl font-bold mb-3">Page Not Found</h1>
        <p className="text-slate-400 mb-6 text-sm">
          This page doesn&apos;t exist or has been moved.
        </p>
        <Link
          href="/"
          className="bg-blue-600 hover:bg-blue-500 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors inline-block"
        >
          Go Home
        </Link>
      </div>
    </div>
  );
}
