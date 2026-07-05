export default function Loading() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white">
      <div className="max-w-4xl mx-auto px-6 py-12">
        <div className="h-4 bg-slate-800 rounded w-24 mb-8 animate-pulse" />
        <div className="h-8 bg-slate-800 rounded w-56 mb-8 animate-pulse" />
        <div className="h-12 bg-slate-800 rounded w-full mb-8 animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 animate-pulse">
              <div className="h-6 bg-slate-700 rounded w-8 mb-3" />
              <div className="h-5 bg-slate-700 rounded w-36 mb-2" />
              <div className="h-4 bg-slate-700 rounded w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
