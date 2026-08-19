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
import type { Branding } from '@/lib/branding';
import { brandingToForm, validateBrandingForm, type BrandingForm } from '@/lib/branding-form';
import { ORG_PLANS, tierForPlan, getSeatTier, type OrgPlan } from '@/lib/plans';
import {
  tierLines,
  hasSeatUsage,
  orgDisplayName,
  type SeatUsageApiResponse,
} from '@/lib/seat-usage-view';

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
      <div className="space-y-12">
        <OperatorClients orgId={view.orgId} isNew={view.isNew} />
        <SeatUsagePanel isNew={view.isNew} />
        <BrandingEditor orgId={view.orgId} />
      </div>
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
  // Optional report date window (the operator's "monthly cut", R-065). Empty =
  // all-time. Threaded onto every export link below via `withWindow`; the server
  // validates the dates and narrows the report to sessions completed in-range.
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');

  // Append the current `?since`/`?until` window to a report URL (all report URLs
  // already carry a query string, so `&` is always correct here).
  const withWindow = useCallback(
    (url: string): string => {
      const parts = [
        since ? `since=${encodeURIComponent(since)}` : '',
        until ? `until=${encodeURIComponent(until)}` : '',
      ].filter(Boolean);
      return parts.length ? `${url}&${parts.join('&')}` : url;
    },
    [since, until]
  );

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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-semibold text-blue-200 text-sm">
              {isNew ? 'Become an operator' : 'Your client workspaces'}
            </div>
            <p className="text-slate-400 text-xs mt-1 leading-relaxed">
              {isNew
                ? 'Create your first client workspace to start operating. Each client is an isolated org you own — you buy seats wholesale and set your own retail.'
                : 'The client organisations you own. Each is an isolated workspace with its own trainees, scenarios, and scores.'}
            </p>
          </div>
          {/* Portfolio roll-up — every client's sessions in one export, labelled
              by org. Server-scoped by `resolveOperatorRollup` to this operator's
              own clients. Only meaningful once at least one client exists. The
              Summary pair collapses it to one totals row per client (+ portfolio
              grand total). */}
          {!isNew && clients !== null && clients.length > 0 ? (
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-slate-400 text-xs mr-1">All clients</span>
              <a
                href={withWindow('/api/reports/sessions?scope=clients')}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs font-medium transition-colors"
                title="Download every client's sessions as one CSV"
              >
                CSV
              </a>
              <a
                href={withWindow('/api/reports/sessions?scope=clients&format=pdf')}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs font-medium transition-colors"
                title="Download every client's sessions as one PDF"
              >
                PDF
              </a>
              <span className="text-slate-400 text-xs mx-1">Summary</span>
              <a
                href={withWindow('/api/reports/sessions?scope=clients&view=summary')}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs font-medium transition-colors"
                title="Download per-client totals (one row per client) as CSV"
              >
                CSV
              </a>
              <a
                href={withWindow('/api/reports/sessions?scope=clients&view=summary&format=pdf')}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs font-medium transition-colors"
                title="Download per-client totals (one row per client) as PDF"
              >
                PDF
              </a>
            </div>
          ) : null}
        </div>
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

      {/* Report date window — the "monthly cut" (R-065). Applies to every export
          link (portfolio + per-client) via `withWindow`. Empty = all-time. */}
      {!isNew && clients !== null && clients.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
          <span className="text-slate-400">Report window</span>
          <label className="flex items-center gap-1.5">
            <span className="sr-only">From date</span>
            <input
              type="date"
              value={since}
              max={until || undefined}
              onChange={e => setSince(e.target.value)}
              aria-label="Report from date"
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-600 focus:border-blue-500 focus:outline-none text-slate-200 transition-colors"
            />
          </label>
          <span className="text-slate-400">to</span>
          <label className="flex items-center gap-1.5">
            <span className="sr-only">To date</span>
            <input
              type="date"
              value={until}
              min={since || undefined}
              onChange={e => setUntil(e.target.value)}
              aria-label="Report to date"
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-600 focus:border-blue-500 focus:outline-none text-slate-200 transition-colors"
            />
          </label>
          {since || until ? (
            <button
              type="button"
              onClick={() => {
                setSince('');
                setUntil('');
              }}
              className="px-2.5 py-1.5 rounded-lg border border-slate-700 hover:border-slate-500 text-slate-400 hover:text-slate-200 transition-colors"
            >
              Clear
            </button>
          ) : (
            <span className="text-slate-400">all-time</span>
          )}
        </div>
      ) : null}

      {/* List */}
      {listError ? (
        <p className="text-slate-400 text-sm">Could not load your clients. Refresh to try again.</p>
      ) : clients === null ? (
        <p className="text-slate-400 text-sm">Loading clients…</p>
      ) : clients.length === 0 ? (
        <p className="text-slate-400 text-sm">No client workspaces yet. Create one above to get started.</p>
      ) : (
        <ul className="divide-y divide-slate-800 rounded-2xl bg-slate-800/40 border border-slate-700 overflow-hidden">
          {clients.map(c => (
            <ClientRow key={c.id} client={c} withWindow={withWindow} onChanged={loadClients} />
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── One client row ──────────────────────────────────────────────────────────

/** A plan option in the seat-tier selector: the persisted `OrgPlan` value and
 * the human seat-tier name it entitles trainees to (FREE → Chat, PRO → Voice,
 * ENTERPRISE → Phone). Derived from `plans.ts` so the label never re-encodes the
 * plan→tier mapping the server gate reads. */
function seatOptionLabel(plan: OrgPlan): string {
  return `${plan} · ${getSeatTier(tierForPlan(plan))?.name ?? plan} seat`;
}

/**
 * A single client workspace: identity, its allocated seat tier, usage counts,
 * a seat-tier allocation control, and the per-client report links.
 *
 * The seat-tier selector is the operator's allocation control — the "manage"
 * verb the channel model needs on top of create/list. It PUTs the client's
 * `plan` to `PUT /api/orgs/[id]`, authorised server-side by `canSetOrgPlan`: an
 * operator admin may set the plan of a CLIENT they own, never their own org and
 * never another operator's client. Re-tiering re-scopes every entitlement gate
 * the client's trainees hit (chat → +voice → +phone). On success the parent
 * reloads the list; a failed PUT leaves the (controlled) select on the persisted
 * value and shows why. Wholesale metering/invoicing stays a later, founder-gated
 * slice (Phase 4 item 2) — this only surfaces the allocation the API already
 * permits.
 */
function ClientRow({
  client,
  withWindow,
  onChanged,
}: {
  client: ClientOrg;
  withWindow: (url: string) => string;
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  // Rename: an inline editor toggled open from the row. `draftName` seeds from
  // the persisted name; a failed PUT leaves the editor open with the reason.
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(client.name);
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  // Delete: a two-step confirm (the action is irreversible and the server
  // refuses it with 409 once the client has recorded sessions).
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const tierName = getSeatTier(tierForPlan(client.plan))?.name ?? 'Chat';

  const changePlan = async (plan: OrgPlan) => {
    if (plan === client.plan || saving) return;
    setSaving(true);
    setPlanError(null);
    try {
      const res = await fetch(`/api/orgs/${encodeURIComponent(client.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setPlanError(data?.error ?? `Could not change the seat tier (HTTP ${res.status}).`);
        return;
      }
      onChanged();
    } catch {
      setPlanError('Network error — the seat tier was not changed.');
    } finally {
      setSaving(false);
    }
  };

  // Rename the client via `PUT /api/orgs/[id] { name }` — authorised server-side
  // by `canAccessOrg` (an operator admin may rename a CLIENT they own). A no-op
  // (blank or unchanged) just closes the editor; on success the parent reloads.
  const saveName = async () => {
    const trimmed = draftName.trim();
    if (renameSaving) return;
    if (!trimmed || trimmed === client.name) {
      setRenaming(false);
      setRenameError(null);
      setDraftName(client.name);
      return;
    }
    setRenameSaving(true);
    setRenameError(null);
    try {
      const res = await fetch(`/api/orgs/${encodeURIComponent(client.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setRenameError(data?.error ?? `Could not rename the client (HTTP ${res.status}).`);
        return;
      }
      setRenaming(false);
      onChanged();
    } catch {
      setRenameError('Network error — the client was not renamed.');
    } finally {
      setRenameSaving(false);
    }
  };

  // Delete the client via `DELETE /api/orgs/[id]` — authorised server-side by
  // `canDeleteOrg` (only the parent operator or a platform admin). The route
  // refuses with 409 while the client still has recorded sessions, so the
  // returned error is surfaced verbatim and the row stays. 204 → the row is
  // gone on the parent's reload.
  const deleteClient = async () => {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/orgs/${encodeURIComponent(client.id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setDeleteError(data?.error ?? `Could not delete the client (HTTP ${res.status}).`);
        setConfirmingDelete(false);
        return;
      }
      onChanged();
    } catch {
      setDeleteError('Network error — the client was not deleted.');
      setConfirmingDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
      <div>
        {renaming ? (
          <form
            onSubmit={e => {
              e.preventDefault();
              void saveName();
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={draftName}
              autoFocus
              disabled={renameSaving}
              onChange={e => setDraftName(e.target.value)}
              aria-label={`New name for ${client.name}`}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-600 focus:border-blue-500 focus:outline-none text-sm text-slate-200 disabled:opacity-60 transition-colors"
            />
            <button
              type="submit"
              disabled={renameSaving}
              className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-xs font-medium transition-colors"
            >
              {renameSaving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              disabled={renameSaving}
              onClick={() => {
                setRenaming(false);
                setRenameError(null);
                setDraftName(client.name);
              }}
              className="px-2.5 py-1.5 rounded-lg border border-slate-700 hover:border-slate-500 text-slate-400 hover:text-slate-200 text-xs transition-colors"
            >
              Cancel
            </button>
          </form>
        ) : (
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{client.name}</span>
            <button
              type="button"
              onClick={() => {
                setDraftName(client.name);
                setRenameError(null);
                setRenaming(true);
              }}
              aria-label={`Rename ${client.name}`}
              className="text-xs text-slate-400 hover:text-blue-300 transition-colors"
            >
              Rename
            </button>
          </div>
        )}
        <div className="text-slate-400 text-xs mt-0.5">
          {client.slug} · {tierName} seat
        </div>
        {planError ? <p className="text-red-400 text-xs mt-1">{planError}</p> : null}
        {renameError ? <p className="text-red-400 text-xs mt-1">{renameError}</p> : null}
        {deleteError ? <p className="text-red-400 text-xs mt-1">{deleteError}</p> : null}
      </div>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2">
          <span className="sr-only">{`Seat tier for ${client.name}`}</span>
          <select
            value={client.plan}
            disabled={saving}
            onChange={e => {
              void changePlan(e.target.value as OrgPlan);
            }}
            aria-label={`Seat tier for ${client.name}`}
            className="px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-600 focus:border-blue-500 focus:outline-none text-slate-200 text-xs disabled:opacity-60 transition-colors"
          >
            {ORG_PLANS.map(p => (
              <option key={p} value={p}>
                {seatOptionLabel(p)}
              </option>
            ))}
          </select>
        </label>
        <div className="text-right text-xs text-slate-400">
          <div>{client._count?.users ?? 0} trainees</div>
          <div>{client._count?.sessions ?? 0} sessions</div>
        </div>
        {/* The per-client report — the artifact the operator shows this
            client. Scoped server-side by `canAccessOrgReport`. */}
        <div className="flex items-center gap-2">
          <a
            href={withWindow(`/api/reports/sessions?clientOrgId=${encodeURIComponent(client.id)}`)}
            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs font-medium transition-colors"
            title={`Download ${client.name} sessions as CSV`}
          >
            CSV
          </a>
          <a
            href={withWindow(`/api/reports/sessions?clientOrgId=${encodeURIComponent(client.id)}&format=pdf`)}
            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs font-medium transition-colors"
            title={`Download ${client.name} sessions as PDF`}
          >
            PDF
          </a>
        </div>
        {/* Delete — the destructive half of the "manage" verb. Two-step confirm;
            the server refuses (409) while the client still has sessions. */}
        {confirmingDelete ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={deleting}
              onClick={() => void deleteClient()}
              aria-label={`Confirm delete ${client.name}`}
              className="px-3 py-1.5 bg-red-600 hover:bg-red-500 disabled:opacity-60 rounded-lg text-xs font-medium transition-colors"
            >
              {deleting ? 'Deleting…' : 'Confirm'}
            </button>
            <button
              type="button"
              disabled={deleting}
              onClick={() => setConfirmingDelete(false)}
              className="px-3 py-1.5 border border-slate-700 hover:border-slate-500 text-slate-400 hover:text-slate-200 rounded-lg text-xs transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setDeleteError(null);
              setConfirmingDelete(true);
            }}
            aria-label={`Delete ${client.name}`}
            className="px-3 py-1.5 border border-red-900/60 text-red-300 hover:bg-red-950/40 rounded-lg text-xs font-medium transition-colors"
          >
            Delete
          </button>
        )}
      </div>
    </li>
  );
}

// ─── Seat usage meter ────────────────────────────────────────────────────────

/**
 * The operator's seat meter (issue #16, Phase 4 item 2 — the transparency half
 * of the "vending machine").
 *
 * Reads the metered INVOICE BASIS from `GET /api/reports/seats?scope=clients` —
 * the portfolio roll-up of distinct active trainees (billable seats), bucketed
 * into their billable tier (Chat → Voice → Phone), per client org and summed
 * across the operator's book. That endpoint is ADMIN-only and tenant-scoped
 * server-side (`resolveOperatorRollup`), so this panel never widens access; it
 * only surfaces the number the operator will be invoiced on.
 *
 * It shows COUNTS only — no price. Wholesale amounts live in Stripe behind the
 * 🔒 live-mode founder gate; the seat meter is left of that gate, so an operator
 * can see exactly what their usage totals to before any billing goes live.
 *
 * A brand-new operator (no clients yet) has no metered usage, so the panel is
 * skipped entirely for them.
 */
function SeatUsagePanel({ isNew }: { isNew: boolean }) {
  const [report, setReport] = useState<SeatUsageApiResponse | null>(null);
  const [loadError, setLoadError] = useState(false);
  // Billing window — the operator's "monthly cut" (R-065), same contract as the
  // session reports. Empty = all-time. The server validates the dates and
  // narrows the meter to seats active in-range.
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');

  const load = useCallback(() => {
    setLoadError(false);
    setReport(null);
    const parts = [
      since ? `since=${encodeURIComponent(since)}` : '',
      until ? `until=${encodeURIComponent(until)}` : '',
    ].filter(Boolean);
    const url = `/api/reports/seats?scope=clients${parts.length ? `&${parts.join('&')}` : ''}`;
    fetch(url, { headers: { Accept: 'application/json' } })
      .then(res => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json() as Promise<SeatUsageApiResponse>;
      })
      .then(data => setReport(data))
      .catch(() => setLoadError(true));
  }, [since, until]);

  useEffect(() => {
    // A brand-new operator has no clients beneath them yet — nothing to meter.
    if (!isNew) load();
  }, [isNew, load]);

  if (isNew) return null;

  const totalLines = tierLines(report?.totals?.seatsByTier);

  return (
    <div className="space-y-6">
      <div className="bg-blue-950/40 border border-blue-800/30 rounded-xl px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-semibold text-blue-200 text-sm">Seat usage</div>
            <p className="text-slate-400 text-xs mt-1 leading-relaxed max-w-md">
              Active trainee seats across your client workspaces — the basis you
              are billed on. One seat is a trainee who completed at least one
              session in the window, counted at the highest tier they practised
              (Chat → Voice → Phone).
            </p>
          </div>
          {/* Billing window — the "monthly cut". Empty = all-time. */}
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 shrink-0">
            <span className="text-slate-400">Window</span>
            <label className="flex items-center gap-1.5">
              <span className="sr-only">Seat usage from date</span>
              <input
                type="date"
                value={since}
                max={until || undefined}
                onChange={e => setSince(e.target.value)}
                aria-label="Seat usage from date"
                className="px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-600 focus:border-blue-500 focus:outline-none text-slate-200 transition-colors"
              />
            </label>
            <span className="text-slate-400">to</span>
            <label className="flex items-center gap-1.5">
              <span className="sr-only">Seat usage to date</span>
              <input
                type="date"
                value={until}
                min={since || undefined}
                onChange={e => setUntil(e.target.value)}
                aria-label="Seat usage to date"
                className="px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-600 focus:border-blue-500 focus:outline-none text-slate-200 transition-colors"
              />
            </label>
            {since || until ? (
              <button
                type="button"
                onClick={() => {
                  setSince('');
                  setUntil('');
                }}
                className="px-2.5 py-1.5 rounded-lg border border-slate-700 hover:border-slate-500 text-slate-400 hover:text-slate-200 transition-colors"
              >
                Clear
              </button>
            ) : (
              <span className="text-slate-400">all-time</span>
            )}
          </div>
        </div>
      </div>

      {loadError ? (
        <p className="text-slate-400 text-sm">
          Could not load seat usage. Refresh to try again.
        </p>
      ) : report === null ? (
        <p className="text-slate-400 text-sm">Loading seat usage…</p>
      ) : !hasSeatUsage(report) ? (
        <p className="text-slate-400 text-sm">
          No metered seat usage in this window. Seats appear here once your
          clients’ trainees complete sessions.
        </p>
      ) : (
        <div className="space-y-5">
          {/* Portfolio totals — the invoice basis. */}
          <div className="rounded-2xl bg-slate-800/40 border border-slate-700 px-5 py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-slate-300 text-sm font-medium">
                Billable seats (all clients)
              </span>
              <span className="text-2xl font-bold text-blue-300">
                {report.totals.activeSeats}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-4">
              {totalLines.map(line => (
                <div key={line.id} className="text-xs text-slate-400">
                  <span className="text-slate-300 font-medium">{line.seats}</span>{' '}
                  {line.name}
                </div>
              ))}
            </div>
          </div>

          {report.truncated ? (
            <p className="text-amber-400/80 text-xs">
              Showing a capped slice of usage — narrow the window for an exact
              count.
            </p>
          ) : null}

          {/* Per-client seat rows. */}
          <ul className="divide-y divide-slate-800 rounded-2xl bg-slate-800/40 border border-slate-700 overflow-hidden">
            {report.perOrg.map((row, i) => (
              <li
                key={row.orgId ?? `unassigned-${i}`}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
              >
                <div>
                  <div className="font-medium text-sm">{orgDisplayName(row)}</div>
                  <div className="text-slate-400 text-xs mt-0.5">
                    {tierLines(row.seatsByTier)
                      .filter(l => l.seats > 0)
                      .map(l => `${l.seats} ${l.name}`)
                      .join(' · ') || 'no billable seats'}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-base font-semibold text-blue-300">
                    {row.activeSeats}
                  </div>
                  <div className="text-slate-400 text-xs">
                    {row.activeSeats === 1 ? 'seat' : 'seats'}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Branding editor ─────────────────────────────────────────────────────────

const HEX6 = /^#[0-9a-fA-F]{6}$/;

/** A color field: a native swatch picker kept in sync with a free-text hex
 * input, so an operator can either pick or paste a `#rrggbb` value (or clear
 * it). The swatch falls back to a neutral value when the text is not yet a
 * valid hex, so it never throws on a partial entry. */
function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const swatch = HEX6.test(value) ? value : '#1e293b';
  return (
    <div className="block">
      <span className="text-slate-300 text-sm">{label}</span>
      <div className="mt-1 flex items-center gap-3">
        <input
          type="color"
          aria-label={`${label} swatch`}
          value={swatch}
          onChange={e => onChange(e.target.value)}
          className="h-11 w-12 shrink-0 rounded-lg bg-slate-800 border border-slate-600 cursor-pointer p-1"
        />
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="#2563eb"
          aria-label={label}
          className="flex-1 px-4 py-3 rounded-xl bg-slate-800 border border-slate-600 focus:border-blue-500 focus:outline-none text-sm transition-colors"
        />
      </div>
    </div>
  );
}

/**
 * The in-workspace brand editor (R-049). Loads the operator org's current
 * white-label brand from `GET /api/orgs/[id]/branding`, lets an admin edit
 * name / logo / colors, validates client-side with the SAME normalizers the
 * server enforces (`validateBrandingForm`), and saves via `PUT`. A blank field
 * clears that field (falls back to the platform default). The API re-validates
 * and is the sole authority — this shell never widens access.
 */
function BrandingEditor({ orgId }: { orgId: string }) {
  const [form, setForm] = useState<BrandingForm | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/orgs/${encodeURIComponent(orgId)}/branding`, {
      headers: { Accept: 'application/json' },
    })
      .then(res => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json() as Promise<Branding>;
      })
      .then(b => {
        if (!cancelled) setForm(brandingToForm(b));
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const update = (key: keyof BrandingForm, value: string) => {
    setForm(prev => (prev ? { ...prev, [key]: value } : prev));
    setSaved(false);
    setSaveError(null);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form || saving) return;
    const result = validateBrandingForm(form);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/orgs/${encodeURIComponent(orgId)}/branding`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result.body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setSaveError(data?.error ?? `Could not save your brand (HTTP ${res.status}).`);
        return;
      }
      const updated = (await res.json()) as Branding;
      setForm(brandingToForm(updated));
      setSaved(true);
    } catch {
      setSaveError('Network error — your brand was not saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-6">
      <div className="bg-blue-950/40 border border-blue-800/30 rounded-xl px-5 py-4">
        <div className="font-semibold text-blue-200 text-sm">Your brand</div>
        <p className="text-slate-400 text-xs mt-1 leading-relaxed">
          Set the name, logo, and colors your clients see on the sign-in and workspace screens.
          Leave a field blank to use the platform default.
        </p>
      </div>

      {loadError ? (
        <p className="text-slate-400 text-sm">Could not load your brand. Refresh to try again.</p>
      ) : form === null ? (
        <p className="text-slate-400 text-sm">Loading your brand…</p>
      ) : (
        <>
          <div className="space-y-5">
            <label className="block">
              <span className="text-slate-300 text-sm">Brand name</span>
              <input
                type="text"
                value={form.displayName}
                onChange={e => update('displayName', e.target.value)}
                placeholder="e.g. Northwind Enablement"
                aria-label="Brand name"
                className="mt-1 w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-600 focus:border-blue-500 focus:outline-none text-sm transition-colors"
              />
            </label>

            <label className="block">
              <span className="text-slate-300 text-sm">Logo URL</span>
              <input
                type="url"
                value={form.logoUrl}
                onChange={e => update('logoUrl', e.target.value)}
                placeholder="https://…/logo.svg"
                aria-label="Logo URL"
                className="mt-1 w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-600 focus:border-blue-500 focus:outline-none text-sm transition-colors"
              />
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <ColorField
                label="Primary color"
                value={form.primaryColor}
                onChange={v => update('primaryColor', v)}
              />
              <ColorField
                label="Accent color"
                value={form.accentColor}
                onChange={v => update('accentColor', v)}
              />
            </div>
          </div>

          {saveError ? <p className="text-red-400 text-sm">{saveError}</p> : null}
          {saved ? <p className="text-emerald-400 text-sm">Your brand is saved.</p> : null}

          <button
            type="submit"
            disabled={saving}
            className="px-5 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed rounded-xl text-sm font-semibold transition-colors"
          >
            {saving ? 'Saving…' : 'Save brand'}
          </button>
        </>
      )}
    </form>
  );
}
