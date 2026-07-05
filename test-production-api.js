require('dotenv').config();
const fetch = require('node-fetch');

(async () => {
  try {
    // Get your auth session cookie from browser dev tools
    // For now, let's just create a test session via the API
    
    console.log('Testing direct API call to production...\n');
    
    // First, need to create a session via POST /api/simulations
    // But that requires auth... let me just check what the latest session is getting
    
    const sessionId = 'ea4f4455-aba0-47fa-a8bd-a443a9376f04'; // Most recent from DB
    
    console.log(`Fetching session ${sessionId} from production API...`);
    
    const response = await fetch(`https://xpelevator.com/api/chat?sessionId=${sessionId}`);
    const data = await response.json();
    
    console.log('\nSession data from production:');
    console.log(`Scenario: ${data.scenario?.name}`);
    console.log(`Script type: ${typeof data.scenario?.script}`);
    
    if (data.scenario?.script) {
      console.log(`\nScript content:`);
      console.log(JSON.stringify(data.scenario.script, null, 2));
    }
    
    console.log(`\nMessages: ${data.messages?.length || 0}`);
    if (data.messages?.length > 0) {
      console.log('\nFirst message:');
      console.log(data.messages[0].content);
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  }
})();
