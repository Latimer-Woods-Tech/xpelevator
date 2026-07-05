#!/usr/bin/env node
/**
 * patch-unenv.js
 * 
 * Patches @cloudflare/workers-shared/polyfills/fs.js to add a stub for fs.readdir.
 * Prisma's platform detection code calls fs.readdir even when using driver adapters.
 * This patch prevents runtime errors in Cloudflare Workers.
 * 
 * Run this after npm install or as a postinstall script.
 */

const fs = require('fs');
const path = require('path');

// Try multiple possible locations for the unenv fs polyfill
const possiblePaths = [
  './node_modules/@cloudflare/workers-shared/polyfills/fs.js',
  './node_modules/@opennextjs/cloudflare/node_modules/@cloudflare/workers-shared/polyfills/fs.js',
  './.open-next/server-functions/default/node_modules/@cloudflare/workers-shared/polyfills/fs.js',
];

for (const fsPolyfillPath of possiblePaths) {
  const fullPath = path.resolve(__dirname, '..', fsPolyfillPath);
  
  if (!fs.existsSync(fullPath)) {
    continue;
  }

  let content = fs.readFileSync(fullPath, 'utf8');
  
  // Check if already patched
  if (content.includes('function readdir(')) {
    console.log(`✅ ${fsPolyfillPath} already patched`);
    continue;
  }

  // Add readdir stub after the fs object export
  const patch = `
// Patched by scripts/patch-unenv.js - stub for Prisma platform detection
export function readdir(...args) {
  const callback = args[args.length - 1];
  if (typeof callback === 'function') {
    // Async version - return empty array
    callback(null, []);
  }
  // Sync version would throw, but Prisma uses async
  throw new Error('[unenv] fs.readdir is not implemented yet!');
}
`;

  // Insert the patch at the end of the file
  content += '\n' + patch;
  
  fs.writeFileSync(fullPath, content, 'utf8');
  console.log(`✅ Patched ${fsPolyfillPath} with fs.readdir stub`);
}

console.log('✅ unenv patch complete');
