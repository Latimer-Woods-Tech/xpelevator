import { NextRequest, NextResponse } from 'next/server';
import { getGroqClient } from '@/lib/groq-fetch';

// Test endpoint to diagnose Groq API issues
// GET /api/debug/groq
export async function GET(request: NextRequest) {
  const result: Record<string, any> = {
    timestamp: new Date().toISOString(),
    apiKeyPresent: !!process.env.GROQ_API_KEY,
    apiKeyLength: process.env.GROQ_API_KEY?.length || 0,
    apiKeyPreview: process.env.GROQ_API_KEY?.substring(0, 10) + '...',
  };
  
  try {
    console.log('[Debug Groq] Starting Groq API test call...');
    const client = getGroqClient();
    
    console.log('[Debug Groq] Groq client initialized, making test API call...');
    const completion = await client.chatCompletion({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: 'Say "test successful" and nothing else.' }],
      temperature: 0.5,
      max_tokens: 20,
    });
    
    console.log('[Debug Groq] API call completed successfully');
    result.success = true;
    result.response = completion.choices[0]?.message?.content || '(empty response)';
    result.model = completion.model;
    
  } catch (error) {
    console.error('[Debug Groq] API call failed:', error);
    result.success = false;
    result.error = {
      message: error instanceof Error ? error.message : String(error),
      type: error?.constructor?.name || 'Unknown',
      stack: error instanceof Error ? error.stack : undefined,
      // @ts-ignore - Groq SDK might have specific error fields
      status: error?.status,
      // @ts-ignore
      statusText: error?.statusText,
      // @ts-ignore
      code: error?.code,
      // @ts-ignore - Full error object for debugging
      raw: JSON.stringify(error, Object.getOwnPropertyNames(error)),
    };
  }
  
  return NextResponse.json(result, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
