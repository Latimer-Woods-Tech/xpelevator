'use client';

/**
 * Operator self-serve workspace (issue #16, Phase 4, R-052 — advances R-040).
 *
 * The admin surface that turns the operator→client APIs into a usable workspace:
 *   - bootstraps from `GET /api/me` (R-051) to learn the caller's own org + role;
 *   - `operatorWorkspaceView` decides what to render (single source of truth);
 *   - an OPERATOR admin lists + creates the CLIENT orgs beneath them
 *     (`GET`/`POST /api/orgs/[id]/clients`, R-048);
 *   - a STANDALONE admin onboards by creating their first client, which promotes
 *     their org to OPERATOR server-side — this is the "self-serve operator
 *     onboarding" of R-040.
 *
 * The page renders only a shell; every datum comes from an authenticated,
 * tenant-scoped API. The route itself is auth-gated by the middleware matcher
 * (anon → redirect to /auth/signin). No secrets, no cross-tenant reads, and the
 * org copy rule holds (no user-facing "AI").
 */
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import type { SelfContext } from '@/lib/self-context';
import { operatorWorkspaceView, type WorkspaceState } from '@/lib/operator-workspace';

interface ClientOrg {
  id: string;
  name: string;
  slug: string;
  plan: string;
  kind: string;
  parentOrgId: string | null;
  createdAt: string;
  _count?: { users: number; sessions: number };
}

// ─── Shell ───────────────────────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white">
      <div className="max-w-4xl mx-auto px-6 py-12">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold">
            Operator <span className="text-blue-400">workspace</span>
          </h1>
          <Link href="/admin" className="text-sm text-slate-400 hover:text-blue-300 transition-colors">
            ← Admin
          </Link>
        </div>
        {children}
      </div>
    </div>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="bg-slate-800/60 border border-slate-700 rounded-2xl px-6 py-8 text-center">
      <div className="text-lg font-semibold mb-2">{title}</div>
      <p className="text-slate-400 text-sm leading-relaxed max-w-md mx-auto">{body}</p>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function OperatorWorkspacePage() {
  const [view, setView] = useState<WorkspaceState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Bootstrap: who am I, and what may I run here?
  useEffect(() => {
    let cancelled = false;
    fetch('/api/me', { headers: { Accept: 'application/json' } })
      .then(res => {
        if (res.status === 401) throw new Error('unauthenticated');
        if (!res.ok) throw new Error('me-failed');
        return res.json() as Promise<SelfContext>;
      })
      .then(self => {
        if (!cancelled) setView(operatorWorkspaceView(self));
      })
      .catch((err: Error) => {
        if (!cancelled) setLoadError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loadError === 'unauthenticated') {
    return (
      <Shell>
        <Notice
          title="Sign in to continue"
          body="Your session has expired. Sign in again to reach your operator workspace."
        />
        <div className="text-center mt-6">
          <Link
            href="/auth/signin?callbackUrl=/operator"
            className="inline-block px-5 py-3 bg-blue-600 hover:bg-blue-500 rounded-xl text-sm font-semibold transition-colors"
          >
            Sign in
          </Link>
        </div>
      </Shell>
    );
  }

  if (loadError) {
    return (
      <Shell>
        <Notice
          title="Could not load your workspace"
          body="Something went wrong reading your account. Refresh the page, and if it persists contact support."
        />
      </Shell>
    );
  }

  if (view === null) {
    return (
      <Shell>
        <div className="text-slate-400 text-sm text-center py-12">Loading your workspace…</div>
      </Shell>
    );
  }

  if (view.kind === 'ineligible') {
    return (
      <Shell>
        <Notice title="Not an operator workspace" body={view.reason} />
      </Shell>
    );
  }

  if (view.kind === 'platform-admin') {
    return (
      <Shell>
        <Notice
          title="Platform administrator"
          body="You manage every organisation from the admin panel. The operator workspace is scoped to a single operator org."
        />
        <div className="text-center mt-6">
          <Link
            href="/admin"
            className="inline-block px-5 py-3 bg-blue-600 hover:bg-blue-500 rounded-xl text-sm font-semibold transition-colors"
          >
            Open the admin panel
          </Link>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <OperatorClients orgId={view.orgId} isNew={view.isNew} />
    </Shell>
  );
}

// ─── Client-org management ───────────────────────────────────────────────────

function OperatorClients({ orgId, isNew }: { orgId: string; isNew: boolean }) {
  const [clients, setClients] = useState<ClientOrg[] | null>(null);
  const [listError, setListError] = useState(false);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const loadClients = useCallback(() => {
    setListError(false);
    fetch(`/api/orgs/${encodeURIComponent(orgId)}/clients`, {
      headers: { Accept: 'application/json' },
    })
      .then(res => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json() as Promise<ClientOrg[]>;
      })
      .then(rows => setClients(Array.isArray(rows) ? rows : []))
      .catch(() => setListError(true));
  }, [orgId]);

  useEffect(() => {
    loadClients();
  }, [loadClients]);

  const createClient = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch(`/api/orgs/${encodeURIComponent(orgId)}/clients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setCreateError(data?.error ?? `Could not create the client (HTTP ${res.status}).`);
        return;
      }
      setName('');
      loadClients();
    } catch {
      setCreateError('Network error — the client was not created.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="bg-blue-950/40 border border-blue-800/30 rounded-xl px-5 py-4">
        <div className="font-semibold text-blue-200 text-sm">
          {isNew ? 'Become an operator' : 'Your client workspaces'}
        </div>
        <p className="text-slate-400 text-xs mt-1 leading-relaxed">
          {isNew
            ? 'Create your first client workspace to start operating. Each client is an isolated org you own — you buy seats wholesale and set your own retail.'
            : 'The client organisations you own. Each is an isolated workspace with its own trainees, scenarios, and scores.'}
        </p>
      </div>

      {/* Create */}
      <form onSubmit={createClient} className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="New client name (e.g. Northwind Retail)"
          aria-label="New client name"
          className="flex-1 px-4 py-3 rounded-xl bg-slate-800 border border-slate-600 focus:border-blue-500 focus:outline-none text-sm transition-colors"
          required
        />
        <button
          type="submit"
          disabled={creating || !name.trim()}
          className="px-5 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed rounded-xl text-sm font-semibold transition-colors whitespace-nowrap"
        >
          {creating ? 'Creating…' : 'Create client'}
        </button>
      </form>
      {createError ? <p className="text-red-400 text-sm -mt-4">{createError}</p> : null}

      {/* List */}
      {listError ? (
        <p className="text-slate-400 text-sm">Could not load your clients. Refresh to try again.</p>
      ) : clients === null ? (
        <p className="text-slate-400 text-sm">Loading clients…</p>
      ) : clients.length === 0 ? (
        <p className="text-slate-500 text-sm">No client workspaces yet. Create one above to get started.</p>
      ) : (
        <ul className="divide-y divide-slate-800 rounded-2xl bg-slate-800/40 border border-slate-700 overflow-hidden">
          {clients.map(c => (
            <li key={c.id} className="flex items-center justify-between px-5 py-4">
              <div>
                <div className="font-medium text-sm">{c.name}</div>
                <div className="text-slate-500 text-xs mt-0.5">
                  {c.slug} · {c.plan} plan
                </div>
              </div>
              <div className="text-right text-xs text-slate-400">
                <div>{c._count?.users ?? 0} trainees</div>
                <div>{c._count?.sessions ?? 0} sessions</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
