/**
 * Integration tests for /api/scoring
 * Live Neon DB — no mocks.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  RUN,
  createJobTitle,
  createScenario,
  createSession,
  createCriteria,
  cleanupRun,
  prisma,
} from '../helpers/db';
import { POST } from '@/app/api/scoring/route';

function req(body: unknown): Request {
  return new Request('http://localhost/api/scoring', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

let seedSessionId: string;
let criteriaId1: string;
let criteriaId2: string;

beforeAll(async () => {
  const job = await createJobTitle({ name: `${RUN} ScoreJob` });
  const sc = await createScenario(job.id, { name: `${RUN} ScoreScenario` });
  const session = await createSession(job.id, sc.id, { userId: `score-user-${RUN}` });
  seedSessionId = session.id;

  const [c1, c2] = await Promise.all([
    createCriteria({ name: `${RUN} Empathy` }),
    createCriteria({ name: `${RUN} Resolution` }),
  ]);
  criteriaId1 = c1.id;
  criteriaId2 = c2.id;
});
afterAll(cleanupRun);

const scoreInputs = () => [
  { criteriaId: criteriaId1, score: 8, feedback: 'Good empathy.' },
  { criteriaId: criteriaId2, score: 9, feedback: 'Resolved on first call.' },
];

describe('POST /api/scoring', () => {
  it('creates scores and marks session COMPLETED (201)', async () => {
    const r = req({ sessionId: seedSessionId, scores: scoreInputs() });
    const res = await POST(r);
    expect(res.status).toBe(201);
  });

  it('returns created scores in response body', async () => {
    // Create a fresh session for this test
    const job = await createJobTitle({ name: `${RUN} ScoreJob2` });
    const sc = await createScenario(job.id, { name: `${RUN} ScoreScenario2` });
    const session = await createSession(job.id, sc.id, { userId: `score-user2-${RUN}` });

    const r = req({
      sessionId: session.id,
      scores: [{ criteriaId: criteriaId1, score: 7, feedback: 'Ok' }],
    });
    const res = await POST(r);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data[0]).toHaveProperty('id');
    expect(data[0].score).toBe(7);
  });

  it('persists session status as COMPLETED in DB', async () => {
    const job = await createJobTitle({ name: `${RUN} ScoreJob3` });
    const sc = await createScenario(job.id, { name: `${RUN} ScoreScenario3` });
    const session = await createSession(job.id, sc.id, { userId: `score-user3-${RUN}` });

    const r = req({ sessionId: session.id, scores: scoreInputs() });
    await POST(r);

    const updated = await prisma.simulationSession.findUnique({ where: { id: session.id } });
    expect(updated?.status).toBe('COMPLETED');
    expect(updated?.endedAt).toBeTruthy();
  });

  it('sets endedAt on the session', async () => {
    const job = await createJobTitle({ name: `${RUN} ScoreJob4` });
    const sc = await createScenario(job.id, { name: `${RUN} ScoreScenario4` });
    const session = await createSession(job.id, sc.id, { userId: `score-user4-${RUN}` });

    const before = new Date();
    const r = req({ sessionId: session.id, scores: scoreInputs() });
    await POST(r);
    const after = new Date();

    const updated = await prisma.simulationSession.findUnique({ where: { id: session.id } });
    const endedAt = updated?.endedAt ? new Date(updated.endedAt) : null;
    expect(endedAt).not.toBeNull();
    expect(endedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(endedAt!.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
  });

  it('returns 500 when sessionId does not exist (FK violation)', async () => {
    const r = req({
      sessionId: 'non-existent-session-xyz',
      scores: [{ criteriaId: criteriaId1, score: 5, feedback: '' }],
    });
    const res = await POST(r);
    expect(res.status).toBe(500);
  });

  it('returns 500 when criteriaId does not exist (FK violation)', async () => {
    const job = await createJobTitle({ name: `${RUN} ScoreJob5` });
    const sc = await createScenario(job.id, { name: `${RUN} ScoreScenario5` });
    const session = await createSession(job.id, sc.id, { userId: `score-user5-${RUN}` });

    const r = req({
      sessionId: session.id,
      scores: [{ criteriaId: 'non-existent-criteria-abc', score: 5, feedback: '' }],
    });
    const res = await POST(r);
    expect(res.status).toBe(500);
  });
});
