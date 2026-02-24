// Test production Groq API endpoint after polyfill fix
const https = require('https');

function testEndpoint(url, label) {
  return new Promise((resolve) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          console.log(`\n=== ${label} ===`);
          console.log(JSON.stringify(result, null, 2));
          resolve(result);
        } catch (e) {
          console.log(`\n=== ${label} (Parse Error) ===`);
          console.log(data.substring(0, 200));
          resolve(null);
        }
      });
    }).on('error', err => {
      console.log(`\n=== ${label} (Error) ===`);
      console.log(err.message);
      resolve(null);
    });
  });
}

async function main() {
  console.log('Testing XPElevator production endpoints...\n');
  console.log('Waiting 30s for potential deployment to finish...');
  await new Promise(r => setTimeout(r, 30000));
  
  const groqTest = await testEndpoint(
    'https://xpelevator.com/api/debug/groq',
    'Groq API Test'
  );
  
  if (groqTest?.success) {
    console.log('\n✅✅✅ GROQ API IS WORKING! ✅✅✅');
    console.log('Response:', groqTest.response);
  } else if (groqTest && !groqTest.success) {
    console.log('\n❌ Groq API still failing:');
    console.log('Error:', groqTest.error?.message);
  }
}

main().catch(console.error);
