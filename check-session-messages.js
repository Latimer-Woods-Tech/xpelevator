require('dotenv').config();
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

(async () => {
  try {
    // Get the most recent IN_PROGRESS product return session
    const sessions = await sql`
      SELECT ss.id, ss.status, s.name as scenario_name, s.script
      FROM simulation_sessions ss
      JOIN scenarios s ON s.id = ss.scenario_id
      WHERE s.name LIKE '%Product Return%' AND ss.status = 'IN_PROGRESS'
      ORDER BY ss.created_at DESC
      LIMIT 1
    `;
    
    if (sessions.length === 0) {
      console.log('No IN_PROGRESS Product Return sessions found');
      return;
    }
    
    const session = sessions[0];
    console.log(`\n=== Session ${session.id} ===`);
    console.log(`Status: ${session.status}`);
    console.log(`Scenario: ${session.scenario_name}`);
    console.log(`Script:`, JSON.stringify(session.script, null, 2));
    
    // Get messages for this session
    const messages = await sql`
      SELECT id, role, content, timestamp
      FROM chat_messages
      WHERE session_id = ${session.id}
      ORDER BY timestamp ASC
    `;
    
    console.log(`\n=== Messages (${messages.length} total) ===\n`);
    
    messages.forEach((msg, i) => {
      const time = new Date(msg.timestamp).toLocaleTimeString();
      console.log(`[${i + 1}] ${time} - ${msg.role}:`);
      console.log(`    ${msg.content}`);
      console.log();
    });
    
  } catch (error) {
    console.error('Error:', error.message);
  }
})();
