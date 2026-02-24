require('dotenv').config();
const Groq = require('groq-sdk').default;

async function testGroqKey() {
  const apiKey = process.env.GROQ_API_KEY?.replace(/\r/g, '');
  
  console.log('Testing Groq API Key...');
  console.log('Key present:', !!apiKey);
  console.log('Key preview:', apiKey ? apiKey.substring(0, 15) + '...' : 'MISSING');
  console.log('Key length:', apiKey?.length || 0);
  console.log('');
  
  if (!apiKey) {
    console.error('❌ GROQ_API_KEY not found in environment');
    return;
  }
  
  try {
    const groq = new Groq({ apiKey });
    
    console.log('Making test API call to Groq...');
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Say hello in one word.' }
      ],
      temperature: 0.7,
      max_tokens: 10,
    });
    
    const response = completion.choices[0]?.message?.content || '';
    console.log('✅ API call successful!');
    console.log('Response:', response);
    console.log('');
    console.log('API key is valid and working.');
    
  } catch (error) {
    console.error('❌ API call failed!');
    console.error('Error type:', error.constructor.name);
    console.error('Error message:', error.message);
    
    if (error.status) {
      console.error('HTTP status:', error.status);
    }
    
    if (error.code) {
      console.error('Error code:', error.code);
    }
    
    console.error('');
    console.error('Full error:', error);
  }
}

testGroqKey();
