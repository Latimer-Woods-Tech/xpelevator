/**
 * Deterministic tests for per-seat modality gating on POST /api/simulations
 * (issue #16, Phase 4 — entitlement enforcement).
 *
 * A tenant trainee may only START a practice modality their org's plan unlocks,
 * per the founder's cumulative seat model (chat → +voice → +phone):
 *   - FREE       → CHAT only
 *   - PRO        → CHAT + VOICE
 *   - ENTERPRISE → CHAT + VOICE + PHONE
 *
 * CHAT is the floor of every tier, so the core loop + the live scoring canary
 * are never blocked. Platform staff (no org / test mode) are ungated — gating
 * applies to billed tenant trainees only. A locked request returns 403 with a
 * `MODALITY_LOCKED` code + the cheapest tier that unlocks, and NO session row is
 * inserted.
 *
 * requireAuth/sql are mocked; the real pure plan→modality logic is exercised.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireAuthMock, sqlMock, FakeAuthError } = vi.hoisted(() => {
  class FakeAuthError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
      this.name = 'AuthError';
    }
  }
  return { requireAuthMock: vi.fn(), sqlMock: vi.fn(), FakeAuthError };
});

vi.mock('@/lib/auth-api', () => ({ requireAuth: requireAuthMock, AuthError: FakeAuthError }));
vi.mock('@/lib/db', () => ({ sql: sqlMock, default: sqlMock }));

import { POST } from '@/app/api/simulations/route';

function postReq(type: string, body: Record<string, unknown> = {}) {
  return new Request('http://localhost/api/simulations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobTitleId: 'j1', scenarioId: 's1', type, ...body }),
  });
}

function asUser(orgId: string | null, role: 'ADMIN' | 'MEMBER' = 'MEMBER') {
  requireAuthMock.mockResolvedValue({
    session: { user: { id: 'u1', dbUserId: 'db1', role, orgId } },
  });
}

/**
 * Wire the sql mock. The refs SELECT resolves scenario + job title as visible to
 * the caller's org (`orgId` scenario/job) and reports the org's `plan`. The
 * daily-count SELECT returns 0. The INSERT + the two response SELECTs resolve to
 * plausible rows so a permitted request reaches 201.
 */
function wire(orgId: string | null, plan: string | null) {
  sqlMock.mockImplementation((strings?: TemplateStringsArray) => {
    const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
    if (text.includes('"scenarioExists"')) {
      return Promise.resolve([
        {
          scenarioOrgId: orgId,
          scenarioExists: 's1',
          jobOrgId: orgId,
          jobExists: 'j1',
          orgPlan: plan,
        },
      ]);
    }
    if (text.includes('FROM simulation_sessions') && text.includes('COUNT(*)')) {
      return Promise.resolve([{ count: 0 }]);
    }
    if (text.includes('INSERT INTO simulation_sessions')) {
      return Promise.resolve([{ id: 'sess1' }]);
    }
    if (text.includes('FROM simulation_sessions ss')) {
      return Promise.resolve([
        { id: 'sess1', type: 'CHAT', status: 'IN_PROGRESS', scenario: { id: 's1' }, jobTitle: { id: 'j1' } },
      ]);
    }
    return Promise.resolve([]);
  });
}

function ranInsert() {
  return sqlMock.mock.calls.some((c) => {
    const s = c[0];
    const text = Array.isArray(s) ? s.join(' ') : String(s);
    return text.includes('INSERT INTO simulation_sessions');
  });
}

beforeEach(() => {
  requireAuthMock.mockReset();
  sqlMock.mockReset();
});

describe('POST /api/simulations — per-seat modality gating', () => {
  it('FREE org may start CHAT (the floor) → 201, session created', async () => {
    asUser('orgA');
    wire('orgA', 'FREE');
    const res = await POST(postReq('CHAT'));
    expect(res.status).toBe(201);
    expect(ranInsert()).toBe(true);
  });

  it('FREE org is BLOCKED from VOICE → 403 MODALITY_LOCKED, no session created', async () => {
    asUser('orgA');
    wire('orgA', 'FREE');
    const res = await POST(postReq('VOICE'));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('MODALITY_LOCKED');
    expect(body.modality).toBe('VOICE');
    expect(body.requiredTier).toBe('voice');
    expect(ranInsert()).toBe(false);
  });

  it('FREE org is BLOCKED from PHONE → 403, upgrade hint points at the phone tier', async () => {
    asUser('orgA');
    wire('orgA', 'FREE');
    const res = await POST(postReq('PHONE'));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('MODALITY_LOCKED');
    expect(body.requiredTier).toBe('phone');
    expect(ranInsert()).toBe(false);
  });

  it('PRO org may start VOICE → 201, but is still BLOCKED from PHONE → 403', async () => {
    asUser('orgA');
    wire('orgA', 'PRO');
    const okVoice = await POST(postReq('VOICE'));
    expect(okVoice.status).toBe(201);

    sqlMock.mockReset();
    wire('orgA', 'PRO');
    const lockedPhone = await POST(postReq('PHONE'));
    expect(lockedPhone.status).toBe(403);
    expect((await lockedPhone.json()).requiredTier).toBe('phone');
  });

  it('ENTERPRISE org may start PHONE → 201, session created', async () => {
    asUser('orgA');
    wire('orgA', 'ENTERPRISE');
    const res = await POST(postReq('PHONE'));
    expect(res.status).toBe(201);
    expect(ranInsert()).toBe(true);
  });

  it('platform staff (no org / test mode) are ungated — PHONE → 201 even without a plan', async () => {
    asUser(null, 'ADMIN');
    wire(null, null);
    const res = await POST(postReq('PHONE'));
    expect(res.status).toBe(201);
    expect(ranInsert()).toBe(true);
  });

  it('an org with a missing/unknown plan is floored to chat — VOICE → 403 (never over-grants)', async () => {
    asUser('orgA');
    wire('orgA', null);
    const res = await POST(postReq('VOICE'));
    expect(res.status).toBe(403);
    expect(ranInsert()).toBe(false);
  });

  it('an invalid modality is still rejected as 400 before any gating', async () => {
    asUser('orgA');
    wire('orgA', 'ENTERPRISE');
    const res = await POST(postReq('SMOKE_SIGNAL'));
    expect(res.status).toBe(400);
    expect(ranInsert()).toBe(false);
  });
});
