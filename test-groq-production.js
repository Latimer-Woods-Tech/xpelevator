const https = require('https');

console.log('Testing Groq API endpoint...\n');

https.get('https://xpelevator.com/api/debug/groq', (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    try {
      const result = JSON.parse(data);
      console.log('✅ Response received:\n');
      console.log(JSON.stringify(result, null, 2));
      
      if (result.success) {
        console.log('\n✅✅✅ GROQ API IS WORKING IN PRODUCTION! ✅✅✅');
        console.log('Response:', result.response);
      } else {
        console.log('\n❌ Groq API failed:');
        console.log('Error:', result.error?.message);
      }
    } catch (e) {
      console.log('❌ Failed to parse response:', data.substring(0, 500));
    }
  });
}).on('error', (err) => {
  console.log('❌ HTTP request failed:', err.message);
});
