/**
 * prisma/seed.ts — Repeatable seed for XPElevator reference data.
 *
 * Run with:  npx prisma db seed
 *            (or: npx tsx prisma/seed.ts)
 *
 * All writes use upsert so this is safe to run multiple times.
 */

import { PrismaClient, SimulationType, Prisma } from '@prisma/client';

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

// Scenarios are keyed by job-title name for easy linking.
const SCENARIOS: Array<{
  jobTitleName: string;
  name: string;
  description: string;
  type: SimulationType;
  script: Prisma.JsonObject;
}> = [
  // ── Customer Service Representative ──────────────────────────────────────
  {
    jobTitleName: 'Customer Service Representative',
    name: 'Billing Dispute — Unexpected Charge',
    description: 'A frustrated customer noticed an unexpected charge on their last invoice and wants an explanation and refund.',
    type: 'CHAT',
    script: {
      customerPersona:
        'You are Marcus Chen, a 38-year-old small business owner. You noticed a $49 charge on your invoice labeled "Premium Support Add-on" that you did not authorise. You are frustrated but not aggressive — you want answers and a refund. You mention your 4-year customer history when negotiating.',
      customerObjective:
        'Get the unauthorised charge reversed and receive confirmation in writing. If the agent explains the charge was a system error and offers a full refund, you are satisfied and end the call positively.',
      difficulty: 'medium',
      hints: [
        'Start by stating you have an "urgent billing question" without immediately revealing the charge amount.',
        'If the agent asks for your account number, provide "ACC-00482-B".',
        'Express mild irritation if you are put on hold without explanation.',
        'Accept a refund offer graciously — thank the agent by name if they introduced themselves.',
      ],
      maxTurns: 12,
    },
  },
  {
    jobTitleName: 'Customer Service Representative',
    name: 'Product Return — Defective Item',
    description: 'A customer received a defective product and wants to return it outside the standard 30-day window.',
    type: 'PHONE',
    script: {
      customerPersona:
        'You are Sandra Okafor, a retired teacher in her 60s. You purchased a blender 45 days ago and it stopped working after minimal use. You are polite but firm. You feel the product was defective from the start and should be covered even outside the 30-day return window.',
      customerObjective:
        'Obtain either a full replacement or full refund. You accept store credit as a last resort but prefer a refund. If the agent empathises and escalates to a supervisor or offers a one-time exception, you are satisfied.',
      difficulty: 'hard',
      hints: [
        'Begin by explaining the blender stopped working — do not immediately demand a return.',
        'When told about the 30-day policy, respond with "But it was clearly defective — this seems unreasonable."',
        'Escalate emotionally slightly if the first response is a flat refusal.',
        'Calm down if the agent acknowledges the issue and offers a path forward.',
      ],
      maxTurns: 14,
    },
  },

  // ── IT Help Desk Agent ────────────────────────────────────────────────────
  {
    jobTitleName: 'IT Help Desk Agent',
    name: 'Password Reset — Locked Account',
    description: 'An employee cannot log in after multiple failed attempts locked their account.',
    type: 'CHAT',
    script: {
      customerPersona:
        'You are Jamie Rodriguez, a marketing coordinator. You just got back from vacation and cannot log in to your work laptop — your account appears locked. You are mildly stressed because you have a meeting in 20 minutes. You are not very technical.',
      customerObjective:
        'Get your account unlocked and be able to log in before your meeting. You are resolved once the agent confirms your account is unlocked and gives you a temporary password or reset link.',
      difficulty: 'easy',
      hints: [
        'Mention the meeting deadline early to convey urgency.',
        'When asked for your employee ID, provide "MKT-7741".',
        'Ask "Will this happen again?" once resolved — expect the agent to offer MFA or password tips.',
        'Express genuine relief and thank the agent when the issue is fixed.',
      ],
      maxTurns: 10,
    },
  },
  {
    jobTitleName: 'IT Help Desk Agent',
    name: 'VPN Connectivity — Cannot Access Internal Systems',
    description: 'A remote employee cannot connect to the corporate VPN and is unable to work.',
    type: 'PHONE',
    script: {
      customerPersona:
        'You are David Park, a financial analyst working from home. Your VPN client shows "Authentication failed" every time you try to connect. You tried restarting your computer once. You are frustrated because you have a deadline today. You are moderately technical.',
      customerObjective:
        'Get connected to the VPN so you can access your financial reports. The issue is that your VPN certificate expired and needs to be re-enrolled. You are satisfied once the agent walks you through the certificate re-enrollment process and you can connect.',
      difficulty: 'medium',
      hints: [
        'Describe the exact error message: "Authentication failed — Certificate validation error (code 0x800B0101)".',
        'You already tried: restarting your machine, reinstalling the VPN client.',
        'Ask if your work will be lost or if you need to call IT again after re-enrollment.',
        'Respond positively once you can see the VPN is connected.',
      ],
      maxTurns: 14,
    },
  },

  // ── Sales Representative ──────────────────────────────────────────────────
  {
    jobTitleName: 'Sales Representative',
    name: 'Inbound Inquiry — Price Objection',
    description: 'A prospect is interested in the product but pushes back heavily on pricing.',
    type: 'CHAT',
    script: {
      customerPersona:
        'You are Priya Sharma, HR Manager at a 50-person startup. You found XPElevator through a Google search. You like what you see but think the pricing is "too expensive for a startup." You have a competing quote from a cheaper tool.',
      customerObjective:
        'Either get a meaningful discount (15%+ off) or receive a compelling reason why the ROI justifies the price. If the agent highlights unique features, offers a free trial, or provides a case study, you soften and agree to a demo.',
      difficulty: 'hard',
      hints: [
        'Open with "I found your product online — looks interesting, but your pricing page made me hesitate."',
        'Mention you have a competing quote for "$X/month" (make up a lower number, e.g., $99/month).',
        'Push back once on pricing but be open to value-based arguments.',
        'If offered a trial or case study, show genuine interest and ask about onboarding.',
      ],
      maxTurns: 12,
    },
  },
  {
    jobTitleName: 'Sales Representative',
    name: 'Post-Demo Follow-up — Decision Stall',
    description: 'A warm prospect who attended a demo is stalling the purchasing decision.',
    type: 'PHONE',
    script: {
      customerPersona:
        'You are Tom Nguyen, Operations Director at a mid-sized logistics firm. You attended an XPElevator demo two weeks ago and liked it, but have not signed. Your real concern is internal budget approval — you haven\'t asked your CFO yet because you are not sure it\'s justified.',
      customerObjective:
        'You need the sales rep to help you make the internal business case. If they provide an ROI calculator, reference customer testimonials, or offer a pilot for a small team, you commit to taking it to your CFO.',
      difficulty: 'medium',
      hints: [
        'Start with "We\'re still evaluating — no decision yet."',
        'When pressed, reveal "Honestly, I need to convince my CFO — it\'s not just my call."',
        'Respond well to data: "How much time does this actually save per employee?"',
        'Commit to a follow-up call with your CFO if the agent provides concrete ROI figures.',
      ],
      maxTurns: 12,
    },
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
        data: { description: s.description, type: s.type, script: s.script },
      });
    } else {
      await prisma.scenario.create({
        data: {
          name: s.name,
          description: s.description,
          type: s.type,
          script: s.script,
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
