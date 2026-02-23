#!/usr/bin/env node
/**
 * bundle-worker.js
 *
 * Prepares .open-next/assets/_worker.js for Cloudflare Pages Advanced Mode:
 *  1. Adjusts import paths from "./" to "../" so wrangler can resolve siblings
 *     from inside the assets/ directory.
 *  2. Injects env.ASSETS.fetch() handling for static asset paths so that
 *     /_next/static/*, /favicon.ico, /robots.txt, etc. are served directly from
 *     the Pages static asset store instead of being routed through the Next.js
 *     server (which has no filesystem access and would 404 them).
 *
 * In Cloudflare Pages Advanced Mode the worker is invoked for EVERY request—
 * including ones that match deployed static files.  The worker must explicitly
 * call env.ASSETS.fetch(request) to serve those files.
 */

const fs = require("fs");
const path = require("path");

const SRC = path.resolve(__dirname, "../.open-next/worker.js");
const DEST = path.resolve(__dirname, "../.open-next/assets/_worker.js");

if (!fs.existsSync(SRC)) {
  console.error("ERROR: .open-next/worker.js not found. Run pages:build first.");
  process.exit(1);
}

let src = fs.readFileSync(SRC, "utf8");

// ── 1. Fix import paths ────────────────────────────────────────────────────
// worker.js uses "./cloudflare/...", "./middleware/...", etc.
// From inside assets/_worker.js those paths must be "../cloudflare/...", etc.
src = src.replace(/".\//g, '"../');

// ── 2. Inject static-asset proxy ─────────────────────────────────────────
// Target the line that parses the URL inside the fetch handler so we can
// short-circuit static asset paths before any Next.js logic runs.
const INJECT_AFTER = "const url = new URL(request.url);";
const STATIC_ASSET_HANDLER = `
            // Serve static assets via the Cloudflare Pages ASSETS binding.
            // In Pages Advanced Mode every request reaches the worker, so we
            // must explicitly proxy /_next/static/ (and other well-known static
            // paths) to the ASSETS KV store.
            if (env.ASSETS) {
                const p = url.pathname;
                const isStatic =
                    p.startsWith("/_next/static/") ||
                    p === "/favicon.ico" ||
                    p === "/robots.txt" ||
                    p === "/sitemap.xml" ||
                    p.startsWith("/images/") ||
                    p.startsWith("/fonts/");
                if (isStatic) {
                    const assetResp = await env.ASSETS.fetch(request);
                    if (assetResp.status !== 404) {
                        return assetResp;
                    }
                }
            }
`;

if (src.includes(INJECT_AFTER)) {
  src = src.replace(INJECT_AFTER, INJECT_AFTER + STATIC_ASSET_HANDLER);
  console.log("✅ Injected ASSETS proxy for static paths.");
} else {
  console.warn(
    "⚠️  Could not find injection point in worker.js – static assets may 404. " +
      "Check that @opennextjs/cloudflare worker format hasn't changed."
  );
}

// ── 3. Patch Prisma fs.readdir in handler.mjs ────────────────────────────────
// Prisma's library runtime includes platform detection code that calls fs.readdir
// even when using driver adapters. Replace this with a stub to prevent runtime errors.
const HANDLER_PATH = path.resolve(__dirname, "../.open-next/server-functions/default/handler.mjs");
if (fs.existsSync(HANDLER_PATH)) {
  let handler = fs.readFileSync(HANDLER_PATH, "utf8");
  
  // Replace fs.readdir calls with a stub that returns empty array
  // The readdir call is in a try-catch, so returning [] is safe
  if (handler.includes("mi.default.readdir")) {
    handler = handler.replace(
      /mi\.default\.readdir\(([^)]+)\)/g,
      '(async () => { throw { code: "ENOENT" }; })()'
    );
    fs.writeFileSync(HANDLER_PATH, handler, "utf8");
    console.log("✅ Patched Prisma fs.readdir calls in handler.mjs");
  }
} else {
  console.warn("⚠️  handler.mjs not found – Prisma fs.readdir calls may fail at runtime");
}

// ── 4. Write output ────────────────────────────────────────────────────────
fs.mkdirSync(path.dirname(DEST), { recursive: true});
fs.writeFileSync(DEST, src, "utf8");
console.log(`✅ _worker.js written to ${DEST}`);

