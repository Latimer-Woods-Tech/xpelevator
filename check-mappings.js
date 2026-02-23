const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkMappings() {
  const jobs = await prisma.jobTitle.findMany({
    include: {
      jobCriteria: {
        include: {
          criteria: true
        }
      }
    }
  });
  
  console.log('=== JOB-CRITERIA MAPPINGS ===\n');
  
  jobs.forEach(job => {
    console.log(`${job.name}:`);
    if (job.jobCriteria.length === 0) {
      console.log('  ⚠️  NO CRITERIA MAPPED!');
    } else {
      job.jobCriteria.forEach(jc => {
        console.log(`  - ${jc.criteria.name} (weight: ${jc.criteria.weight})`);
      });
    }
    console.log('');
  });
  
  await prisma.$disconnect();
}

checkMappings().catch(console.error);
