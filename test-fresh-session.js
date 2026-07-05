require('dotenv').config();
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

(async () => {
  try {
    // Get the session from the URL
    const sessionId = process.argv[2];
    
    if (!sessionId) {
      console.log('Usage: node test-fresh-session.js <session-id>');
      console.log('\nRecent Product Return sessions:');
      
      const sessions = await sql`
        SELECT ss.id, ss.status, ss.created_at, s.name
        FROM simulation_sessions ss
        JOIN scenarios s ON s.id = ss.scenario_id
        WHERE s.name LIKE '%Product Return%'
        ORDER BY ss.created_at DESC
        LIMIT 5
      `;
      
      sessions.forEach(s => {
        console.log(`${s.id} - ${s.status} - ${new Date(s.created_at).toLocaleString()}`);
      });
      return;
    }
    
    // Get messages for this specific session
    const messages = await sql`
      SELECT role, content, timestamp
      FROM chat_messages
      WHERE session_id = ${sessionId}
      ORDER BY timestamp ASC
    `;
    
    console.log(`\n=== Session ${sessionId} ===`);
    console.log(`Messages: ${messages.length}\n`);
    
    messages.forEach((msg, i) => {
      console.log(`[${i + 1}] ${msg.role}:`);
      console.log(`    ${msg.content.substring(0, 150)}${msg.content.length > 150 ? '...' : ''}`);
      console.log();
    });
    
  } catch (error) {
    console.error('Error:', error.message);
  }
})();
