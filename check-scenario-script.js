require('dotenv').config();
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

(async () => {
  try {
    const scenarios = await sql`
      SELECT id, name, script
      FROM scenarios
      WHERE name LIKE '%Product Return%'
    `;
    
    console.log('\n=== Product Return Scenarios ===\n');
    
    for (const scenario of scenarios) {
      console.log(`Scenario: ${scenario.name}`);
      console.log(`ID: ${scenario.id}`);
      console.log(`Script type: ${typeof scenario.script}`);
      console.log(`Script:`, JSON.stringify(scenario.script, null, 2));
      console.log('---\n');
    }
    
    // Also check if there are any active sessions for this scenario
    const sessions = await sql`
      SELECT ss.id, ss.status, s.name as scenario_name
      FROM simulation_sessions ss
      JOIN scenarios s ON s.id = ss.scenario_id
      WHERE s.name LIKE '%Product Return%'
      ORDER BY ss.created_at DESC
      LIMIT 5
    `;
    
    console.log('\n=== Recent Product Return Sessions ===\n');
    sessions.forEach(s => {
      console.log(`Session ${s.id}: ${s.status} - ${s.scenario_name}`);
    });
    
  } catch (error) {
    console.error('Error:', error.message);
  }
})();
