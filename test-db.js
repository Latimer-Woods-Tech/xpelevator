import { PrismaClient } from '@prisma/client';
import { PrismaNeonHTTP } from '@prisma/adapter-neon';

const url = process.env.DATABASE_URL?.replace(/\r/g, '');
if (!url) throw new Error('DATABASE_URL is not set');

const adapter = new PrismaNeonHTTP(url, {});
const prisma = new PrismaClient({ adapter });

async function test() {
  try {
    const count = await prisma.jobTitle.count();
    console.log('Job titles count:', count);

    const jobs = await prisma.jobTitle.findMany();
    console.log('Jobs:', jobs);

    const scenarios = await prisma.scenario.findMany();
    console.log('Scenarios:', scenarios);

    // Try to create a simulation with raw SQL
    const result = await prisma.$queryRaw`
      INSERT INTO simulation_sessions (id, user_id, job_title_id, scenario_id, type, status, started_at, created_at)
      VALUES (gen_random_uuid(), 'test', ${jobs[0].id}, ${scenarios[0].id}, 'PHONE', 'IN_PROGRESS', NOW(), NOW())
      RETURNING id
    `;
    console.log('Raw SQL result:', result);

    const session = await prisma.simulationSession.findUnique({
      where: { id: result[0].id },
      include: { scenario: true, jobTitle: true },
    });
    console.log('Fetched session:', session);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

test();