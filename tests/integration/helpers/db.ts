/**
 * Live-database test helpers for integration tests.
 *
 * Uses the real Neon Postgres connection (DATABASE_URL from .env) so tests
 * exercise the true stack end-to-end — no mocks.
 *
 * Each test run gets a unique prefix so artefacts don't collide and cleanup
 * can target only this run's data.
 */

import prisma from '@/lib/prisma';

export { prisma };

/** Unique run identifier — use as a name prefix for all test artefacts. */
export const RUN = `[TEST-${Date.now().toString(36).toUpperCase()}]`;

// ─── Data factories ───────────────────────────────────────────────────────────

export async function createCriteria(overrides: Partial<{
  name: string;
  description: string | null;
  weight: number;
  category: string | null;
  active: boolean;
}> = {}) {
  return prisma.criteria.create({
    data: {
      name: overrides.name ?? `${RUN} Test Criteria`,
      description: overrides.description ?? 'Auto-created by integration tests',
      weight: overrides.weight ?? 7,
      category: overrides.category ?? 'TEST',
      active: overrides.active ?? true,
    },
  });
}

export async function createJobTitle(overrides: Partial<{
  name: string;
  description: string | null;
}> = {}) {
  return prisma.jobTitle.create({
    data: {
      name: overrides.name ?? `${RUN} Test Job`,
      description: overrides.description ?? 'Auto-created by integration tests',
    },
  });
}

export async function createScenario(jobTitleId: string, overrides: Partial<{
  name: string;
  description: string | null;
  type: 'PHONE' | 'CHAT';
  script: Record<string, unknown>;
}> = {}) {
  return prisma.scenario.create({
    data: {
      jobTitleId,
      name: overrides.name ?? `${RUN} Test Scenario`,
      description: overrides.description ?? null,
      type: overrides.type ?? 'CHAT',
      script: overrides.script ?? {
        customerPersona: 'A frustrated test customer',
        customerObjective: 'Get a refund',
        difficulty: 'medium',
      },
    },
  });
}

export async function createSession(jobTitleId: string, scenarioId: string, overrides: Partial<{
  userId: string;
  type: 'PHONE' | 'CHAT';
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
}> = {}) {
  return prisma.simulationSession.create({
    data: {
      jobTitleId,
      scenarioId,
      userId: overrides.userId ?? `test-user-${RUN}`,
      type: overrides.type ?? 'CHAT',
      status: overrides.status ?? 'IN_PROGRESS',
      startedAt: new Date(),
    },
  });
}

export async function createOrganization(overrides: Partial<{
  name: string;
  slug: string;
}> = {}) {
  const name = overrides.name ?? `${RUN} Test Org`;
  const slug = overrides.slug ?? name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return prisma.organization.create({ data: { name, slug } });
}

// ─── Cleanup helpers ──────────────────────────────────────────────────────────

/** Delete all records whose name starts with the RUN prefix. */
export async function cleanupRun() {
  // Order matters — dependents first
  await prisma.score.deleteMany({
    where: {
      session: {
        OR: [
          { userId: { startsWith: 'test-user-' } },
          { jobTitle: { name: { startsWith: RUN } } },
        ],
      },
    },
  });
  await prisma.chatMessage.deleteMany({
    where: { session: { jobTitle: { name: { startsWith: RUN } } } },
  });
  await prisma.simulationSession.deleteMany({
    where: {
      OR: [
        { jobTitle: { name: { startsWith: RUN } } },
        { userId: `test-user-${RUN}` },
      ],
    },
  });
  await prisma.jobCriteria.deleteMany({
    where: {
      OR: [
        { jobTitle: { name: { startsWith: RUN } } },
        { criteria: { name: { startsWith: RUN } } },
      ],
    },
  });
  await prisma.scenario.deleteMany({
    where: { jobTitle: { name: { startsWith: RUN } } },
  });
  await prisma.jobTitle.deleteMany({ where: { name: { startsWith: RUN } } });
  await prisma.criteria.deleteMany({ where: { name: { startsWith: RUN } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: '@xpelevator-test.dev' } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: RUN } } });
}

/** Delete a single criteria record by id. */
export async function deleteCriteria(id: string) {
  await prisma.jobCriteria.deleteMany({ where: { criteriaId: id } });
  await prisma.criteria.deleteMany({ where: { id } });
}

/** Delete a single job title (and its linked data) by id. */
export async function deleteJobTitle(id: string) {
  await prisma.jobCriteria.deleteMany({ where: { jobTitleId: id } });
  await prisma.scenario.deleteMany({ where: { jobTitleId: id } });
  await prisma.jobTitle.deleteMany({ where: { id } });
}
