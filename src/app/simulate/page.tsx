'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import type { Scenario, JobTitle } from '@/types';

export default function SimulatePage() {
  const router = useRouter();
  const { data: sessionData } = useSession();
  const userName = sessionData?.user?.name ?? null;

  const [jobTitles, setJobTitles] = useState<JobTitle[]>([]);
  const [selectedJob, setSelectedJob] = useState<JobTitle | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  const userId = sessionData?.user?.id ?? 'anonymous';

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

  const startSimulation = async (scenario: Scenario, typeOverride?: 'CHAT' | 'VOICE' | 'PHONE') => {
    if (!selectedJob) return;
    setStartError(null);
    const launchType = typeOverride ?? scenario.type;
    setStarting(`${scenario.id}-${launchType}`);
    try {
      const res = await fetch('/api/simulations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobTitleId: selectedJob.id,
          scenarioId: scenario.id,
          type: launchType,
          userId,
        }),
      });
      if (!res.ok) throw new Error('Failed to start simulation');
      const sim = await res.json();
      router.push(`/simulate/${sim.id}`);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : 'Failed to start');
      setStarting(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white">
      <div className="max-w-4xl mx-auto px-6 py-12">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-8">
          <Link href="/" className="text-blue-400 hover:text-blue-300 text-sm">
            &larr; Back to Home
          </Link>
          <span className="text-sm text-slate-400">
            Signed in as{' '}
            <span className="font-medium text-white">
              {userName ?? 'Guest'}
            </span>
          </span>
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
            {/* Job title cards */}
            <div className="mb-8">
              <p className="text-sm font-medium text-slate-300 mb-4">Select a Job Title</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {jobTitles.map(job => (
                  <button
                    key={job.id}
                    onClick={() => { setSelectedJob(job); setStartError(null); }}
                    className={`p-5 rounded-xl border text-left transition-all ${
                      selectedJob?.id === job.id
                        ? 'border-blue-500 bg-blue-900/30'
                        : 'border-slate-700 bg-slate-800/50 hover:border-slate-500'
                    }`}
                  >
                    <h3 className="font-semibold text-white mb-1">{job.name}</h3>
                    {job.description && (
                      <p className="text-slate-400 text-sm">{job.description}</p>
                    )}
                    <p className="text-slate-500 text-xs mt-2">
                      {(job.scenarios ?? []).length} scenario{(job.scenarios ?? []).length !== 1 ? 's' : ''}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {/* Scenarios for selected job */}
            {selectedJob && (
              <div>
                <h2 className="text-xl font-semibold mb-4">
                  Scenarios — {selectedJob.name}
                </h2>

                {startError && (
                  <div className="mb-4 text-red-400 text-sm text-center">{startError}</div>
                )}

                {(selectedJob.scenarios ?? []).length === 0 ? (
                  <p className="text-slate-500">
                    No scenarios available for this job title.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {(selectedJob.scenarios ?? []).map(scenario => (
                      <div
                        key={scenario.id}
                        className="p-6 rounded-xl bg-slate-800/50 border border-slate-700"
                      >
                        <div className="flex items-center gap-3 mb-2">
                          <span className="text-2xl">
                            {scenario.type === 'PHONE' ? '📞' : '💬'}
                          </span>
                          <span className="text-xs font-medium uppercase px-2 py-0.5 rounded bg-slate-700 text-blue-300">
                            {scenario.type}
                          </span>
                        </div>
                        <h3 className="font-semibold text-lg mb-1">{scenario.name}</h3>
                        {scenario.description && (
                          <p className="text-slate-400 text-sm mb-4">{scenario.description}</p>
                        )}
                        {scenario.type === 'CHAT' ? (
                          <div className="flex gap-2 mt-2">
                            <button
                              disabled={starting !== null}
                              onClick={() => startSimulation(scenario, 'CHAT')}
                              className="flex-1 py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium transition-colors"
                            >
                              {starting === `${scenario.id}-CHAT` ? 'Starting…' : '💬 Chat'}
                            </button>
                            <button
                              disabled={starting !== null}
                              onClick={() => startSimulation(scenario, 'VOICE')}
                              className="flex-1 py-2 px-3 rounded-lg bg-purple-700 hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium transition-colors"
                              title="Voice mode — uses browser microphone, no phone required"
                            >
                              {starting === `${scenario.id}-VOICE` ? 'Starting…' : '🎙️ Voice'}
                            </button>
                          </div>
                        ) : (
                          <button
                            disabled={starting !== null}
                            onClick={() => startSimulation(scenario)}
                            className="w-full mt-2 py-2 px-4 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium transition-colors"
                          >
                            {starting === `${scenario.id}-${scenario.type}` ? 'Starting…' : 'Start'}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
