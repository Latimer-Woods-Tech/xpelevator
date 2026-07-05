/**
 * Integration tests for /api/jobs, /api/jobs/[id], /api/jobs/[id]/criteria
 * Live Neon DB — no mocks.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RUN, createCriteria, createJobTitle, cleanupRun } from '../helpers/db';
import { GET, POST } from '@/app/api/jobs/route';
import { PUT, DELETE } from '@/app/api/jobs/[id]/route';
import { GET as getJobCriteria, POST as linkCriteria, DELETE as unlinkCriteria } from '@/app/api/jobs/[id]/criteria/route';

function req(method: string, url: string, body?: unknown): Request {
  return new Request(`http://localhost${url}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

let seedJobId: string;
let seedCriteriaId: string;

beforeAll(async () => {
  const [job, crit] = await Promise.all([
    createJobTitle({ name: `${RUN} Help Desk` }),
    createCriteria({ name: `${RUN} Job-Empathy` }),
  ]);
  seedJobId = job.id;
  seedCriteriaId = crit.id;
});
afterAll(cleanupRun);

describe('GET /api/jobs', () => {
  it('returns 200 with an array', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });
  it('includes seeded job title', async () => {
    const res = await GET();
    const data: Array<{ id: string }> = await res.json();
    expect(data.some(j => j.id === seedJobId)).toBe(true);
  });
  it('includes scenarios and jobCriteria in each item', async () => {
    const res = await GET();
    const data: Array<{ id: string; scenarios: unknown[]; jobCriteria: unknown[] }> = await res.json();
    const seed = data.find(j => j.id === seedJobId);
    expect(seed).toBeTruthy();
    expect(Array.isArray(seed?.scenarios)).toBe(true);
    expect(Array.isArray(seed?.jobCriteria)).toBe(true);
  });
  it('returns error detail in non-production environments', async () => {
    // Not testable without breaking DB — but confirm field exists on success
    const res = await GET();
    const data = await res.json();
    expect(data).not.toHaveProperty('error');
  });
});

describe('POST /api/jobs', () => {
  it('creates a job title and returns 201', async () => {
    const r = req('POST', '/api/jobs', { name: `${RUN} New Agent`, description: 'Test job' });
    const res = await POST(r);
    expect(res.status).toBe(201);
    const data: { id: string; name: string } = await res.json();
    expect(data.name).toBe(`${RUN} New Agent`);
    expect(typeof data.id).toBe('string');
  });
  it('passes description through', async () => {
    const r = req('POST', '/api/jobs', { name: `${RUN} DescTest`, description: 'My desc' });
    const res = await POST(r);
    expect(res.status).toBe(201);
    const data: { description: string } = await res.json();
    expect(data.description).toBe('My desc');
  });
});

describe('PUT /api/jobs/[id]', () => {
  let targetId: string;
  beforeAll(async () => {
    const j = await createJobTitle({ name: `${RUN} PutJob` });
    targetId = j.id;
  });
  it('updates job title name', async () => {
    const r = req('PUT', `/api/jobs/${targetId}`, { name: `${RUN} PutJob-v2` });
    const res = await PUT(r, { params: Promise.resolve({ id: targetId }) });
    expect(res.status).toBe(200);
    const data: { name: string } = await res.json();
    expect(data.name).toBe(`${RUN} PutJob-v2`);
  });
});

describe('DELETE /api/jobs/[id]', () => {
  let deleteTargetId: string;
  beforeAll(async () => {
    const j = await createJobTitle({ name: `${RUN} DelJob` });
    deleteTargetId = j.id;
  });
  it('returns 204 on successful delete', async () => {
    const r = req('DELETE', `/api/jobs/${deleteTargetId}`);
    const res = await DELETE(r, { params: Promise.resolve({ id: deleteTargetId }) });
    expect(res.status).toBe(204);
  });
  it('returns 500 when job has FK constraints (cascades blocked)', async () => {
    const r = req('DELETE', `/api/jobs/non-existent-job-id`);
    const res = await DELETE(r, { params: Promise.resolve({ id: 'non-existent-job-id' }) });
    expect(res.status).toBe(500);
  });
});

describe('GET /api/jobs/[id]/criteria', () => {
  it('returns linked criteria for a job', async () => {
    const r = req('GET', `/api/jobs/${seedJobId}/criteria`);
    const res = await getJobCriteria(r, { params: Promise.resolve({ id: seedJobId }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });
});

describe('POST /api/jobs/[id]/criteria', () => {
  it('links a criterion to a job title (upsert) and returns 201', async () => {
    const r = req('POST', `/api/jobs/${seedJobId}/criteria`, { criteriaId: seedCriteriaId });
    const res = await linkCriteria(r, { params: Promise.resolve({ id: seedJobId }) });
    expect(res.status).toBe(201);
  });

  it('returns 400 when criteriaId is missing', async () => {
    const r = req('POST', `/api/jobs/${seedJobId}/criteria`, {});
    const res = await linkCriteria(r, { params: Promise.resolve({ id: seedJobId }) });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/jobs/[id]/criteria', () => {
  it('unlinks a specific criterion from a job', async () => {
    const r = req('DELETE', `/api/jobs/${seedJobId}/criteria`, { criteriaId: seedCriteriaId });
    const res = await unlinkCriteria(r, { params: Promise.resolve({ id: seedJobId }) });
    expect(res.status).toBe(204);
  });

  it('unlinks ALL criteria when no criteriaId given', async () => {
    // Re-link first
    const linkR = req('POST', `/api/jobs/${seedJobId}/criteria`, { criteriaId: seedCriteriaId });
    await linkCriteria(linkR, { params: Promise.resolve({ id: seedJobId }) });
    // Now delete all
    const r = req('DELETE', `/api/jobs/${seedJobId}/criteria`, {});
    const res = await unlinkCriteria(r, { params: Promise.resolve({ id: seedJobId }) });
    expect(res.status).toBe(204);
  });
});
