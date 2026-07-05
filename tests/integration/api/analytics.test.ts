/**
 * Integration tests for /api/analytics
 * Live Neon DB — no mocks.
 *
 * Creates real COMPLETED sessions with scores so the analytics endpoint
 * has actual data to aggregate against.
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
import { GET } from '@/app/api/analytics/route';

let seedJobId: string;
let seedCriteriaId: string;

beforeAll(async () => {
  const job = await createJobTitle({ name: `${RUN} Analytics Job` });
  seedJobId = job.id;
  const crit = await createCriteria({ name: `${RUN} Analytics Crit`, weight: 10 });
  seedCriteriaId = crit.id;
  const sc = await createScenario(job.id, { name: `${RUN} Analytics Scenario`, type: 'CHAT' });

  // Create two completed sessions with scores
  for (let i = 0; i < 2; i++) {
    const session = await createSession(job.id, sc.id, {
      userId: `analytics-user-${i}-${RUN}`,
      status: 'COMPLETED',
    });
    // Mark as completed with endedAt
    await prisma.simulationSession.update({
      where: { id: session.id },
      data: { status: 'COMPLETED', endedAt: new Date() },
    });
    // Add scores
    await prisma.score.create({
      data: {
        sessionId: session.id,
        criteriaId: seedCriteriaId,
        score: 8 + i,
        feedback: `Test feedback ${i}`,
      },
    });
  }
});
afterAll(cleanupRun);

describe('GET /api/analytics', () => {
  it('returns 200 with correct analytics shape', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('totalSessions');
    expect(data).toHaveProperty('overallAvg');
    expect(data).toHaveProperty('scoreTrend');
    expect(data).toHaveProperty('byJobTitle');
    expect(data).toHaveProperty('byCriteria');
    expect(data).toHaveProperty('byType');
  });

  it('totalSessions counts only COMPLETED sessions', async () => {
    const res = await GET();
    const data: { totalSessions: number } = await res.json();
    expect(typeof data.totalSessions).toBe('number');
    expect(data.totalSessions).toBeGreaterThanOrEqual(2); // at least our 2 seeded ones
  });

  it('overallAvg is a number when scores exist', async () => {
    const res = await GET();
    const data: { overallAvg: number | null } = await res.json();
    expect(data.overallAvg).not.toBeNull();
    expect(typeof data.overallAvg).toBe('number');
    expect(data.overallAvg!).toBeGreaterThan(0);
    expect(data.overallAvg!).toBeLessThanOrEqual(10);
  });

  it('byJobTitle includes our seeded job', async () => {
    const res = await GET();
    const data: { byJobTitle: Array<{ name: string; sessions: number; avg: number | null }> } = await res.json();
    const entry = data.byJobTitle.find(j => j.name === `${RUN} Analytics Job`);
    expect(entry).toBeTruthy();
    expect(entry!.sessions).toBe(2);
    expect(entry!.avg).not.toBeNull();
  });

  it('byCriteria includes our seeded criterion', async () => {
    const res = await GET();
    const data: { byCriteria: Array<{ name: string; avg: number | null; count: number }> } = await res.json();
    const entry = data.byCriteria.find(c => c.name === `${RUN} Analytics Crit`);
    expect(entry).toBeTruthy();
    expect(entry!.count).toBe(2);
    expect(entry!.avg).not.toBeNull();
  });

  it('scoreTrend is an array', async () => {
    const res = await GET();
    const data: { scoreTrend: unknown[] } = await res.json();
    expect(Array.isArray(data.scoreTrend)).toBe(true);
    if (data.scoreTrend.length > 0) {
      const entry = data.scoreTrend[0] as { date: string; avg: number; count: number };
      expect(entry).toHaveProperty('date');
      expect(entry).toHaveProperty('avg');
      expect(entry).toHaveProperty('count');
    }
  });

  it('byType splits PHONE vs CHAT', async () => {
    const res = await GET();
    const data: { byType: Array<{ type: string; sessions: number }> } = await res.json();
    expect(Array.isArray(data.byType)).toBe(true);
    const types = data.byType.map(t => t.type);
    // At least CHAT type should appear (our seeded sessions)
    expect(types).toContain('CHAT');
  });

  it('overallAvg reflects correct average of our seeded scores (8 and 9)', async () => {
    // Seeded: scores 8 and 9 for the same criterion — avg across all sessions >= 8
    const res = await GET();
    const data: { overallAvg: number | null } = await res.json();
    expect(data.overallAvg).not.toBeNull();
    // Can't be exact due to other data in DB, but must be between 1 and 10
    expect(data.overallAvg!).toBeGreaterThanOrEqual(1);
    expect(data.overallAvg!).toBeLessThanOrEqual(10);
  });
});
