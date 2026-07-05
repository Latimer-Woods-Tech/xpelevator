/**
 * Integration tests for /api/criteria and /api/criteria/[id]
 *
 * Bridges tested:
 *   1. GET /api/criteria  — bridge exists, list is accessible
 *   2. POST /api/criteria — lay a new plank on the bridge
 *   3. PUT /api/criteria/[id] — reinforce an existing plank
 *   4. DELETE /api/criteria/[id] — remove a plank safely
 *   5. DB failure returns 500 — bridge buckles, user is informed
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock, resetPrismaMock } from '../../mocks/prisma';

vi.mock('@/lib/prisma', () => ({ default: prismaMock }));

import { GET, POST } from '@/app/api/criteria/route';
import {
  PUT,
  DELETE,
} from '@/app/api/criteria/[id]/route';

// ─────────────────────────────────────────────────────────────────────────────

const SAMPLE_CRITERION = {
  id: 'crit-001',
  name: 'Empathy',
  description: 'Demonstrates empathy',
  weight: 8,
  category: 'Communication',
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  orgId: null,
};

function makeRequest(method: string, body?: unknown): Request {
  return new Request('http://localhost/api/criteria', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function makeParamRequest(method: string, id: string, body?: unknown): Request {
  return new Request(`http://localhost/api/criteria/${id}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/criteria', () => {
  beforeEach(resetPrismaMock);

  it('returns 200 with array of criteria', async () => {
    prismaMock.criteria.findMany.mockResolvedValueOnce([SAMPLE_CRITERION]);

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe('Empathy');
  });

  it('returns empty array when no criteria in DB', async () => {
    prismaMock.criteria.findMany.mockResolvedValueOnce([]);
    const res = await GET();
    const data = await res.json();
    expect(data).toEqual([]);
  });

  it('returns 500 when DB throws', async () => {
    prismaMock.criteria.findMany.mockRejectedValueOnce(new Error('DB error'));
    const res = await GET();
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/criteria', () => {
  beforeEach(resetPrismaMock);

  it('creates a criterion and returns 201', async () => {
    const newCriterion = { ...SAMPLE_CRITERION, id: 'crit-002', name: 'Resolution' };
    prismaMock.criteria.create.mockResolvedValueOnce(newCriterion);

    const req = makeRequest('POST', { name: 'Resolution', weight: 9, active: true });
    const res = await POST(req);

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.name).toBe('Resolution');
    expect(prismaMock.criteria.create).toHaveBeenCalledOnce();
  });

  it('defaults weight to 5 when not provided', async () => {
    prismaMock.criteria.create.mockResolvedValueOnce(SAMPLE_CRITERION);
    const req = makeRequest('POST', { name: 'Clarity' });
    await POST(req);

    const createArgs = prismaMock.criteria.create.mock.calls[0][0] as {
      data: { weight: number };
    };
    expect(createArgs.data.weight).toBe(5);
  });

  it('defaults active to true when not provided', async () => {
    prismaMock.criteria.create.mockResolvedValueOnce(SAMPLE_CRITERION);
    const req = makeRequest('POST', { name: 'Tone' });
    await POST(req);

    const createArgs = prismaMock.criteria.create.mock.calls[0][0] as {
      data: { active: boolean };
    };
    expect(createArgs.data.active).toBe(true);
  });

  it('returns 500 on DB failure', async () => {
    prismaMock.criteria.create.mockRejectedValueOnce(new Error('DB error'));
    const req = makeRequest('POST', { name: 'Empathy' });
    const res = await POST(req);
    expect(res.status).toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('PUT /api/criteria/[id]', () => {
  beforeEach(resetPrismaMock);

  it('updates and returns 200', async () => {
    const updated = { ...SAMPLE_CRITERION, weight: 10 };
    prismaMock.criteria.update.mockResolvedValueOnce(updated);

    const req = makeParamRequest('PUT', 'crit-001', { weight: 10 });
    const res = await PUT(req, { params: Promise.resolve({ id: 'crit-001' }) });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.weight).toBe(10);
  });

  it('returns 500 when update fails', async () => {
    prismaMock.criteria.update.mockRejectedValueOnce(new Error('Not found'));
    const req = makeParamRequest('PUT', 'bad-id', { weight: 5 });
    const res = await PUT(req, { params: Promise.resolve({ id: 'bad-id' }) });
    expect(res.status).toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('DELETE /api/criteria/[id]', () => {
  beforeEach(resetPrismaMock);

  it('returns 200 with success:true on delete', async () => {
    prismaMock.criteria.delete.mockResolvedValueOnce(SAMPLE_CRITERION);
    const req = makeParamRequest('DELETE', 'crit-001');
    const res = await DELETE(req, { params: Promise.resolve({ id: 'crit-001' }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  it('returns 500 when delete fails (e.g. has FK references)', async () => {
    prismaMock.criteria.delete.mockRejectedValueOnce(new Error('FK constraint'));
    const req = makeParamRequest('DELETE', 'crit-001');
    const res = await DELETE(req, { params: Promise.resolve({ id: 'crit-001' }) });
    expect(res.status).toBe(500);
  });
});
