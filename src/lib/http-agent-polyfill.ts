/**
 * http.Agent polyfill for Cloudflare Workers
 * 
 * groq-sdk tries to access http.Agent.maxCachedSessions which doesn't exist
 * in Cloudflare Workers. This polyfill provides a minimal stub to prevent errors.
 */

// Aggressive polyfill - always provide http.Agent in globalThis
// This runs before groq-sdk is imported
const g = globalThis as any;

if (!g.http) {
  g.http = {};
}

if (!g.https) {
  g.https = {};
}

class Agent {
  maxCachedSessions = 100;
  constructor(_options?: any) {
    // Stub - just accept options but don't use them
  }
}

g.http.Agent = Agent;
g.https.Agent = Agent;

// Also set on global if it's different from globalThis
if (typeof global !== 'undefined' && global !== globalThis) {
  const gl = global as any;
  if (!gl.http) gl.http = {};
  if (!gl.https) gl.https = {};
  gl.http.Agent = Agent;
  gl.https.Agent = Agent;
}

export {};
