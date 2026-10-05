/**
 * prisma/seed.ts — Repeatable seed for XPElevator reference data.
 *
 * Run with:  npx prisma db seed
 *            (or: npx tsx prisma/seed.ts)
 *
 * All writes use upsert so this is safe to run multiple times.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { SEED_SCENARIOS as SCENARIOS } from './seed-scenarios';

const prisma = new PrismaClient();

// ─── Seed Data ────────────────────────────────────────────────────────────────

const JOB_TITLES = [
  {
    name: 'Customer Service Representative',
    description: 'Handles billing inquiries, returns, and general product support.',
  },
  {
    name: 'IT Help Desk Agent',
    description: 'Provides first-line technical support for software and network issues.',
  },
  {
    name: 'Sales Representative',
    description: 'Engages prospects, handles objections, and closes service agreements.',
  },
];

const CRITERIA = [
  {
    name: 'Empathy & Active Listening',
    description: 'Acknowledges the customer\'s feelings and demonstrates they have been heard.',
    weight: 8,
    category: 'Communication',
  },
  {
    name: 'Problem Resolution',
    description: 'Accurately identifies the root issue and provides a clear, correct solution.',
    weight: 10,
    category: 'Competence',
  },
  {
    name: 'Communication Clarity',
    description: 'Uses clear, jargon-free language appropriate to the customer\'s level.',
    weight: 7,
    category: 'Communication',
  },
  {
    name: 'Professionalism',
    description: 'Maintains a calm, respectful, and brand-appropriate tone throughout.',
    weight: 7,
    category: 'Conduct',
  },
  {
    name: 'Product Knowledge',
    description: 'Demonstrates accurate knowledge of products, policies, and procedures.',
    weight: 8,
    category: 'Competence',
  },
  {
    name: 'Objection Handling',
    description: 'Addresses customer objections with confidence and relevant information.',
    weight: 6,
    category: 'Sales',
  },
  {
    name: 'Technical Accuracy',
    description: 'Provides technically correct troubleshooting steps without introducing new issues.',
    weight: 9,
    category: 'Technical',
  },
];

// Which criteria apply to which job titles
const JOB_CRITERIA: Record<string, string[]> = {
  'Customer Service Representative': [
    'Empathy & Active Listening',
    'Problem Resolution',
    'Communication Clarity',
    'Professionalism',
    'Product Knowledge',
  ],
  'IT Help Desk Agent': [
    'Problem Resolution',
    'Communication Clarity',
    'Professionalism',
    'Technical Accuracy',
    'Empathy & Active Listening',
  ],
  'Sales Representative': [
    'Communication Clarity',
    'Professionalism',
    'Objection Handling',
    'Product Knowledge',
    'Empathy & Active Listening',
  ],
};

// ─── Seed Functions ───────────────────────────────────────────────────────────

async function seedJobTitles() {
  console.log('  Seeding job titles…');
  for (const jt of JOB_TITLES) {
    await prisma.jobTitle.upsert({
      where: { name: jt.name },
      update: { description: jt.description },
      create: jt,
    });
  }
  console.log(`  ✔ ${JOB_TITLES.length} job titles`);
}

async function seedCriteria() {
  console.log('  Seeding criteria…');
  for (const c of CRITERIA) {
    const existing = await prisma.criteria.findFirst({ where: { name: c.name } });
    if (existing) {
      await prisma.criteria.update({
        where: { id: existing.id },
        data: { description: c.description, weight: c.weight, category: c.category },
      });
    } else {
      await prisma.criteria.create({ data: c });
    }
  }
  console.log(`  ✔ ${CRITERIA.length} criteria`);
}

async function seedScenarios() {
  console.log('  Seeding scenarios…');
  for (const s of SCENARIOS) {
    const jobTitle = await prisma.jobTitle.findUnique({ where: { name: s.jobTitleName } });
    if (!jobTitle) {
      console.warn(`  ⚠ Job title not found: ${s.jobTitleName} — skipping scenario "${s.name}"`);
      continue;
    }
    const existing = await prisma.scenario.findFirst({
      where: { name: s.name, jobTitleId: jobTitle.id },
    });
    if (existing) {
      await prisma.scenario.update({
        where: { id: existing.id },
        data: { description: s.description, type: s.type, script: s.script as Prisma.InputJsonObject },
      });
    } else {
      await prisma.scenario.create({
        data: {
          name: s.name,
          description: s.description,
          type: s.type,
          script: s.script as Prisma.InputJsonObject,
          jobTitleId: jobTitle.id,
        },
      });
    }
  }
  console.log(`  ✔ ${SCENARIOS.length} scenarios`);
}

async function seedJobCriteria() {
  console.log('  Seeding job–criteria links…');
  let linked = 0;
  for (const [jobName, criteriaNames] of Object.entries(JOB_CRITERIA)) {
    const jobTitle = await prisma.jobTitle.findUnique({ where: { name: jobName } });
    if (!jobTitle) continue;

    for (const criteriaName of criteriaNames) {
      const criteria = await prisma.criteria.findFirst({ where: { name: criteriaName } });
      if (!criteria) {
        console.warn(`  ⚠ Criteria not found: ${criteriaName}`);
        continue;
      }
      await prisma.jobCriteria.upsert({
        where: {
          jobTitleId_criteriaId: { jobTitleId: jobTitle.id, criteriaId: criteria.id },
        },
        update: {},
        create: { jobTitleId: jobTitle.id, criteriaId: criteria.id },
      });
      linked++;
    }
  }
  console.log(`  ✔ ${linked} job–criteria links`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱 XPElevator seed starting…\n');
  await seedJobTitles();
  await seedCriteria();
  await seedScenarios();
  await seedJobCriteria();
  console.log('\n✅ Seed complete.');
}

main()
  .catch(e => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
