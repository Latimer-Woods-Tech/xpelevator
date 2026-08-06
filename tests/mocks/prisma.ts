/**
 * Typed Prisma mock client.
 *
 * Use in test files:
 *   vi.mock('@/lib/prisma', () => ({ default: prismaMock }));
 *
 * Then in each test: prismaMock.criteria.findMany.mockResolvedValue([...])
 */
import { vi } from 'vitest';

function mockModel() {
  return {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    count: vi.fn(),
    upsert: vi.fn(),
    aggregate: vi.fn(),
  };
}

export const prismaMock = {
  criteria: mockModel(),
  jobTitle: mockModel(),
  scenario: mockModel(),
  simulationSession: mockModel(),
  chatMessage: mockModel(),
  score: mockModel(),
  organization: mockModel(),
  user: mockModel(),
  jobCriteria: mockModel(),
  $transaction: vi.fn(async (ops: unknown) => {
    // If ops is an array of promises, resolve them all
    if (Array.isArray(ops)) {
      return Promise.all(ops);
    }
    // If ops is a function (interactive transaction), call it with prismaMock
    if (typeof ops === 'function') {
      return (ops as (tx: typeof prismaMock) => Promise<unknown>)(prismaMock);
    }
    return ops;
  }),
  $connect: vi.fn(),
  $disconnect: vi.fn(),
};

/** Reset all mock implementations/call counts between tests. */
export function resetPrismaMock() {
  const models = [
    'criteria', 'jobTitle', 'scenario', 'simulationSession',
    'chatMessage', 'score', 'organization', 'user', 'jobCriteria',
  ] as const;

  for (const model of models) {
    const m = prismaMock[model] as Record<string, ReturnType<typeof vi.fn>>;
    for (const fn of Object.values(m)) fn.mockReset();
  }
  prismaMock.$transaction.mockReset();
  // Restore default $transaction behaviour
  prismaMock.$transaction.mockImplementation(async (ops: unknown) => {
    if (Array.isArray(ops)) return Promise.all(ops);
    if (typeof ops === 'function') {
      return (ops as (tx: typeof prismaMock) => Promise<unknown>)(prismaMock);
    }
    return ops;
  });
}
