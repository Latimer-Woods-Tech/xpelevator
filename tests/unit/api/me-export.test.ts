import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unit test for GET /api/me/export (data-subject access export, issue #157) with
// DB + auth mocked. Proves: the auth gate (anon → 401, never touches the DB);
// the sessions query is scoped to the caller's OWN user_id (never a
// request-supplied id) — the security-critical value; the download headers; and
// the 500 path. The pure projection (incl. the hidden-mechanic-leak guard) is
// covered in tests/unit/lib/dsr-export.test.ts; the live anon 401 is a deploy
// gate.

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

import { GET } from '@/app/api/me/export/route';
import { AuthError } from '@/lib/auth-api';

function req(): Request {
  return new Request('http://localhost/api/me/export');
}

function asUser(user: Record<string, unknown>) {
  requireAuthMock.mockResolvedValue({ session: { user } });
}

beforeEach(() => {
  requireAuthMock.mockReset();
  sqlMock.mockReset();
});

describe('GET /api/me/export — auth', () => {
  it('anon → 401 and never touches the DB', async () => {
    requireAuthMock.mockRejectedValue(new AuthError('Authentication required', 401));
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/me/export — self scoping', () => {
  it('scopes the sessions query to the caller OWN user_id (not a request id)', async () => {
    asUser({
      id: 'auth-user-1',
      email: 'trainee@acme.io',
      name: 'Tess',
      role: 'MEMBER',
      orgId: 'org-acme',
      dbUserId: 'db-user-1',
    });

    // Capture the value bound into the `ss.user_id = ` filter — the
    // security-critical scoping. Route by SQL text: users row, org row, sessions.
    let sessionsScopedTo: unknown = null;
    let userRowScopedTo: unknown = null;
    let orgRowScopedTo: unknown = null;
    sqlMock.mockImplementation(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
        if (text.includes('FROM users')) {
          userRowScopedTo = values[0];
          return Promise.resolve([{ createdAt: '2026-01-02T00:00:00.000Z' }]);
        }
        if (text.includes('FROM organizations')) {
          orgRowScopedTo = values[0];
          return Promise.resolve([
            { id: 'org-acme', name: 'Acme', slug: 'acme', plan: 'ENTERPRISE', kind: 'OPERATOR' },
          ]);
        }
        if (text.includes('FROM simulation_sessions')) {
          sessionsScopedTo = values[0];
          return Promise.resolve([
            {
              id: 'sess-1',
              type: 'CHAT',
              status: 'COMPLETED',
              scoringStatus: 'SCORED',
              scenarioName: 'Angry churn caller',
              scenarioDescription: 'desc',
              jobTitleName: 'Support Rep',
              startedAt: '2026-08-01T10:00:00.000Z',
              endedAt: '2026-08-01T10:12:00.000Z',
              createdAt: '2026-08-01T10:00:00.000Z',
              messages: [],
              scores: [],
            },
          ]);
        }
        return Promise.resolve([]);
      }
    );

    const res = await GET(req());
    expect(res.status).toBe(200);
    // The whole point: sessions read by the caller's OWN auth id.
    expect(sessionsScopedTo).toBe('auth-user-1');
    // The account row + org read by the caller's own ids, never a request id.
    expect(userRowScopedTo).toBe('db-user-1');
    expect(orgRowScopedTo).toBe('org-acme');

    const body = await res.json();
    expect(body.export.kind).toBe('xpelevator-data-subject-export');
    expect(body.user.id).toBe('auth-user-1');
    expect(body.user.createdAt).toBe('2026-01-02T00:00:00.000Z');
    expect(body.org.slug).toBe('acme');
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].scenario).toBe('Angry churn caller');

    // Download headers.
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Content-Disposition')).toMatch(
      /^attachment; filename="xpelevator-data-export-\d{4}-\d{2}-\d{2}\.json"$/
    );
  });

  it('caller with no org / no dbUserId skips those lookups and still exports sessions', async () => {
    asUser({ id: 'auth-user-2', email: null, name: null, role: 'MEMBER', orgId: null });
    const seen: string[] = [];
    sqlMock.mockImplementation(
      (strings: TemplateStringsArray) => {
        const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
        if (text.includes('FROM users')) seen.push('users');
        if (text.includes('FROM organizations')) seen.push('orgs');
        if (text.includes('FROM simulation_sessions')) seen.push('sessions');
        return Promise.resolve([]);
      }
    );
    const res = await GET(req());
    expect(res.status).toBe(200);
    // No dbUserId → no users lookup; no orgId → no organizations lookup.
    expect(seen).not.toContain('users');
    expect(seen).not.toContain('orgs');
    expect(seen).toContain('sessions');
    const body = await res.json();
    expect(body.org).toBeNull();
    expect(body.user.createdAt).toBeNull();
    expect(body.sessions).toEqual([]);
  });
});

describe('GET /api/me/export — failure path', () => {
  it('a DB error → 500 with a generic message (no internals)', async () => {
    asUser({ id: 'auth-user-1', role: 'MEMBER', orgId: null, dbUserId: null });
    sqlMock.mockRejectedValue(new Error('neon exploded: secret-connection-string'));
    const res = await GET(req());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Failed to build data export');
    expect(JSON.stringify(body)).not.toContain('secret-connection-string');
  });
});
