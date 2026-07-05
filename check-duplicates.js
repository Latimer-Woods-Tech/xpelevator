require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function checkDuplicates() {
  const sessionId = '26abb6f6-e515-4e05-8e3d-5d85c1562865';
  
  // Get all messages for the session
  const messages = await sql`
    SELECT id, role, content, timestamp
    FROM chat_messages
    WHERE session_id = ${sessionId}
    ORDER BY timestamp ASC
  `;
  
  console.log(`\nTotal messages: ${messages.length}`);
  console.log('\nMessage history:');
  messages.forEach((m, i) => {
    console.log(`${i + 1}. [${m.role}] ${m.content.substring(0, 60)}... (${m.timestamp})`);
  });
  
  // Check for duplicates
  const contentMap = new Map();
  messages.forEach(m => {
    const key = `${m.role}:${m.content}`;
    contentMap.set(key, (contentMap.get(key) || 0) + 1);
  });
  
  console.log('\nDuplicate messages:');
  let hasDupes = false;
  contentMap.forEach((count, key) => {
    if (count > 1) {
      hasDupes = true;
      console.log(`  ${count}x: ${key.substring(0, 80)}`);
    }
  });
  
  if (!hasDupes) {
    console.log('  None found');
  }
}

checkDuplicates().catch(console.error);
