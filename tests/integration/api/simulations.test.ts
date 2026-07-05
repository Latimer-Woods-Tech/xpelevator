/**
 * Integration tests for /api/simulations
 * Live Neon DB — no mocks.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RUN, createJobTitle, createScenario, createSession, cleanupRun } from '../helpers/db';
import { GET, POST } from '@/app/api/simulations/route';

function req(method: string, url: string, body?: unknown): Request {
  return new Request(`http://localhost${url}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

let seedJobId: string;
let seedScenarioId: string;
let seedSessionId: string;

beforeAll(async () => {
  const job = await createJobTitle({ name: `${RUN} SimJob` });
  seedJobId = job.id;
  const sc = await createScenario(seedJobId, { name: `${RUN} SimScenario`, type: 'CHAT' });
  seedScenarioId = sc.id;
  const session = await createSession(seedJobId, seedScenarioId, {
    userId: `sim-user-${RUN}`,
    type: 'CHAT',
  });
  seedSessionId = session.id;
});
afterAll(cleanupRun);

describe('POST /api/simulations', () => {
  it('creates session with IN_PROGRESS status and returns 201', async () => {
    const r = req('POST', '/api/simulations', {
      userId: `post-user-${RUN}`,
      jobTitleId: seedJobId,
      scenarioId: seedScenarioId,
      type: 'CHAT',
    });
    const res = await POST(r);
    expect(res.status).toBe(201);
    const data: { id: string; status: string } = await res.json();
    expect(data.status).toBe('IN_PROGRESS');
    expect(typeof data.id).toBe('string');
  });

  it('sets startedAt on creation', async () => {
    const r = req('POST', '/api/simulations', {
      userId: `post-user2-${RUN}`,
      jobTitleId: seedJobId,
      scenarioId: seedScenarioId,
      type: 'CHAT',
    });
    const res = await POST(r);
    expect(res.status).toBe(201);
    const data: { startedAt: string } = await res.json();
    expect(data.startedAt).toBeTruthy();
    expect(new Date(data.startedAt).getTime()).toBeGreaterThan(0);
  });

  it('includes scenario and jobTitle in response', async () => {
    const r = req('POST', '/api/simulations', {
      userId: `post-user3-${RUN}`,
      jobTitleId: seedJobId,
      scenarioId: seedScenarioId,
      type: 'PHONE',
    });
    const res = await POST(r);
    expect(res.status).toBe(201);
    const data: { scenario: unknown; jobTitle: unknown } = await res.json();
    expect(data.scenario).toBeTruthy();
    expect(data.jobTitle).toBeTruthy();
  });

  it('persists correct userId and type to DB', async () => {
    const userId = `type-test-${RUN}`;
    const r = req('POST', '/api/simulations', {
      userId,
      jobTitleId: seedJobId,
      scenarioId: seedScenarioId,
      type: 'PHONE',
    });
    const res = await POST(r);
    expect(res.status).toBe(201);
    const data: { userId: string; type: string } = await res.json();
    expect(data.userId).toBe(userId);
    expect(data.type).toBe('PHONE');
  });

  it('returns 500 when jobTitleId does not exist (FK violation)', async () => {
    const r = req('POST', '/api/simulations', {
      userId: `fk-test-${RUN}`,
      jobTitleId: 'non-existent-job-abc',
      scenarioId: seedScenarioId,
      type: 'CHAT',
    });
    const res = await POST(r);
    expect(res.status).toBe(500);
  });
});

describe('GET /api/simulations', () => {
  it('returns 200 with an array', async () => {
    const r = req('GET', '/api/simulations');
    const res = await GET(r);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it('includes the seeded session in unfiltered results', async () => {
    const r = req('GET', '/api/simulations');
    const res = await GET(r);
    const data: Array<{ id: string }> = await res.json();
    expect(data.some(s => s.id === seedSessionId)).toBe(true);
  });

  it('filters by userId correctly', async () => {
    const userId = `sim-user-${RUN}`;
    const r = req('GET', `/api/simulations?userId=${encodeURIComponent(userId)}`);
    const res = await GET(r);
    expect(res.status).toBe(200);
    const data: Array<{ userId: string }> = await res.json();
    expect(data.length).toBeGreaterThan(0);
    expect(data.every(s => s.userId === userId)).toBe(true);
  });

  it('returns empty array for unknown userId', async () => {
    const r = req('GET', '/api/simulations?userId=no-such-user-xyzabcd');
    const res = await GET(r);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(0);
  });

  it('includes scenario and jobTitle nested objects', async () => {
    const userId = `sim-user-${RUN}`;
    const r = req('GET', `/api/simulations?userId=${encodeURIComponent(userId)}`);
    const res = await GET(r);
    const data: Array<{ scenario: unknown; jobTitle: unknown }> = await res.json();
    if (data.length > 0) {
      expect(data[0].scenario).toBeTruthy();
      expect(data[0].jobTitle).toBeTruthy();
    }
  });
});
