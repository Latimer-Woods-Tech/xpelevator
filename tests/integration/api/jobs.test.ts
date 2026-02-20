/**
 * Integration tests for /api/jobs and /api/jobs/[id]
 *
 * Bridges tested:
 *   1. GET /api/jobs — job title directory is viewable
 *   2. POST /api/jobs — new job title bridge is created
 *   3. PUT /api/jobs/[id] — bridge is successfully widened/renamed
 *   4. DELETE /api/jobs/[id] — bridge is removed cleanly (returns 204)
 *   5. /api/jobs/[id]/criteria POST — plank linked to job title
 *   6. /api/jobs/[id]/criteria GET  — linked planks are visible
 *   7. /api/jobs/[id]/criteria DELETE — plank unlinked safely
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock, resetPrismaMock } from '../../mocks/prisma';

vi.mock('@/lib/prisma', () => ({ default: prismaMock }));

import { GET, POST } from '@/app/api/jobs/route';
import { PUT, DELETE } from '@/app/api/jobs/[id]/route';
import {
  GET as GET_CRITERIA,
  POST as POST_CRITERIA,
  DELETE as DELETE_CRITERIA,
} from '@/app/api/jobs/[id]/criteria/route';

// ─────────────────────────────────────────────────────────────────────────────

const SAMPLE_JOB = {
  id: 'job-001',
  name: 'Customer Service Representative',
  description: null,
  createdAt: new Date(),
  orgId: null,
  scenarios: [],
  jobCriteria: [],
};

function req(method: string, url: string, body?: unknown): Request {
  return new Request(`http://localhost${url}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/jobs', () => {
  beforeEach(resetPrismaMock);

  it('returns list of job titles with scenarios and criteria', async () => {
    prismaMock.jobTitle.findMany.mockResolvedValueOnce([SAMPLE_JOB]);
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data[0].name).toBe('Customer Service Representative');
  });

  it('returns empty array when no jobs', async () => {
    prismaMock.jobTitle.findMany.mockResolvedValueOnce([]);
    const res = await GET();
    expect((await res.json())).toEqual([]);
  });

  it('returns 500 on DB error', async () => {
    prismaMock.jobTitle.findMany.mockRejectedValueOnce(new Error('DB down'));
    const res = await GET();
    expect(res.status).toBe(500);
  });

  it('returns error detail in non-production environments', async () => {
    prismaMock.jobTitle.findMany.mockRejectedValueOnce(new Error('relation "job_titles" does not exist'));
    const res = await GET();
    const body = await res.json();
    // In test (NODE_ENV=test) the detail field should be present
    expect(body).toHaveProperty('error');
    expect(body.detail).toContain('relation "job_titles" does not exist');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/jobs', () => {
  beforeEach(resetPrismaMock);

  it('creates a job title and returns 201', async () => {
    prismaMock.jobTitle.create.mockResolvedValueOnce(SAMPLE_JOB);
    const r = req('POST', '/api/jobs', { name: 'Customer Service Representative' });
    const res = await POST(r);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBe('job-001');
  });

  it('passes description through to create', async () => {
    prismaMock.jobTitle.create.mockResolvedValueOnce({ ...SAMPLE_JOB, description: 'Handles calls' });
    const r = req('POST', '/api/jobs', { name: 'Agent', description: 'Handles calls' });
    await POST(r);
    const args = prismaMock.jobTitle.create.mock.calls[0][0] as {
      data: { description: string };
    };
    expect(args.data.description).toBe('Handles calls');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('PUT /api/jobs/[id]', () => {
  beforeEach(resetPrismaMock);

  it('updates job title name', async () => {
    const updated = { ...SAMPLE_JOB, name: 'Senior Agent' };
    prismaMock.jobTitle.update.mockResolvedValueOnce(updated);

    const r = req('PUT', '/api/jobs/job-001', { name: 'Senior Agent' });
    const res = await PUT(r, { params: Promise.resolve({ id: 'job-001' }) });

    expect(res.status).toBe(200);
    expect((await res.json()).name).toBe('Senior Agent');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('DELETE /api/jobs/[id]', () => {
  beforeEach(resetPrismaMock);

  it('returns 204 on successful delete', async () => {
    prismaMock.jobTitle.delete.mockResolvedValueOnce(SAMPLE_JOB);
    const r = req('DELETE', '/api/jobs/job-001');
    const res = await DELETE(r, { params: Promise.resolve({ id: 'job-001' }) });
    expect(res.status).toBe(204);
  });

  it('returns 500 when delete has FK constraint', async () => {
    prismaMock.jobTitle.delete.mockRejectedValueOnce(new Error('FK constraint'));
    const r = req('DELETE', '/api/jobs/job-001');
    const res = await DELETE(r, { params: Promise.resolve({ id: 'job-001' }) });
    expect(res.status).toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/jobs/[id]/criteria', () => {
  beforeEach(resetPrismaMock);

  it('returns linked criteria objects for a job title', async () => {
    // Route maps: links.map(l => l.criteria) so mock must return objects with `.criteria`
    const criterion = { id: 'crit-001', name: 'Empathy', weight: 8 };
    prismaMock.jobCriteria.findMany.mockResolvedValueOnce([{ criteria: criterion }]);
    const r = req('GET', '/api/jobs/job-001/criteria');
    const res = await GET_CRITERIA(r, { params: Promise.resolve({ id: 'job-001' }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe('crit-001');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/jobs/[id]/criteria', () => {
  beforeEach(resetPrismaMock);

  it('creates a job-criteria link (upsert)', async () => {
    const link = { id: 'jc-2', jobTitleId: 'job-001', criteriaId: 'crit-002' };
    prismaMock.jobCriteria.upsert.mockResolvedValueOnce(link);
    const r = req('POST', '/api/jobs/job-001/criteria', { criteriaId: 'crit-002' });
    const res = await POST_CRITERIA(r, { params: Promise.resolve({ id: 'job-001' }) });
    expect(res.status).toBe(201);
  });

  it('returns 400 when criteriaId is missing', async () => {
    const r = req('POST', '/api/jobs/job-001/criteria', {});
    const res = await POST_CRITERIA(r, { params: Promise.resolve({ id: 'job-001' }) });
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('DELETE /api/jobs/[id]/criteria', () => {
  beforeEach(resetPrismaMock);

  it('unlinks a specific criterion from a job title', async () => {
    // When criteriaId is provided, route calls jobCriteria.delete (single record)
    prismaMock.jobCriteria.delete.mockResolvedValueOnce({ count: 1 });
    const r = req('DELETE', '/api/jobs/job-001/criteria', { criteriaId: 'crit-001' });
    const res = await DELETE_CRITERIA(r, { params: Promise.resolve({ id: 'job-001' }) });
    expect(res.status).toBe(204);
  });

  it('unlinks ALL criteria from a job title when no criteriaId given', async () => {
    prismaMock.jobCriteria.deleteMany.mockResolvedValueOnce({ count: 3 });
    const r = req('DELETE', '/api/jobs/job-001/criteria'); // no body
    const res = await DELETE_CRITERIA(r, { params: Promise.resolve({ id: 'job-001' }) });
    expect(res.status).toBe(204);
  });
});
