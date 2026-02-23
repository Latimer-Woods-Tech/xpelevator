const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkData() {
  const jobs = await prisma.jobTitle.findMany();
  const criteria = await prisma.criteria.findMany();
  const scenarios = await prisma.scenario.findMany({ include: { jobTitle: true } });
  
  console.log('=== JOB TITLES ===');
  console.log(`Total: ${jobs.length}\n`);
  jobs.forEach(j => console.log(`- ${j.name}`));
  
  console.log('\n=== CRITERIA ===');
  console.log(`Total: ${criteria.length}\n`);
  criteria.forEach(c => console.log(`- ${c.name} (weight: ${c.weight}, category: ${c.category || 'none'})`));
  
  console.log('\n=== SCENARIOS ===');
  console.log(`Total: ${scenarios.length}\n`);
  
  // Group by job title
  const byJob = {};
  scenarios.forEach(s => {
    const jobName = s.jobTitle.name;
    if (!byJob[jobName]) byJob[jobName] = [];
    byJob[jobName].push(s);
  });
  
  Object.entries(byJob).forEach(([jobName, scenes]) => {
    console.log(`\n${jobName} (${scenes.length} scenarios):`);
    scenes.forEach(s => {
      const script = typeof s.script === 'string' ? JSON.parse(s.script) : s.script;
      console.log(`  - ${s.name}`);
      console.log(`    Type: ${s.type}, Difficulty: ${script.difficulty || 'unknown'}`);
      console.log(`    Has persona: ${!!script.customerPersona}, Has objective: ${!!script.customerObjective}`);
      console.log(`    Max turns: ${script.maxTurns || 'unlimited'}`);
    });
  });
  
  await prisma.$disconnect();
}

checkData().catch(console.error);
