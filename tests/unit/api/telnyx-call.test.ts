/**
 * Deterministic tests for POST /api/telnyx/call.
 *
 * This route places a BILLABLE outbound PSTN call and wipes the session
 * transcript, so its guards are security-critical (the toll-fraud + IDOR
 * transcript-wipe fix, P0-2). These tests lock in: auth required, caller must
 * own the session (or be a same-org admin), E.164 validation, the
 * completed-session re-dial guard, and — crucially — that the destructive
 * DELETE only runs AFTER all guards pass.
 *
 * Deps are mocked; the real (pure) canAccessSession is used so the ownership
 * rule is exercised for real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireAuthMock, sqlMock, initiateCallMock, encodeClientStateMock, getCfCtxMock, FakeAuthError } =
  vi.hoisted(() => {
    // Standalone AuthError so the route's `instanceof AuthError` matches without
    // importing the real @/lib/auth-api (which pulls in next-auth and fails to
    // resolve in the unit env).
    class FakeAuthError extends Error {
      status: number;
      constructor(message: string, status: number) {
        super(message);
        this.status = status;
        this.name = 'AuthError';
      }
    }
    return {
      requireAuthMock: vi.fn(),
      sqlMock: vi.fn(),
      initiateCallMock: vi.fn(),
      encodeClientStateMock: vi.fn(() => 'encoded-state'),
      getCfCtxMock: vi.fn(() => {
        throw new Error('no cf context in test');
      }),
      FakeAuthError,
    };
  });

vi.mock('@/lib/auth-api', () => ({ requireAuth: requireAuthMock, AuthError: FakeAuthError }));
vi.mock('@/lib/db', () => ({ sql: sqlMock, default: sqlMock }));
vi.mock('@/lib/telnyx', () => ({
  initiateCall: initiateCallMock,
  encodeClientState: encodeClientStateMock,
}));
vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: getCfCtxMock }));

import { POST } from '@/app/api/telnyx/call/route';
import { AuthError } from '@/lib/auth-api';

const OWNER = { id: 'owner-1', role: 'MEMBER' as const, orgId: 'orgA' };

/** A PHONE session owned by OWNER in orgA, IN_PROGRESS. */
function phoneSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sess-1',
    type: 'PHONE',
    status: 'IN_PROGRESS',
    userId: 'owner-1',
    orgId: 'orgA',
    scenarioId: 'scn-1',
    jobTitleId: 'job-1',
    scenario: { id: 'scn-1', name: 'Angry customer' },
    jobTitle: { id: 'job-1', name: 'Support' },
    ...overrides,
  };
}

/** Wire the sql mock: SELECT returns `rows`; DELETE/UPDATE resolve empty. */
function withSession(rows: unknown[]) {
  sqlMock.mockImplementation((strings?: TemplateStringsArray) => {
    const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
    if (text.includes('FROM simulation_sessions')) return Promise.resolve(rows);
    return Promise.resolve([]);
  });
}

function post(body: unknown, from = process.env) {
  void from;
  return POST(
    new Request('http://localhost/api/telnyx/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  requireAuthMock.mockReset();
  sqlMock.mockReset();
  initiateCallMock.mockReset();
  encodeClientStateMock.mockClear();
  // Default: authenticated as the owner.
  requireAuthMock.mockResolvedValue({ session: { user: OWNER } });
  initiateCallMock.mockResolvedValue({
    data: { call_control_id: 'cc-1', call_leg_id: 'cl-1' },
  });
  process.env.TELNYX_FROM_NUMBER = '+12125550000';
});

describe('POST /api/telnyx/call — auth & ownership', () => {
  it('returns 401 when unauthenticated (no billable call placed)', async () => {
    requireAuthMock.mockRejectedValue(new AuthError('Authentication required', 401));
    const res = await post({ sessionId: 'sess-1', to: '+12125550100' });
    expect(res.status).toBe(401);
    expect(initiateCallMock).not.toHaveBeenCalled();
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('returns 403 when the caller neither owns the session nor is a same-org admin', async () => {
    // Session owned by someone else, caller is a plain member.
    withSession([phoneSession({ userId: 'other', orgId: 'orgA' })]);
    const res = await post({ sessionId: 'sess-1', to: '+12125550100' });
    expect(res.status).toBe(403);
    // No dial, and — critically — no destructive DELETE ran.
    expect(initiateCallMock).not.toHaveBeenCalled();
    const ranDelete = sqlMock.mock.calls.some((c) =>
      (Array.isArray(c[0]) ? c[0].join(' ') : '').includes('DELETE FROM chat_messages')
    );
    expect(ranDelete).toBe(false);
  });

  it('allows a same-org admin to call another user\'s session', async () => {
    requireAuthMock.mockResolvedValue({
      session: { user: { id: 'admin-1', role: 'ADMIN', orgId: 'orgA' } },
    });
    withSession([phoneSession({ userId: 'someone', orgId: 'orgA' })]);
    const res = await post({ sessionId: 'sess-1', to: '+12125550100' });
    expect(res.status).toBe(200);
    expect(initiateCallMock).toHaveBeenCalledOnce();
  });
});

describe('POST /api/telnyx/call — validation & guards', () => {
  it('returns 400 on missing fields', async () => {
    const res = await post({ sessionId: 'sess-1' });
    expect(res.status).toBe(400);
    expect(initiateCallMock).not.toHaveBeenCalled();
  });

  it('returns 400 on a non-E.164 destination', async () => {
    const res = await post({ sessionId: 'sess-1', to: '5550100' });
    expect(res.status).toBe(400);
    expect(initiateCallMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the session does not exist', async () => {
    withSession([]);
    const res = await post({ sessionId: 'nope', to: '+12125550100' });
    expect(res.status).toBe(404);
  });

  it('returns 400 when the session is not a PHONE type', async () => {
    withSession([phoneSession({ type: 'CHAT' })]);
    const res = await post({ sessionId: 'sess-1', to: '+12125550100' });
    expect(res.status).toBe(400);
    expect(initiateCallMock).not.toHaveBeenCalled();
  });

  it('returns 409 for a COMPLETED session and never wipes its scored transcript', async () => {
    withSession([phoneSession({ status: 'COMPLETED' })]);
    const res = await post({ sessionId: 'sess-1', to: '+12125550100' });
    expect(res.status).toBe(409);
    const ranDelete = sqlMock.mock.calls.some((c) =>
      (Array.isArray(c[0]) ? c[0].join(' ') : '').includes('DELETE FROM chat_messages')
    );
    expect(ranDelete).toBe(false);
  });
});

describe('POST /api/telnyx/call — happy path', () => {
  it('dials the E.164 number and returns the call identifiers', async () => {
    withSession([phoneSession()]);
    const res = await post({ sessionId: 'sess-1', to: '+12125550100' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ callControlId: 'cc-1', callLegId: 'cl-1', sessionId: 'sess-1' });
    expect(initiateCallMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: '+12125550100', from: '+12125550000' })
    );
    // Reset only happens on the success path, after guards.
    const ranDelete = sqlMock.mock.calls.some((c) =>
      (Array.isArray(c[0]) ? c[0].join(' ') : '').includes('DELETE FROM chat_messages')
    );
    expect(ranDelete).toBe(true);
  });
});
