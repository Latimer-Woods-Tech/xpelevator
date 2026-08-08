import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unit test for GET /api/reports/budget with DB + auth mocked. Proves the
// admin-only gate (anon 401 / non-admin 403), own-org scoping, tier resolution
// from the org plan, and the ok/warn/over evaluation shape. The pure ceiling
// logic is covered in tests/unit/lib/budget.test.ts.

const requireAuthMock = vi.fn();

vi.mock('@/lib/auth-api', () => {
  class AuthError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
      this.name = 'AuthError';
    }
  }
  return {
    AuthError,
    requireAuth: (...args: unknown[]) => requireAuthMock(...args),
  };
});

const sqlMock = vi.fn();
vi.mock('@/lib/db', () => ({
  sql: (...args: unknown[]) => sqlMock(...args),
}));

import { GET } from '@/app/api/reports/budget/route';
import { AuthError } from '@/lib/auth-api';

function req(): Request {
  return new Request('http://localhost/api/reports/budget');
}

function asAdmin(orgId: string | null = 'org-1') {
  requireAuthMock.mockResolvedValue({
    session: { user: { id: 'u1', role: 'ADMIN', orgId } },
  });
}

/** The org id the spend query was scoped to (captured from `ss.org_id =`). */
let scopedTo: unknown;

/**
 * Route sql calls by text: the plan lookup (`FROM organizations WHERE id =`),
 * the `ss.org_id =` scope fragment (value captured), and the main spend query
 * (`FROM simulation_sessions`, returns `rows`).
 */
function routeSql(plan: string | null, rows: unknown[] = []) {
  scopedTo = null;
  sqlMock.mockImplementation(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
      if (/FROM organizations\s+WHERE id =/.test(text)) {
        return Promise.resolve([{ plan }]);
      }
      if (/ss\.org_id =/.test(text)) {
        scopedTo = values[0];
        return Promise.resolve([]);
      }
      if (/FROM simulation_sessions/.test(text)) {
        return Promise.resolve(rows);
      }
      return Promise.resolve([]);
    },
  );
}

beforeEach(() => {
  requireAuthMock.mockReset();
  sqlMock.mockReset();
  scopedTo = null;
});

describe('GET /api/reports/budget', () => {
  it('anonymous → 401 (AuthError surfaced)', async () => {
    requireAuthMock.mockRejectedValue(
      new AuthError('Authentication required', 401),
    );
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it('non-admin member → 403 (AuthError surfaced)', async () => {
    requireAuthMock.mockRejectedValue(new AuthError('Admin access required', 403));
    const res = await GET(req());
    expect(res.status).toBe(403);
  });

  it('admin with no usage → 200 ok, scoped to own org, tier from plan', async () => {
    asAdmin('org-1');
    routeSql('ENTERPRISE', []);
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(scopedTo).toBe('org-1');
    expect(body.tier).toBe('phone'); // ENTERPRISE → phone
    expect(body.budget.status).toBe('ok');
    expect(body.spend.costMicroUsd).toBe(0);
    expect(body.period).toBe('current-calendar-month');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('admin over the ceiling → 200 with status "over"', async () => {
    asAdmin('org-1');
    // FREE → chat ceiling ($25). One 70B-output row of 100M tokens ≈ $79 » cap.
    routeSql('FREE', [
      {
        model: 'llama-3.3-70b-versatile',
        promptTokens: 0,
        completionTokens: 100_000_000,
        totalTokens: 100_000_000,
      },
    ]);
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tier).toBe('chat');
    expect(body.budget.status).toBe('over');
    expect(body.spend.costMicroUsd).toBeGreaterThan(body.budget.capMicroUsd);
  });

  it('org-less admin (test mode) → 200, evaluated against the chat floor, own null-org scope', async () => {
    asAdmin(null);
    routeSql(null, []);
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tier).toBe('chat');
    // No org → the query uses the null-org owner-only fragment, not ss.org_id =.
    expect(scopedTo).toBeNull();
  });

  it('a DB failure → 500 (not a leak)', async () => {
    asAdmin('org-1');
    sqlMock.mockRejectedValue(new Error('db down'));
    const res = await GET(req());
    expect(res.status).toBe(500);
  });
});
