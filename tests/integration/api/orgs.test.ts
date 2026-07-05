/**
 * Integration tests for /api/orgs, /api/orgs/[id], /api/orgs/[id]/members
 * Live Neon DB — no mocks.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RUN, createOrganization, cleanupRun } from '../helpers/db';
import { GET, POST } from '@/app/api/orgs/route';
import { GET as getOrg, PUT, DELETE } from '@/app/api/orgs/[id]/route';
import {
  GET as getMembers,
  POST as addMember,
  DELETE as removeMember,
} from '@/app/api/orgs/[id]/members/route';

function req(method: string, url: string, body?: unknown): Request {
  return new Request(`http://localhost${url}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

let seedOrgId: string;
const seedOrgName = `${RUN} Acme Corp`;

beforeAll(async () => {
  const org = await createOrganization({ name: seedOrgName });
  seedOrgId = org.id;
});
afterAll(cleanupRun);

// ─── GET /api/orgs ────────────────────────────────────────────────────────────

describe('GET /api/orgs', () => {
  it('returns 200 with an array', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it('includes seeded org in results', async () => {
    const res = await GET();
    const data: Array<{ id: string }> = await res.json();
    expect(data.some(o => o.id === seedOrgId)).toBe(true);
  });

  it('includes _count field on each org', async () => {
    const res = await GET();
    const data: Array<{ id: string; _count: unknown }> = await res.json();
    const entry = data.find(o => o.id === seedOrgId);
    expect(entry?._count).toBeTruthy();
  });
});

// ─── POST /api/orgs ───────────────────────────────────────────────────────────

describe('POST /api/orgs', () => {
  it('creates an org and returns 201 with id and name', async () => {
    const r = req('POST', '/api/orgs', { name: `${RUN} Beta Inc` });
    const res = await POST(r);
    expect(res.status).toBe(201);
    const data: { id: string; name: string; slug: string } = await res.json();
    expect(data.name).toBe(`${RUN} Beta Inc`);
    expect(typeof data.id).toBe('string');
    expect(typeof data.slug).toBe('string');
  });

  it('auto-generates a slug from the name', async () => {
    const r = req('POST', '/api/orgs', { name: `${RUN} Auto Slug Test` });
    const res = await POST(r);
    const data: { slug: string } = await res.json();
    expect(data.slug).toMatch(/[a-z0-9-]+/);
    expect(data.slug).not.toMatch(/\s/);
  });

  it('returns 400 when name is missing', async () => {
    const r = req('POST', '/api/orgs', {});
    const res = await POST(r);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when name is blank', async () => {
    const r = req('POST', '/api/orgs', { name: '   ' });
    const res = await POST(r);
    expect(res.status).toBe(400);
  });
});

// ─── GET /api/orgs/[id] ───────────────────────────────────────────────────────

describe('GET /api/orgs/[id]', () => {
  it('returns org with users and count', async () => {
    const r = req('GET', `/api/orgs/${seedOrgId}`);
    const res = await getOrg(r, { params: Promise.resolve({ id: seedOrgId }) });
    expect(res.status).toBe(200);
    const data: { id: string; users: unknown[]; _count: unknown } = await res.json();
    expect(data.id).toBe(seedOrgId);
    expect(Array.isArray(data.users)).toBe(true);
    expect(data._count).toBeTruthy();
  });

  it('returns 404 for nonexistent id', async () => {
    const r = req('GET', '/api/orgs/no-such-id');
    const res = await getOrg(r, { params: Promise.resolve({ id: 'no-such-id' }) });
    expect(res.status).toBe(404);
  });
});

// ─── PUT /api/orgs/[id] ───────────────────────────────────────────────────────

describe('PUT /api/orgs/[id]', () => {
  it('updates org name and returns 200', async () => {
    const r = req('PUT', `/api/orgs/${seedOrgId}`, { name: `${RUN} Acme Corp v2` });
    const res = await PUT(r, { params: Promise.resolve({ id: seedOrgId }) });
    expect(res.status).toBe(200);
    const data: { name: string } = await res.json();
    expect(data.name).toBe(`${RUN} Acme Corp v2`);
  });

  it('returns 500 for nonexistent id', async () => {
    const r = req('PUT', '/api/orgs/bogus-id', { name: 'X' });
    const res = await PUT(r, { params: Promise.resolve({ id: 'bogus-id' }) });
    expect(res.status).toBe(500);
  });
});

// ─── DELETE /api/orgs/[id] ────────────────────────────────────────────────────

describe('DELETE /api/orgs/[id]', () => {
  it('returns 204 on successful delete (org without sessions)', async () => {
    const org = await createOrganization({ name: `${RUN} Del Org` });
    const r = req('DELETE', `/api/orgs/${org.id}`);
    const res = await DELETE(r, { params: Promise.resolve({ id: org.id }) });
    expect(res.status).toBe(204);
  });

  it('returns 500 for nonexistent id', async () => {
    const r = req('DELETE', '/api/orgs/non-existent-org-abc');
    const res = await DELETE(r, { params: Promise.resolve({ id: 'non-existent-org-abc' }) });
    expect(res.status).toBe(500);
  });
});

// ─── GET /api/orgs/[id]/members ──────────────────────────────────────────────

describe('GET /api/orgs/[id]/members', () => {
  it('returns 200 with an array of members', async () => {
    const r = req('GET', `/api/orgs/${seedOrgId}/members`);
    const res = await getMembers(r, { params: Promise.resolve({ id: seedOrgId }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });
});

// ─── POST /api/orgs/[id]/members ─────────────────────────────────────────────

describe('POST /api/orgs/[id]/members', () => {
  it('adds a new member by email and returns 201', async () => {
    const email = `test-member-${Date.now()}@xpelevator-test.dev`;
    const r = req('POST', `/api/orgs/${seedOrgId}/members`, { email, name: 'Test Member' });
    const res = await addMember(r, { params: Promise.resolve({ id: seedOrgId }) });
    expect(res.status).toBe(201);
    const data: { email: string; orgId: string } = await res.json();
    expect(data.email).toBe(email);
    expect(data.orgId).toBe(seedOrgId);
  });

  it('returns 400 when email is missing', async () => {
    const r = req('POST', `/api/orgs/${seedOrgId}/members`, {});
    const res = await addMember(r, { params: Promise.resolve({ id: seedOrgId }) });
    expect(res.status).toBe(400);
  });

  it('upserts existing member (links to new org)', async () => {
    const email = `upsert-test-${Date.now()}@xpelevator-test.dev`;
    // Add twice — second call should succeed and update orgId
    const r1 = req('POST', `/api/orgs/${seedOrgId}/members`, { email });
    await addMember(r1, { params: Promise.resolve({ id: seedOrgId }) });
    const r2 = req('POST', `/api/orgs/${seedOrgId}/members`, { email, role: 'ADMIN' });
    const res = await addMember(r2, { params: Promise.resolve({ id: seedOrgId }) });
    expect(res.status).toBe(201);
    const data: { role: string } = await res.json();
    expect(data.role).toBe('ADMIN');
  });
});

// ─── DELETE /api/orgs/[id]/members ───────────────────────────────────────────

describe('DELETE /api/orgs/[id]/members', () => {
  it('removes user from org and returns 200', async () => {
    const email = `remove-test-${Date.now()}@xpelevator-test.dev`;
    // Add member first
    const addR = req('POST', `/api/orgs/${seedOrgId}/members`, { email });
    const addRes = await addMember(addR, { params: Promise.resolve({ id: seedOrgId }) });
    const { id: userId } = await addRes.json();

    const r = req('DELETE', `/api/orgs/${seedOrgId}/members`, { userId });
    const res = await removeMember(r, { params: Promise.resolve({ id: seedOrgId }) });
    expect(res.status).toBe(204);
  });

  it('returns 400 when userId is missing', async () => {
    const r = req('DELETE', `/api/orgs/${seedOrgId}/members`, {});
    const res = await removeMember(r, { params: Promise.resolve({ id: seedOrgId }) });
    expect(res.status).toBe(400);
  });

  it('returns 404 when user is not in this org', async () => {
    const r = req('DELETE', `/api/orgs/${seedOrgId}/members`, { userId: 'user-not-in-org' });
    const res = await removeMember(r, { params: Promise.resolve({ id: seedOrgId }) });
    expect(res.status).toBe(404);
  });
});
