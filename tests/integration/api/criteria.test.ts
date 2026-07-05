/**
 * Integration tests for /api/criteria and /api/criteria/[id]
 * Live Neon DB — no mocks.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RUN, createCriteria, cleanupRun } from '../helpers/db';
import { GET, POST } from '@/app/api/criteria/route';
import { PUT, DELETE } from '@/app/api/criteria/[id]/route';

function req(method: string, body?: unknown): Request {
  return new Request('http://localhost/api/criteria', {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}
function idReq(method: string, id: string, body?: unknown): Request {
  return new Request(`http://localhost/api/criteria/${id}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

let seedId: string;

beforeAll(async () => {
  const c = await createCriteria({ name: `${RUN} Empathy`, weight: 8, category: 'Communication', active: true });
  seedId = c.id;
});
afterAll(cleanupRun);

describe('GET /api/criteria', () => {
  it('returns 200 with an array', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });
  it('includes seeded test criterion', async () => {
    const res = await GET();
    const data: Array<{ id: string }> = await res.json();
    expect(data.some(c => c.id === seedId)).toBe(true);
  });
  it('returns items ordered by name asc', async () => {
    const res = await GET();
    const data: Array<{ name: string }> = await res.json();
    // Use Unicode code-point comparison to match Postgres C-collation order
    for (let i = 1; i < data.length; i++) {
      expect(data[i - 1].name <= data[i].name).toBe(true);
    }
  });
});

describe('POST /api/criteria', () => {
  it('creates a criterion and returns 201', async () => {
    const r = req('POST', { name: `${RUN} Resolution`, weight: 9, active: true });
    const res = await POST(r);
    expect(res.status).toBe(201);
    const data: { name: string; weight: number } = await res.json();
    expect(data.name).toBe(`${RUN} Resolution`);
    expect(data.weight).toBe(9);
  });
  it('defaults weight to 5 when not provided', async () => {
    const r = req('POST', { name: `${RUN} Clarity` });
    const res = await POST(r);
    expect(res.status).toBe(201);
    const data: { weight: number } = await res.json();
    expect(data.weight).toBe(5);
  });
  it('defaults active to true when not provided', async () => {
    const r = req('POST', { name: `${RUN} Tone` });
    const res = await POST(r);
    expect(res.status).toBe(201);
    const data: { active: boolean } = await res.json();
    expect(data.active).toBe(true);
  });
  it('returns 500 when name is missing (DB constraint)', async () => {
    const r = req('POST', { description: 'no name' });
    const res = await POST(r);
    expect(res.status).toBe(500);
  });
});

describe('PUT /api/criteria/[id]', () => {
  let targetId: string;
  beforeAll(async () => {
    const c = await createCriteria({ name: `${RUN} PutTarget` });
    targetId = c.id;
  });
  it('updates and returns 200', async () => {
    const r = idReq('PUT', targetId, { name: `${RUN} PutTarget-v2`, weight: 10 });
    const res = await PUT(r, { params: Promise.resolve({ id: targetId }) });
    expect(res.status).toBe(200);
    const data: { weight: number; name: string } = await res.json();
    expect(data.weight).toBe(10);
    expect(data.name).toBe(`${RUN} PutTarget-v2`);
  });
  it('returns 500 when id does not exist', async () => {
    const r = idReq('PUT', 'does-not-exist-xyz', { weight: 1 });
    const res = await PUT(r, { params: Promise.resolve({ id: 'does-not-exist-xyz' }) });
    expect(res.status).toBe(500);
  });
});

describe('DELETE /api/criteria/[id]', () => {
  let targetId: string;
  beforeAll(async () => {
    const c = await createCriteria({ name: `${RUN} DelTarget` });
    targetId = c.id;
  });
  it('deletes and returns 200 { success: true }', async () => {
    const r = idReq('DELETE', targetId);
    const res = await DELETE(r, { params: Promise.resolve({ id: targetId }) });
    expect(res.status).toBe(200);
    const data: { success: boolean } = await res.json();
    expect(data.success).toBe(true);
  });
  it('returns 500 when id does not exist', async () => {
    const r = idReq('DELETE', 'no-such-id-999');
    const res = await DELETE(r, { params: Promise.resolve({ id: 'no-such-id-999' }) });
    expect(res.status).toBe(500);
  });
});
