require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function checkSession() {
  const sessionId = '26abb6f6-e515-4e05-8e3d-5d85c1562865';
  
  console.log('Checking if session exists...');
  const result = await sql`
    SELECT id, status, type, scenario_id, job_title_id 
    FROM simulation_sessions 
    WHERE id = ${sessionId}
  `;
  
  if (result.length === 0) {
    console.log('Session NOT FOUND. Getting list of recent sessions...');
    const recent = await sql`
      SELECT id, status, type, created_at 
      FROM simulation_sessions 
      ORDER BY created_at DESC 
      LIMIT 5
    `;
    console.log('\nRecent sessions:');
    recent.forEach(s => console.log(`  ${s.id} - ${s.status} (${s.type})`));
  } else {
    console.log('Session found:', result[0]);
    
    // Test the actual query from the route
    console.log('\nTesting the full query pattern...');
    try {
      const fullResult = await sql`
        SELECT 
          ss.id,
          json_build_object('id', s.id, 'name', s.name) as scenario,
          json_build_object('id', jt.id, 'name', jt.name) as "jobTitle",
          COALESCE(
            json_agg(
              DISTINCT jsonb_build_object(
                'id', m.id,
                'role', m.role,
                'content', m.content,
                'timestamp', m.timestamp
              ) ORDER BY jsonb_build_object(
                'id', m.id,
                'role', m.role,
                'content', m.content,
                'timestamp', m.timestamp
              )
            ) FILTER (WHERE m.id IS NOT NULL),
            '[]'
          ) as messages
        FROM simulation_sessions ss
        LEFT JOIN scenarios s ON s.id = ss.scenario_id
        LEFT JOIN job_titles jt ON jt.id = ss.job_title_id
        LEFT JOIN chat_messages m ON m.session_id = ss.id
        WHERE ss.id = ${sessionId}
        GROUP BY ss.id, s.id, jt.id
      `;
      
      if (fullResult.length > 0) {
        console.log('✓ Query succeeded!');
        console.log('  Scenario:', fullResult[0].scenario?.name);
        console.log('  Job:', fullResult[0].jobTitle?.name);
        console.log('  Messages:', fullResult[0].messages.length);
      } else {
        console.log('✗ Query returned no results');
      }
    } catch (err) {
      console.error('✗ Query failed:', err.message);
      console.error('Full error:', err);
    }
  }
}

checkSession().catch(console.error);
