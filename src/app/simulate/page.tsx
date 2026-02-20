'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface Scenario {
  id: string;
  name: string;
  description: string | null;
  type: 'PHONE' | 'CHAT';
}

interface JobTitle {
  id: string;
  name: string;
  description: string | null;
  scenarios: Scenario[];
}

export default function SimulatePage() {
  const router = useRouter();
  const [jobTitles, setJobTitles] = useState<JobTitle[]>([]);
  const [selectedJob, setSelectedJob] = useState<JobTitle | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  const userId = 'anonymous';

  useEffect(() => {
    loadJobs();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadJobs = () => {
    setLoading(true);
    setFetchError(null);
    fetch('/api/jobs')
      .then(res => {
        if (!res.ok) throw new Error(`Server error ${res.status}`);
        return res.json();
      })
      .then(data => { setJobTitles(data); setLoading(false); })
      .catch((err: unknown) => {
        setFetchError(
          err instanceof Error
            ? err.message
            : 'Failed to load job titles. The database may be waking up — try again in a moment.'
        );
        setLoading(false);
      });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white">
      <div className="max-w-4xl mx-auto px-6 py-12">
        <div className="flex items-center justify-between mb-8">
          <Link href="/" className="text-blue-400 hover:text-blue-300 text-sm">
            &larr; Back to Home
          </Link>

        </div>

        <h1 className="text-3xl font-bold mb-8">Start a Simulation</h1>

        {loading ? (
          <p className="text-slate-400">Loading job titles...</p>
        ) : fetchError ? (
          <div className="text-center py-12">
            <p className="text-2xl mb-3">⚠️</p>
            <p className="text-red-400 mb-2 font-medium">Could not load job titles</p>
            <p className="text-slate-400 text-sm mb-6">{fetchError}</p>
            <button
              onClick={loadJobs}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium transition-colors"
            >
              Retry
            </button>
          </div>
        ) : jobTitles.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-slate-400 mb-4">No job titles configured yet.</p>
            <Link href="/admin" className="text-blue-400 hover:text-blue-300">
              Go to Admin Panel to add job titles &rarr;
            </Link>
          </div>
        ) : (
          <>
            <div className="mb-8">
              <label className="block text-sm font-medium text-slate-300 mb-3">
                Select a Job Title
              </label>
              <select
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-3 text-white focus:border-blue-500 focus:outline-none"
                value={selectedJob?.id || ''}
                onChange={e => {
                  const job = jobTitles.find(j => j.id === e.target.value);
                  setSelectedJob(job || null);
                }}
              >
                <option value="">-- Choose a job title --</option>
                {jobTitles.map(job => (
                  <option key={job.id} value={job.id}>
                    {job.name}
                  </option>
                ))}
              </select>
            </div>

            {selectedJob && (
              <div>
                <h2 className="text-xl font-semibold mb-2">{selectedJob.name}</h2>
                {selectedJob.description && (
                  <p className="text-slate-400 mb-6">{selectedJob.description}</p>
                )}

                {selectedJob.scenarios.length === 0 ? (
                  <p className="text-slate-500">No scenarios available for this job title.</p>
                ) : (
                  <>
                  {startError && (
                    <div className="mb-4 text-red-400 text-sm text-center">{startError}</div>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {selectedJob.scenarios.map(scenario => (
                      <button
                        key={scenario.id}
                        disabled={starting !== null}
                        className="p-6 rounded-xl bg-slate-800/50 border border-slate-700 hover:border-blue-500 transition-all text-left disabled:opacity-60 disabled:cursor-not-allowed"
                        onClick={async () => {
                          setStartError(null);
                          setStarting(scenario.id);
                          try {
                            const res = await fetch('/api/simulations', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                jobTitleId: selectedJob!.id,
                                scenarioId: scenario.id,
                                type: scenario.type,
                                userId: userId,
                              }),
                            });
                            if (!res.ok) throw new Error('Failed to start session');
                            const session = await res.json();
                            router.push(`/simulate/${session.id}`);
                          } catch (err) {
                            setStartError(err instanceof Error ? err.message : 'Failed to start');
                            setStarting(null);
                          }
                        }}
                      >
                        <div className="flex items-center gap-3 mb-2">
                          <span className="text-2xl">
                            {scenario.type === 'PHONE' ? '📞' : '💬'}
                          </span>
                          <span className="text-sm font-medium text-blue-400 uppercase">
                            {scenario.type}
                          </span>
                        </div>
                        <h3 className="font-semibold text-lg">{scenario.name}</h3>
                        {scenario.description && (
                          <p className="text-slate-400 text-sm mt-1">{scenario.description}</p>
                        )}
                        {starting === scenario.id && (
                          <p className="text-blue-400 text-sm mt-2 animate-pulse">Starting...</p>
                        )}
                      </button>
                    ))}
                  </div>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
