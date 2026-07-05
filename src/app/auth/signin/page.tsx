'use client';

import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { useState, Suspense } from 'react';

function SignInForm() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') ?? '/';

  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [githubLoading, setGithubLoading] = useState(false);

  const handleCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;
    setLoading(true);
    await signIn('credentials', { username: username.trim(), callbackUrl });
    setLoading(false);
  };

  const handleGitHub = async () => {
    setGithubLoading(true);
    await signIn('github', { callbackUrl });
    setGithubLoading(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold mb-2">
            XP<span className="text-blue-400">Elevator</span>
          </h1>
          <p className="text-slate-400 text-sm">Sign in to start your training</p>
        </div>

        {/* GitHub */}
        <button
          onClick={handleGitHub}
          disabled={githubLoading}
          className="w-full flex items-center justify-center gap-3 px-5 py-3 rounded-xl bg-slate-800 border border-slate-600 hover:border-blue-500 transition-all text-sm font-medium mb-6 disabled:opacity-60"
        >
          {/* GitHub SVG mark */}
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.868-.013-1.703-2.782.604-3.369-1.342-3.369-1.342-.454-1.155-1.11-1.463-1.11-1.463-.908-.62.069-.607.069-.607 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.026A9.578 9.578 0 0 1 12 6.836c.85.004 1.705.115 2.504.337 1.909-1.295 2.747-1.026 2.747-1.026.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
          </svg>
          {githubLoading ? 'Redirecting…' : 'Continue with GitHub'}
        </button>

        <div className="flex items-center gap-4 mb-6">
          <div className="flex-1 h-px bg-slate-700" />
          <span className="text-slate-500 text-xs">or use a username</span>
          <div className="flex-1 h-px bg-slate-700" />
        </div>

        {/* Credentials */}
        <form onSubmit={handleCredentials} className="space-y-4">
          <div>
            <label htmlFor="username" className="block text-sm text-slate-400 mb-1">
              Your name
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="e.g. Alex Smith"
              className="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-600 focus:border-blue-500 focus:outline-none text-sm transition-colors"
              required
            />
          </div>
          <button
            type="submit"
            disabled={loading || !username.trim()}
            className="w-full px-5 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed rounded-xl text-sm font-semibold transition-colors"
          >
            {loading ? 'Signing in…' : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
