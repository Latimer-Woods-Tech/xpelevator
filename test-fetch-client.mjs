// Test the groq-fetch client
import { getGroqClient } from './src/lib/groq-fetch.ts';

async function test() {
  try {
    const client = getGroqClient();
    console.log('Client created successfully');
    
    const response = await client.chatCompletion({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'user', content: 'Say "test successful" and nothing else.' }
      ],
      temperature: 0.5,
      max_tokens: 20,
    });
    
    console.log('Success:', response.choices[0]?.message?.content);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
  }
}

test();
