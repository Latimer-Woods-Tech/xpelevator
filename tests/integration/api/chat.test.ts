/**
 * Integration tests for /api/chat
 * Live Neon DB — Prisma uses the real database.
 * AI (Groq) calls are mocked to avoid network costs and non-determinism.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

// ── AI mock (keep — no real Groq calls in tests) ─────────────────────────────
vi.mock('@/lib/ai', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/ai')>();
  return {
    ...original,
    streamNextCustomerMessage: vi.fn(async function* () {
      yield 'Hello, ';
      yield 'I am the ';
      yield 'customer.';
    }),
    scoreSession: vi.fn().mockResolvedValue([
      { criteriaId: '', criteriaName: 'Empathy', score: 8, justification: 'Good empathy.' },
    ]),
    buildSessionSystemPrompt: original.buildSessionSystemPrompt,
  };
});

import {
  RUN,
  createJobTitle,
  createScenario,
  createSession,
  createCriteria,
  cleanupRun,
  prisma,
} from '../helpers/db';
import { GET, POST } from '@/app/api/chat/route';

function getReq(sessionId: string): Request {
  return new Request(`http://localhost/api/chat?sessionId=${sessionId}`, {
    method: 'GET',
  });
}

function postReq(body: { sessionId: string; content: string }): Request {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

let seedJobId: string;
let seedScenarioId: string;
let seedSessionId: string;

beforeAll(async () => {
  const job = await createJobTitle({ name: `${RUN} Chat Job` });
  seedJobId = job.id;
  const crit = await createCriteria({ name: `${RUN} Chat Empathy` });
  // Link criteria to job
  await prisma.jobCriteria.create({ data: { jobTitleId: job.id, criteriaId: crit.id } });
  const sc = await createScenario(job.id, {
    name: `${RUN} Chat Scenario`,
    type: 'CHAT',
    script: { customerPersona: 'Frustrated customer', customerObjective: 'Refund', difficulty: 'medium' },
  });
  seedScenarioId = sc.id;
  const session = await createSession(job.id, sc.id, {
    userId: `chat-user-${RUN}`,
    type: 'CHAT',
    status: 'IN_PROGRESS',
  });
  seedSessionId = session.id;
});
afterAll(cleanupRun);

// ─── GET /api/chat ────────────────────────────────────────────────────────────

describe('GET /api/chat (session state)', () => {
  it('returns 400 when sessionId is missing', async () => {
    const r = new Request('http://localhost/api/chat', { method: 'GET' });
    const res = await GET(r);
    expect(res.status).toBe(400);
  });

  it('returns 404 when session does not exist', async () => {
    const r = getReq('non-existent-session-xyz');
    const res = await GET(r);
    expect(res.status).toBe(404);
  });

  it('returns 200 with session data for a valid sessionId', async () => {
    const r = getReq(seedSessionId);
    const res = await GET(r);
    expect(res.status).toBe(200);
    const data: { id: string; status: string; messages: unknown[] } = await res.json();
    expect(data.id).toBe(seedSessionId);
    expect(data.status).toBe('IN_PROGRESS');
    expect(Array.isArray(data.messages)).toBe(true);
  });

  it('includes scenario and jobTitle in session response', async () => {
    const r = getReq(seedSessionId);
    const res = await GET(r);
    const data: { scenario: unknown; jobTitle: unknown } = await res.json();
    expect(data.scenario).toBeTruthy();
    expect(data.jobTitle).toBeTruthy();
  });
});

// ─── POST /api/chat ───────────────────────────────────────────────────────────

describe('POST /api/chat', () => {
  it('returns 400 when sessionId is missing', async () => {
    const r = postReq({ sessionId: '', content: 'Hello' });
    const res = await POST(r);
    expect(res.status).toBe(400);
  });

  it('returns 400 when content is missing', async () => {
    const r = postReq({ sessionId: seedSessionId, content: '' });
    const res = await POST(r);
    expect(res.status).toBe(400);
  });

  it('returns 404 for a nonexistent sessionId', async () => {
    const r = postReq({ sessionId: 'no-such-session-abc', content: 'Hello' });
    const res = await POST(r);
    expect(res.status).toBe(404);
  });

  it('[START] signal returns SSE stream with AI greeting', async () => {
    const r = postReq({ sessionId: seedSessionId, content: '[START]' });
    const res = await POST(r);
    // SSE returns ReadableStream (200 implied by stream)
    expect(res.body).toBeTruthy();
    // Read first chunk
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain('data:');
    reader.cancel();
  });

  it('agent message is saved to DB and AI reply is streamed', async () => {
    // Create a fresh session for this test
    const session = await createSession(seedJobId, seedScenarioId, {
      userId: `chat-post-user-${RUN}`,
      type: 'CHAT',
      status: 'IN_PROGRESS',
    });
    const r = postReq({ sessionId: session.id, content: 'I need help with my bill' });
    const res = await POST(r);
    expect(res.body).toBeTruthy();
    // Drain stream
    const reader = res.body!.getReader();
    let done = false;
    while (!done) {
      const result = await reader.read();
      done = result.done;
    }
    // Verify agent message saved to DB
    const messages = await prisma.chatMessage.findMany({
      where: { sessionId: session.id, role: 'AGENT' },
    });
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0].content).toBe('I need help with my bill');
  });

  it('returns 400 for a COMPLETED session', async () => {
    // Create and mark session as completed
    const session = await createSession(seedJobId, seedScenarioId, {
      userId: `chat-closed-${RUN}`,
      status: 'COMPLETED',
    });
    await prisma.simulationSession.update({
      where: { id: session.id },
      data: { status: 'COMPLETED', endedAt: new Date() },
    });
    const r = postReq({ sessionId: session.id, content: 'Hello' });
    const res = await POST(r);
    expect(res.status).toBe(400);
  });

  it('SSE stream emits done event at end', async () => {
    const session = await createSession(seedJobId, seedScenarioId, {
      userId: `chat-stream-${RUN}`,
      type: 'CHAT',
      status: 'IN_PROGRESS',
    });
    const r = postReq({ sessionId: session.id, content: '[START]' });
    const res = await POST(r);
    expect(res.body).toBeTruthy();

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let done = false;
    while (!done) {
      const result = await reader.read();
      done = result.done;
      if (result.value) fullText += decoder.decode(result.value);
    }
    expect(fullText).toContain('"type":"done"');
  });
});
