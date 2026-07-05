// Quick test to see if GroqClient can be instantiated
import { GroqClient } from './src/lib/groq-client.js';

const client = new GroqClient({ apiKey: 'test-key' });
console.log('✅ GroqClient instantiated successfully');
console.log('Client:', client);
