/**
 * Integration tests for /api/scenarios and /api/scenarios/[id]
 * Live Neon DB — no mocks.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RUN, createJobTitle, createScenario, cleanupRun } from '../helpers/db';
import { GET, POST } from '@/app/api/scenarios/route';
import { PUT, DELETE } from '@/app/api/scenarios/[id]/route';

function req(method: string, url: string, body?: unknown): Request {
  return new Request(`http://localhost${url}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

let seedJobId: string;
let seedScenarioId: string;

beforeAll(async () => {
  const job = await createJobTitle({ name: `${RUN} Billing Spec` });
  seedJobId = job.id;
  const sc = await createScenario(seedJobId, { name: `${RUN} Angry Bill Dispute`, type: 'CHAT' });
  seedScenarioId = sc.id;
});
afterAll(cleanupRun);

describe('GET /api/scenarios', () => {
  it('returns 200 with an array', async () => {
    const r = req('GET', '/api/scenarios');
    const res = await GET(r);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it('includes the seeded scenario in unfiltered results', async () => {
    const r = req('GET', '/api/scenarios');
    const res = await GET(r);
    const data: Array<{ id: string }> = await res.json();
    expect(data.some(s => s.id === seedScenarioId)).toBe(true);
  });

  it('filters by jobTitleId and returns matching scenario', async () => {
    const r = req('GET', `/api/scenarios?jobTitleId=${seedJobId}`);
    const res = await GET(r);
    expect(res.status).toBe(200);
    const data: Array<{ id: string; jobTitleId: string }> = await res.json();
    expect(data.length).toBeGreaterThan(0);
    expect(data.every(s => s.jobTitleId === seedJobId)).toBe(true);
    expect(data.some(s => s.id === seedScenarioId)).toBe(true);
  });

  it('returns empty array when filtering by nonexistent jobTitleId', async () => {
    const r = req('GET', '/api/scenarios?jobTitleId=nonexistent-job-123');
    const res = await GET(r);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(0);
  });

  it('includes jobTitle nested in each scenario', async () => {
    const r = req('GET', `/api/scenarios?jobTitleId=${seedJobId}`);
    const res = await GET(r);
    const data: Array<{ id: string; jobTitle: { id: string; name: string } }> = await res.json();
    const seeded = data.find(s => s.id === seedScenarioId);
    expect(seeded?.jobTitle.id).toBe(seedJobId);
  });
});

describe('POST /api/scenarios', () => {
  it('creates a scenario and returns 201', async () => {
    const r = req('POST', '/api/scenarios', {
      jobTitleId: seedJobId,
      name: `${RUN} Phone Dispute`,
      type: 'PHONE',
      description: 'Customer upset about overcharge.',
    });
    const res = await POST(r);
    expect(res.status).toBe(201);
    const data: { id: string; name: string; type: string } = await res.json();
    expect(data.name).toBe(`${RUN} Phone Dispute`);
    expect(data.type).toBe('PHONE');
    expect(typeof data.id).toBe('string');
  });

  it('returns 400 when jobTitleId is missing', async () => {
    const r = req('POST', '/api/scenarios', { name: `${RUN} X`, type: 'CHAT' });
    const res = await POST(r);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when name is missing', async () => {
    const r = req('POST', '/api/scenarios', { jobTitleId: seedJobId, type: 'CHAT' });
    const res = await POST(r);
    expect(res.status).toBe(400);
  });

  it('returns 400 when type is missing', async () => {
    const r = req('POST', '/api/scenarios', { jobTitleId: seedJobId, name: `${RUN} Y` });
    const res = await POST(r);
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/scenarios/[id]', () => {
  let putTargetId: string;
  beforeAll(async () => {
    const sc = await createScenario(seedJobId, { name: `${RUN} PutScenario` });
    putTargetId = sc.id;
  });

  it('updates scenario name and returns 200', async () => {
    const r = req('PUT', `/api/scenarios/${putTargetId}`, { name: `${RUN} PutScenario-v2` });
    const res = await PUT(r, { params: Promise.resolve({ id: putTargetId }) });
    expect(res.status).toBe(200);
    const data: { name: string } = await res.json();
    expect(data.name).toBe(`${RUN} PutScenario-v2`);
  });

  it('returns 500 for nonexistent id', async () => {
    const r = req('PUT', '/api/scenarios/bogus-id-xxx', { name: 'X' });
    const res = await PUT(r, { params: Promise.resolve({ id: 'bogus-id-xxx' }) });
    expect(res.status).toBe(500);
  });
});

describe('DELETE /api/scenarios/[id]', () => {
  let deleteTargetId: string;
  beforeAll(async () => {
    const sc = await createScenario(seedJobId, { name: `${RUN} DelScenario` });
    deleteTargetId = sc.id;
  });

  it('returns 204 on successful delete', async () => {
    const r = req('DELETE', `/api/scenarios/${deleteTargetId}`);
    const res = await DELETE(r, { params: Promise.resolve({ id: deleteTargetId }) });
    expect(res.status).toBe(204);
  });

  it('returns 500 for nonexistent id', async () => {
    const r = req('DELETE', '/api/scenarios/bogus-id-yyy');
    const res = await DELETE(r, { params: Promise.resolve({ id: 'bogus-id-yyy' }) });
    expect(res.status).toBe(500);
  });
});
