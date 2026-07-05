const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkScripts() {
  const scenarios = await prisma.scenario.findMany({ include: { jobTitle: true } });
  
  scenarios.forEach(s => {
    const script = typeof s.script === 'string' ? JSON.parse(s.script) : s.script;
    console.log(`\n${'='.repeat(80)}`);
    console.log(`${s.name} (${s.type})`);
    console.log(`Job: ${s.jobTitle.name}`);
    console.log(`${'='.repeat(80)}`);
    console.log('Script:', JSON.stringify(script, null, 2));
  });
  
  await prisma.$disconnect();
}

checkScripts().catch(console.error);
