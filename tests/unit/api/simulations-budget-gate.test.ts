/**
 * Deterministic tests for the org-level monthly Groq-spend ceiling on
 * POST /api/simulations (#155 — "LLM cost is unbounded").
 *
 * After the daily per-user cap, a tenant's AGGREGATE month-to-date LLM spend is
 * checked against its seat-tier ceiling (`@/lib/budget`). Over the ceiling →
 * 429 `BUDGET_EXCEEDED`, and NO session row is inserted. Under → 201. The check:
 *   - runs only when an `orgId` is present (platform staff / test mode ungated);
 *   - FAILS OPEN — a spend-query error logs and still creates the session;
 *   - carries no cost figures in the block body (those are ADMIN-only).
 *
 * requireAuth/sql are mocked; the real pure budget logic is exercised.
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

vi.mock('@/lib/auth-api', () => ({
  requireAuth: requireAuthMock,
  AuthError: FakeAuthError,
}));
vi.mock('@/lib/db', () => ({ sql: sqlMock, default: sqlMock }));

import { POST } from '@/app/api/simulations/route';

function postReq(type = 'CHAT') {
  return new Request('http://localhost/api/simulations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobTitleId: 'j1', scenarioId: 's1', type }),
  });
}

function asUser(orgId: string | null) {
  requireAuthMock.mockResolvedValue({
    session: { user: { id: 'u1', dbUserId: 'db1', role: 'MEMBER', orgId } },
  });
}

/**
 * Wire the sql mock. `spendRows` feeds the month-to-date budget query (matched
 * on `date_trunc('month'`); `budgetThrows` makes that one query reject to prove
 * the fail-open path. The budget branch is checked BEFORE the generic response
 * SELECT because both contain `FROM simulation_sessions ss`.
 */
function wire(
  orgId: string | null,
  plan: string | null,
  spendRows: unknown[] = [],
  budgetThrows = false,
) {
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
    if (text.includes("date_trunc('month'")) {
      if (budgetThrows) return Promise.reject(new Error('spend query failed'));
      return Promise.resolve(spendRows);
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

/** A single model roll-up whose priced cost exceeds the chat ceiling ($25). */
const OVER_CEILING_ROW = {
  model: 'llama-3.3-70b-versatile',
  promptTokens: 0,
  completionTokens: 100_000_000, // 100M × $0.79/1M ≈ $79 » $25
  totalTokens: 100_000_000,
};

beforeEach(() => {
  requireAuthMock.mockReset();
  sqlMock.mockReset();
});

describe('POST /api/simulations — monthly spend ceiling', () => {
  it('a tenant OVER its ceiling is blocked → 429 BUDGET_EXCEEDED, no session created', async () => {
    asUser('orgA');
    wire('orgA', 'FREE', [OVER_CEILING_ROW]);
    const res = await POST(postReq('CHAT'));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe('BUDGET_EXCEEDED');
    // The block body must NOT leak cost/margin figures to a trainee.
    expect(body.spentMicroUsd).toBeUndefined();
    expect(body.capMicroUsd).toBeUndefined();
    expect(ranInsert()).toBe(false);
  });

  it('a tenant UNDER its ceiling proceeds → 201, session created', async () => {
    asUser('orgA');
    wire('orgA', 'FREE', [
      { model: 'llama-3.1-8b-instant', promptTokens: 5_000, completionTokens: 5_000, totalTokens: 10_000 },
    ]);
    const res = await POST(postReq('CHAT'));
    expect(res.status).toBe(201);
    expect(ranInsert()).toBe(true);
  });

  it('no month-to-date usage → 201 (zero spend is under every ceiling)', async () => {
    asUser('orgA');
    wire('orgA', 'ENTERPRISE', []);
    const res = await POST(postReq('CHAT'));
    expect(res.status).toBe(201);
    expect(ranInsert()).toBe(true);
  });

  it('platform staff (no org / test mode) are ungated — 201 even with no plan', async () => {
    asUser(null);
    wire(null, null, [OVER_CEILING_ROW]);
    const res = await POST(postReq('CHAT'));
    expect(res.status).toBe(201);
    expect(ranInsert()).toBe(true);
  });

  it('FAILS OPEN — a spend-query error never blocks a legitimate session → 201', async () => {
    asUser('orgA');
    wire('orgA', 'FREE', [], /* budgetThrows */ true);
    const res = await POST(postReq('CHAT'));
    expect(res.status).toBe(201);
    expect(ranInsert()).toBe(true);
  });
});
