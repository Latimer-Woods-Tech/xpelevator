import { PrismaClient } from '@prisma/client';
import { PrismaNeonHTTP } from '@prisma/adapter-neon';

const url = process.env.DATABASE_URL?.replace(/\r/g/, '');
const adapter = new PrismaNeonHTTP(url, {});
const prisma = new PrismaClient({ adapter });

async function test() {
  try {
    const sessionId = crypto.randomUUID();
    await prisma.$queryRaw`
      INSERT INTO simulation_sessions (id, user_id, job_title_id, scenario_id, type, status, started_at, created_at)
      VALUES (${sessionId}, 'test', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', '00784f25-0824-49c5-89af-e62d3e55b4ce', 'PHONE', 'IN_PROGRESS', NOW(), NOW())
    `;

    const session = await prisma.simulationSession.findUnique({
      where: { id: sessionId },
      include: { scenario: true, jobTitle: true },
    });

    console.log('Success:', session.id);
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

test();