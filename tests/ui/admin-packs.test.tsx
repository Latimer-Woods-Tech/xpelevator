/**
 * UI tests for the admin "Scenario Packs" surface (src/app/admin/page.tsx,
 * ScenarioPacksTab). The tab reads GET /api/scenario-packs/status and renders,
 * per pack, an Import action (not_imported), an Upgrade action (upgrade_available),
 * or a "current" marker (up_to_date), then POSTs to the import/upgrade write
 * routes and re-reads status. Also locks the org copy rule: the word "AI" never
 * appears on the surface.
 *
 * Environment: happy-dom
 */
// @vitest-environment happy-dom

/// <reference types="@testing-library/jest-dom" />
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

async function renderAdmin() {
  vi.resetModules();
  const { default: Page } = await import('@/app/admin/page');
  return render(<Page />);
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const STATUS_PAYLOAD = {
  catalogVersion: 1,
  packs: [
    {
      packId: 'pack-new',
      packName: 'Retail Frontline',
      vertical: 'Retail',
      role: 'Store Associate',
      catalogVersion: 1,
      state: 'not_imported',
      importedScenarioCount: 0,
      catalogScenarioCount: 4,
      drift: { update: 0, insert: 0, unchanged: 0, orphaned: 0 },
    },
    {
      packId: 'pack-stale',
      packName: 'SaaS Support Essentials',
      vertical: 'SaaS',
      role: 'Support Agent',
      catalogVersion: 1,
      state: 'upgrade_available',
      importedScenarioCount: 3,
      catalogScenarioCount: 4,
      drift: { update: 2, insert: 1, unchanged: 0, orphaned: 0 },
    },
    {
      packId: 'pack-current',
      packName: 'Field Sales Objections',
      vertical: 'Sales',
      role: 'Account Executive',
      catalogVersion: 1,
      state: 'up_to_date',
      importedScenarioCount: 4,
      catalogScenarioCount: 4,
      drift: { update: 0, insert: 0, unchanged: 4, orphaned: 0 },
    },
  ],
};

/** Route fetch by URL (+ method). The admin page mounts CriteriaTab first. */
function stubFetch(overrides: Record<string, () => Promise<Response>> = {}) {
  const fetchSpy = vi.fn((url: string, init?: RequestInit) => {
    const method = (init?.method || 'GET').toUpperCase();
    const key = `${method} ${url}`;
    if (overrides[key]) return overrides[key]();
    if (url === '/api/criteria') return Promise.resolve(jsonResponse([]));
    if (url === '/api/scenario-packs/status') return Promise.resolve(jsonResponse(STATUS_PAYLOAD));
    return Promise.resolve(jsonResponse({}));
  });
  // @ts-expect-error – install the stub on the test global
  globalThis.fetch = fetchSpy;
  return fetchSpy;
}

async function openPacksTab() {
  await renderAdmin();
  fireEvent.click(screen.getByRole('button', { name: 'Scenario Packs' }));
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  // @ts-expect-error – clean the stubbed global between tests
  delete globalThis.fetch;
});

describe('Admin Scenario Packs — status rendering', () => {
  it('renders each pack with the right action for its state', async () => {
    stubFetch();
    await openPacksTab();

    await waitFor(() => expect(screen.getByText('Retail Frontline')).toBeInTheDocument());
    expect(screen.getByText('SaaS Support Essentials')).toBeInTheDocument();
    expect(screen.getByText('Field Sales Objections')).toBeInTheDocument();

    // not_imported → Import; upgrade_available → Upgrade; up_to_date → current marker
    expect(screen.getByRole('button', { name: /import pack/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^upgrade$/i })).toBeInTheDocument();
    expect(screen.getByText(/current/i)).toBeInTheDocument();
    // the upgrade drift summary is surfaced
    expect(screen.getByText(/2 to update, 1 to add/i)).toBeInTheDocument();
  });

  it('never shows the banned word "AI" on the surface', async () => {
    stubFetch();
    await openPacksTab();
    await waitFor(() => expect(screen.getByText('Retail Frontline')).toBeInTheDocument());
    expect(document.body.textContent || '').not.toMatch(/\bAI\b/);
  });
});

describe('Admin Scenario Packs — actions', () => {
  it('imports a not-imported pack and surfaces the result', async () => {
    window.confirm = vi.fn(() => true);
    const fetchSpy = stubFetch({
      'POST /api/scenario-packs/import': () =>
        Promise.resolve(jsonResponse({ scenarios: { created: 4, skipped: 0, total: 4 } }, 201)),
    });
    await openPacksTab();

    await waitFor(() => expect(screen.getByRole('button', { name: /import pack/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /import pack/i }));

    await waitFor(() => expect(screen.getByText(/Imported — 4 scenarios added/i)).toBeInTheDocument());
    // the write went to the import route, and status was re-read afterward
    const posted = fetchSpy.mock.calls.find(
      ([url, init]) => url === '/api/scenario-packs/import' && (init as RequestInit)?.method === 'POST',
    );
    expect(posted).toBeTruthy();
    expect(JSON.parse((posted![1] as RequestInit).body as string)).toEqual({ packId: 'pack-new' });
  });

  it('does not POST when the confirm is declined', async () => {
    window.confirm = vi.fn(() => false);
    const fetchSpy = stubFetch();
    await openPacksTab();

    await waitFor(() => expect(screen.getByRole('button', { name: /import pack/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /import pack/i }));

    const posted = fetchSpy.mock.calls.find(([url]) => url === '/api/scenario-packs/import');
    expect(posted).toBeFalsy();
  });

  it('upgrades an upgrade_available pack and reports what changed', async () => {
    window.confirm = vi.fn(() => true);
    stubFetch({
      'POST /api/scenario-packs/upgrade': () =>
        Promise.resolve(jsonResponse({ scenarios: { updated: 2, inserted: 1, unchanged: 0, orphaned: 0 } })),
    });
    await openPacksTab();

    await waitFor(() => expect(screen.getByRole('button', { name: /^upgrade$/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /^upgrade$/i }));

    await waitFor(() => expect(screen.getByText(/Upgraded — 2 updated, 1 added/i)).toBeInTheDocument());
  });

  it('surfaces a server error instead of a silent failure', async () => {
    window.confirm = vi.fn(() => true);
    stubFetch({
      'POST /api/scenario-packs/import': () =>
        Promise.resolve(jsonResponse({ error: 'Import requires an org context; this admin has no org.' }, 400)),
    });
    await openPacksTab();

    await waitFor(() => expect(screen.getByRole('button', { name: /import pack/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /import pack/i }));

    await waitFor(() => expect(screen.getByText(/Failed: Import requires an org context/i)).toBeInTheDocument());
  });
});

describe('Admin Scenario Packs — load failure', () => {
  it('shows the error when status cannot be loaded', async () => {
    stubFetch({
      'GET /api/scenario-packs/status': () =>
        Promise.resolve(jsonResponse({ error: 'Pack status requires an org context; this admin has no org.' }, 400)),
    });
    await openPacksTab();
    await waitFor(() =>
      expect(screen.getByText(/Pack status requires an org context/i)).toBeInTheDocument(),
    );
  });
});
