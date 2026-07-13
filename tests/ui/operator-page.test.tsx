/**
 * UI tests for the operator self-serve workspace (src/app/operator/page.tsx,
 * R-052). The page bootstraps from GET /api/me and renders one of:
 *   - operator (ADMIN of an OPERATOR/STANDALONE org): lists + creates clients
 *   - ineligible (MEMBER, or a CLIENT-org admin)
 *   - platform-admin (ADMIN, no org)
 *   - unauthenticated (401 from /api/me): a sign-in prompt
 * and the create form POSTs to /api/orgs/[id]/clients then reloads the list.
 * Also locks the org copy rule: the word "AI" never appears.
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

async function renderPage() {
  vi.resetModules();
  const { default: Page } = await import('@/app/operator/page');
  return render(<Page />);
}

const OPERATOR_ME = {
  user: { id: 'u1', email: 'a@op.com', name: 'Op Admin', role: 'ADMIN' },
  org: { id: 'op-1', name: 'Acme Training', slug: 'acme', kind: 'OPERATOR', plan: 'FREE', parentOrgId: null },
  canManageClients: true,
};

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  // @ts-expect-error – clean up the stubbed global between tests
  delete globalThis.fetch;
});

describe('Operator workspace — operator view', () => {
  it('lists the operator’s client orgs from /api/orgs/[id]/clients', async () => {
    const fetchSpy = vi.fn((url: string) => {
      if (url === '/api/me') return Promise.resolve(jsonResponse(OPERATOR_ME));
      if (url.startsWith('/api/orgs/op-1/clients'))
        return Promise.resolve(
          jsonResponse([
            { id: 'c1', name: 'Northwind', slug: 'northwind', plan: 'FREE', kind: 'CLIENT', parentOrgId: 'op-1', createdAt: '', _count: { users: 3, sessions: 7 } },
          ])
        );
      return Promise.resolve(jsonResponse([]));
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await renderPage();

    await waitFor(() => expect(screen.getByText('Northwind')).toBeInTheDocument());
    expect(screen.getByText(/3 trainees/)).toBeInTheDocument();
    expect(screen.getByText(/7 sessions/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\bAI\b/);
  });

  it('creates a client (POST) and reloads the list', async () => {
    let created = false;
    const fetchSpy = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/me') return Promise.resolve(jsonResponse(OPERATOR_ME));
      if (url.startsWith('/api/orgs/op-1/clients') && init?.method === 'POST') {
        created = true;
        return Promise.resolve(jsonResponse({ id: 'c2', name: 'Globex' }, 201));
      }
      // GET list: empty before create, one row after
      return Promise.resolve(
        jsonResponse(
          created
            ? [{ id: 'c2', name: 'Globex', slug: 'globex', plan: 'FREE', kind: 'CLIENT', parentOrgId: 'op-1', createdAt: '', _count: { users: 0, sessions: 0 } }]
            : []
        )
      );
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await renderPage();

    await waitFor(() => expect(screen.getByText(/No client workspaces yet/)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('New client name'), { target: { value: 'Globex' } });
    fireEvent.click(screen.getByRole('button', { name: /create client/i }));

    await waitFor(() => expect(screen.getByText('Globex')).toBeInTheDocument());
    const postCall = fetchSpy.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST');
    expect(postCall).toBeTruthy();
  });

  it('surfaces the API error message on a failed create', async () => {
    const fetchSpy = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/me') return Promise.resolve(jsonResponse(OPERATOR_ME));
      if (url.startsWith('/api/orgs/op-1/clients') && init?.method === 'POST')
        return Promise.resolve(jsonResponse({ error: 'name is required' }, 400));
      return Promise.resolve(jsonResponse([]));
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await renderPage();
    await waitFor(() => expect(screen.getByText(/No client workspaces yet/)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('New client name'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /create client/i }));

    await waitFor(() => expect(screen.getByText('name is required')).toBeInTheDocument());
  });
});

describe('Operator workspace — non-operator views', () => {
  it('a MEMBER sees the ineligible notice', async () => {
    globalThis.fetch = vi.fn((url: string) =>
      url === '/api/me'
        ? Promise.resolve(jsonResponse({ ...OPERATOR_ME, user: { ...OPERATOR_ME.user, role: 'MEMBER' } }))
        : Promise.resolve(jsonResponse([]))
    ) as unknown as typeof fetch;

    await renderPage();
    await waitFor(() => expect(screen.getByText('Not an operator workspace')).toBeInTheDocument());
  });

  it('a 401 from /api/me shows a sign-in prompt', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(jsonResponse({ error: 'Authentication required' }, 401))) as unknown as typeof fetch;

    await renderPage();
    await waitFor(() => expect(screen.getByText('Sign in to continue')).toBeInTheDocument());
  });

  it('a STANDALONE admin sees the onboarding call-to-action', async () => {
    globalThis.fetch = vi.fn((url: string) =>
      url === '/api/me'
        ? Promise.resolve(jsonResponse({ ...OPERATOR_ME, org: { ...OPERATOR_ME.org, kind: 'STANDALONE' } }))
        : Promise.resolve(jsonResponse([]))
    ) as unknown as typeof fetch;

    await renderPage();
    await waitFor(() => expect(screen.getByText('Become an operator')).toBeInTheDocument());
  });
});

describe('Operator workspace — branding editor', () => {
  const BRANDING = {
    displayName: 'Northwind',
    logoUrl: 'https://cdn.example.com/logo.svg',
    primaryColor: '#2563eb',
    accentColor: '#22d3ee',
  };

  function operatorFetch(overrides: (url: string, init?: RequestInit) => Response | undefined) {
    return vi.fn((url: string, init?: RequestInit) => {
      const custom = overrides(url, init);
      if (custom) return Promise.resolve(custom);
      if (url === '/api/me') return Promise.resolve(jsonResponse(OPERATOR_ME));
      if (url.startsWith('/api/orgs/op-1/clients')) return Promise.resolve(jsonResponse([]));
      if (url.startsWith('/api/orgs/op-1/branding')) return Promise.resolve(jsonResponse(BRANDING));
      return Promise.resolve(jsonResponse([]));
    });
  }

  it('loads the operator’s current brand from /api/orgs/[id]/branding', async () => {
    globalThis.fetch = operatorFetch(() => undefined) as unknown as typeof fetch;

    await renderPage();

    await waitFor(() => expect(screen.getByLabelText('Brand name')).toHaveValue('Northwind'));
    expect(screen.getByLabelText('Logo URL')).toHaveValue('https://cdn.example.com/logo.svg');
    expect(screen.getByLabelText('Primary color')).toHaveValue('#2563eb');
    expect(document.body.textContent).not.toMatch(/\bAI\b/);
  });

  it('PUTs an edited brand and confirms the save', async () => {
    const fetchSpy = operatorFetch((url, init) => {
      if (url.startsWith('/api/orgs/op-1/branding') && init?.method === 'PUT') {
        return jsonResponse({ ...BRANDING, displayName: 'Renamed Co' });
      }
      return undefined;
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await renderPage();
    await waitFor(() => expect(screen.getByLabelText('Brand name')).toHaveValue('Northwind'));

    fireEvent.change(screen.getByLabelText('Brand name'), { target: { value: 'Renamed Co' } });
    fireEvent.click(screen.getByRole('button', { name: /save brand/i }));

    await waitFor(() => expect(screen.getByText('Your brand is saved.')).toBeInTheDocument());
    const putCall = fetchSpy.mock.calls.find(
      ([u, init]) => String(u).startsWith('/api/orgs/op-1/branding') && (init as RequestInit)?.method === 'PUT'
    );
    expect(putCall).toBeTruthy();
    expect(JSON.parse((putCall![1] as RequestInit).body as string)).toMatchObject({
      displayName: 'Renamed Co',
    });
  });

  it('blocks an invalid color client-side without a PUT', async () => {
    const fetchSpy = operatorFetch(() => undefined);
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await renderPage();
    await waitFor(() => expect(screen.getByLabelText('Primary color')).toHaveValue('#2563eb'));

    fireEvent.change(screen.getByLabelText('Primary color'), { target: { value: 'not-a-color' } });
    fireEvent.click(screen.getByRole('button', { name: /save brand/i }));

    await waitFor(() => expect(screen.getByText(/Primary color must be a hex value/)).toBeInTheDocument());
    const putCall = fetchSpy.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'PUT');
    expect(putCall).toBeUndefined();
  });

  it('surfaces the API error message on a failed save', async () => {
    const fetchSpy = operatorFetch((url, init) => {
      if (url.startsWith('/api/orgs/op-1/branding') && init?.method === 'PUT') {
        return jsonResponse({ error: 'Invalid logoUrl (must be an https URL)' }, 400);
      }
      return undefined;
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await renderPage();
    await waitFor(() => expect(screen.getByLabelText('Brand name')).toHaveValue('Northwind'));

    fireEvent.click(screen.getByRole('button', { name: /save brand/i }));

    await waitFor(() =>
      expect(screen.getByText('Invalid logoUrl (must be an https URL)')).toBeInTheDocument()
    );
  });
});
