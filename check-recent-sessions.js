require('dotenv').config();
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

(async () => {
  try {
    // Get the most recent 3 IN_PROGRESS Product Return sessions with their message counts
    const sessions = await sql`
      SELECT 
        ss.id,
        ss.created_at,
        ss.status,
        s.name as scenario,
        COUNT(m.id) as message_count
      FROM simulation_sessions ss
      JOIN scenarios s ON s.id = ss.scenario_id
      LEFT JOIN chat_messages m ON m.session_id = ss.id
      WHERE s.name LIKE '%Product Return%' AND ss.status = 'IN_PROGRESS'
      GROUP BY ss.id, s.id, s.name
      ORDER BY ss.created_at DESC
      LIMIT 3
    `;
    
    console.log('\n=== Recent Product Return Sessions ===\n');
    
    for (const session of sessions) {
      const created = new Date(session.created_at);
      const age = Math.round((Date.now() - created.getTime()) / 1000 / 60); // minutes ago
      
      console.log(`Session: ${session.id}`);
      console.log(`Created: ${created.toLocaleString()} (${age} min ago)`);
      console.log(`Messages: ${session.message_count}`);
      console.log(`Status: ${session.status}`);
      
      // Get the actual messages
      const messages = await sql`
        SELECT role, content, timestamp
        FROM chat_messages
        WHERE session_id = ${session.id}
        ORDER BY timestamp ASC
      `;
      
      console.log('\nConversation:');
      messages.forEach((msg, i) => {
        const preview = msg.content.length > 80 
          ? msg.content.substring(0, 80) + '...' 
          : msg.content;
        console.log(`  [${i+1}] ${msg.role}: ${preview}`);
      });
      
      console.log('\n---\n');
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  }
})();
