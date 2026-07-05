# Cloudflare Reference — XPElevator

XPElevator targets **Cloudflare Pages** for hosting and **Cloudflare Workers** for edge API routes.

**Tools**: Wrangler CLI, `@cloudflare/next-on-pages` adapter
**Docs**: https://developers.cloudflare.com/pages/framework-guides/nextjs/

---

## Deployment Architecture

```
Browser → Cloudflare CDN → Cloudflare Pages (static assets)
                         → Cloudflare Workers (API routes, SSR)
                         → Neon Postgres (via Workers → pooled connection)
```

---

## Setup

### Install Dependencies

```bash
npm install --save-dev @cloudflare/next-on-pages wrangler
```

### `wrangler.toml`

Create at project root:

```toml
name = "xpelevator"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]
pages_build_output_dir = ".vercel/output/static"

[vars]
NODE_ENV = "production"
```

> `nodejs_compat` flag is required for Prisma and Node.js built-in modules in Workers.

---

## next-on-pages Adapter

The `@cloudflare/next-on-pages` package transforms the Next.js build output into Cloudflare-compatible format.

### Build Command

```json
// package.json
{
  "scripts": {
    "build": "next build",
    "build:cf": "npx @cloudflare/next-on-pages",
    "preview": "npx wrangler pages dev .vercel/output/static",
    "deploy": "npm run build && npm run build:cf && wrangler pages deploy"
  }
}
```

### API Route Edge Runtime

Routes that run in Workers **must** opt into the edge runtime:

```ts
// src/app/api/chat/route.ts
export const runtime = 'edge';  // ← required for Cloudflare Workers

export async function POST(request: Request) { ... }
```

Routes without `export const runtime = 'edge'` will attempt to run in Node.js — not available in Workers.

**What needs `runtime = 'edge'`**:
- `/api/chat` (streaming SSE)
- `/api/telnyx/webhook`
- Any route that streams or uses Telnyx SDK

**What should NOT use edge**:
- Routes that use Prisma with `@prisma/client` (Prisma doesn't yet fully support edge — use Prisma Accelerate or the `@prisma/adapter-neon` for edge)

---

## Prisma on Cloudflare Workers

Standard `@prisma/client` uses Node.js TCP sockets — not available in Workers (edge runtime).

### Option A: Neon HTTP Driver (pg-over-HTTP)

```bash
npm install @neondatabase/serverless
```

```ts
// src/lib/prisma-edge.ts
import { neon } from '@neondatabase/serverless';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaClient } from '@prisma/client';

const neonClient = neon(process.env.DATABASE_URL!);
const adapter = new PrismaNeon(neonClient);

export const prismaEdge = new PrismaClient({ adapter });
```

Add to `schema.prisma`:
```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["driverAdapters"]
}
```

### Option B: Prisma Accelerate (managed connection pooler)

Use Prisma's data proxy: `https://accelerate.prisma.io` — handles edge compatibility automatically. Recommended for production.

---

## Environment Variables

### Local Preview

```bash
# .dev.vars (local Workers dev env — NOT .env)
DATABASE_URL=postgresql://...
GROQ_API_KEY=gsk_...
```

### Production

```bash
# Via Wrangler CLI
wrangler pages secret put DATABASE_URL
wrangler pages secret put GROQ_API_KEY
wrangler pages secret put TELNYX_API_KEY
```

Or via Cloudflare Dashboard → Pages → [project] → Settings → Environment Variables.

---

## Local Development with Wrangler

```bash
# Preview the Cloudflare environment locally
npm run build && npm run build:cf
npx wrangler pages dev .vercel/output/static

# This runs at http://localhost:8788 (not 3000)
```

For day-to-day development, use `npm run dev` (Next.js Turbopack at port 3000). Only preview with Wrangler when testing edge-specific behavior.

---

## Deployment

```bash
# First deploy (creates the Pages project)
npx wrangler pages project create xpelevator

# Subsequent deploys
npm run deploy
# Equivalent to: next build && npx @cloudflare/next-on-pages && wrangler pages deploy
```

### Domain Configuration

1. Cloudflare Dashboard → Pages → xpelevator → Custom Domains
2. Add `xpelevator.com` and `www.xpelevator.com`
3. Cloudflare manages DNS automatically (domain is already with Cloudflare)

---

## CI/CD with GitHub Actions

```yaml
# .github/workflows/deploy.yml
name: Deploy to Cloudflare Pages

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - run: npm ci

      - run: npx prisma generate

      - run: npm run build

      - run: npx @cloudflare/next-on-pages

      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy .vercel/output/static --project-name=xpelevator
```

Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as GitHub repository secrets.

---

## Cloudflare Workers KV (for session state)

If Durable Objects are needed for stateful WebSocket connections:

```toml
# wrangler.toml
[[durable_objects.bindings]]
name = "SIMULATION_SESSION"
class_name = "SimulationSession"

[[migrations]]
tag = "v1"
new_classes = ["SimulationSession"]
```

For the XPElevator MVP, **SSE (Server-Sent Events) is preferred** over WebSockets — it's simpler, stateless, and works within standard HTTP model.

---

## Cloudflare Pages Limits (Free Plan)

| Limit | Value |
|-------|-------|
| Requests/day | 100,000 |
| Build minutes/month | 500 |
| Custom domains | Unlimited |
| Workers CPU time | 10ms per request |
| Response size | 25 MB |

For training simulations (chat + scoring), 10ms CPU limit is tight for AI calls. Use **background processing**: route POST to immediately queue, return 202, let Worker call Groq async. Or use the Paid plan (Workers Paid: $5/month, 30s CPU).
