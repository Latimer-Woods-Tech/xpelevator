# XPElevator — Engineering Guide

This document is the primary reference for developers working on XPElevator. It covers environment setup, conventions, project structure, and operational runbooks.

---

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Local Development Setup](#local-development-setup)
3. [Project Structure](#project-structure)
4. [Environment Variables](#environment-variables)
5. [Database Management](#database-management)
6. [Code Conventions](#code-conventions)
7. [API Design Conventions](#api-design-conventions)
8. [Branching & Git Workflow](#branching--git-workflow)
9. [Deployment](#deployment)
10. [Debugging Guide](#debugging-guide)
11. [Common Tasks](#common-tasks)

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 20+ (LTS) | Runtime (Windows native preferred, not WSL) |
| npm | 10+ | Package manager |
| Git | Any | Source control |
| VS Code | Latest | Editor (recommended) |

> **Windows Note**: Always run `npm install` and `npx prisma generate` from a **native Windows terminal** (cmd.exe or PowerShell), not WSL. WSL filesystem access to NTFS causes `EACCES`/`EPERM` errors with certain binary packages (`@next/swc-win32-x64-msvc`).

---

## Local Development Setup

```bash
# 1. Clone the repo
git clone https://github.com/adrper79-dot/xpelevator.git
cd xpelevator

# 2. Install dependencies (Windows cmd or PowerShell — NOT WSL)
npm install

# 3. Copy environment template
cp .env.example .env
# — Fill in your values (see Environment Variables section)

# 4. Generate Prisma client
npx prisma generate

# 5. Start the dev server (Turbopack)
npm run dev
```

App runs at **http://localhost:3000**.

### First-time Database Setup

The Neon database already has the schema applied. If you need to re-apply:
```bash
# Introspect existing schema (do NOT run prisma migrate on Neon production without a temp branch)
npx prisma db pull

# Or push schema changes to a dev/branch database
npx prisma db push
```

See [Database Management](#database-management) for details on the Neon branching strategy.

---

## Project Structure

```
xpelevator/
├── prisma/
│   ├── schema.prisma           # Single source of truth for DB schema (10 models, 4 enums)
│   ├── seed.ts                 # Idempotent seed: job titles, criteria, scenarios, job-criteria links
│   ├── prisma.config.ts        # Prisma CLI config (replaces deprecated package.json#prisma)
│   └── migrations/             # SQL migration history (prisma migrate)
├── src/
│   ├── auth.ts                 # NextAuth v5 config (GitHub + Credentials, JWT strategy)
│   ├── middleware.ts            # Edge middleware — protects /admin routes
│   ├── app/
│   │   ├── page.tsx            # Home / landing page
│   │   ├── layout.tsx          # Root layout (SessionProvider, fonts, metadata)
│   │   ├── globals.css         # Tailwind v4 CSS
│   │   ├── error.tsx           # Global error boundary
│   │   ├── not-found.tsx       # 404 page
│   │   ├── providers.tsx       # Client-side React context providers
│   │   ├── admin/page.tsx      # Admin panel — 4 tabs: Criteria, Jobs, Scenarios, Job↔Criteria
│   │   ├── analytics/page.tsx  # Analytics dashboard — score trends, heatmap, breakdowns
│   │   ├── auth/signin/page.tsx # NextAuth sign-in page
│   │   ├── sessions/
│   │   │   ├── page.tsx        # Session list with score bars
│   │   │   ├── loading.tsx     # Skeleton loader
│   │   │   └── [id]/page.tsx   # Session detail: transcript + per-criteria scores
│   │   ├── simulate/
│   │   │   ├── page.tsx        # Job + scenario selector; triggers POST /api/simulations
│   │   │   ├── loading.tsx     # Skeleton loader
│   │   │   └── [sessionId]/page.tsx  # Active simulation: chat UI (SSE) + phone UI (poll)
│   │   └── api/
│   │       ├── analytics/      # GET — score trends, per-criteria stats, job/type breakdowns
│   │       ├── auth/[...nextauth]/  # NextAuth v5 route handler
│   │       ├── chat/           # POST (SSE stream) + GET (session loader)
│   │       ├── criteria/       # GET + POST; [id]/: GET, PUT, DELETE
│   │       ├── health/         # GET — DB connectivity probe
│   │       ├── jobs/           # GET + POST; [id]/: GET, PUT, DELETE; [id]/criteria/: POST, DELETE
│   │       ├── orgs/           # GET + POST; [id]/: GET, PUT, DELETE; [id]/members/: GET, POST
│   │       ├── scenarios/      # GET + POST; [id]/: GET, PUT, DELETE
│   │       ├── scoring/        # POST — create score records for a session
│   │       ├── simulations/    # GET + POST
│   │       └── telnyx/
│   │           ├── call/       # POST — initiate outbound Telnyx call
│   │           └── webhook/    # POST — receive Telnyx Call Control events
│   ├── lib/
│   │   ├── ai.ts               # Groq client (lazy dynamic import); virtual customer prompts; scoring
│   │   ├── env.ts              # Env var validation (warn dev / throw prod)
│   │   ├── prisma.ts           # Prisma client (Neon HTTP adapter, CF Workers compatible)
│   │   └── telnyx.ts           # Telnyx helper: callSpeak, callGather, callHangup, encode/decodeClientState
│   └── types/
│       └── index.ts            # Shared TypeScript types + SSE event payload types
├── tests/
│   ├── unit/                   # Unit tests (vitest)
│   ├── integration/api/        # API integration tests
│   ├── ui/                     # React component tests (@testing-library)
│   ├── e2e/                    # End-to-end simulation test
│   └── mocks/prisma.ts         # Prisma mock for unit/integration tests
├── docs/
│   ├── ARCHITECTURE.md         # C4 + Mermaid diagrams, scenario catalog, scoring rubric
│   ├── BACKLOG.md              # Product & engineering backlog (BL-001 — BL-057)
│   ├── ENGINEERING.md          # This file — setup, conventions, runbooks
│   ├── ROADMAP.md              # Phase plan, gap analysis, ADR log
│   └── tech/                   # Per-technology reference docs (Groq, Telnyx, Prisma, etc.)
├── scripts/
│   └── bundle-worker.js        # esbuild bundler for CF Worker output
├── .env                        # Local secrets (never commit)
├── .env.example                # Template (always keep updated)
├── next.config.ts              # Next.js config (images.unoptimized, eslint skip on build)
├── open-next.config.ts         # @opennextjs/cloudflare config (dummy cache/queue for now)
├── prisma.config.ts            # Prisma CLI config (points to prisma/schema.prisma)
├── wrangler.toml               # Cloudflare Pages deployment config
├── vitest.config.ts            # Vitest + jsdom test runner config
└── package.json
```

---

## Environment Variables

All secrets live in `.env` (never committed). Use `.env.example` as the template.

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | Neon Postgres connection string (use **pooler** endpoint for app, direct for migrations) |
| `GROQ_API_KEY` | ✅ | Groq API key for AI virtual customer responses and auto-scoring |
| `AUTH_SECRET` | ✅ | NextAuth v5 secret — generate with `openssl rand -base64 32` |
| `AUTH_GITHUB_ID` | ⬜ | GitHub OAuth App client ID (omit to disable GitHub login) |
| `AUTH_GITHUB_SECRET` | ⬜ | GitHub OAuth App client secret |
| `TELNYX_API_KEY` | ⬜ | Telnyx API key for phone simulations |
| `TELNYX_CONNECTION_ID` | ⬜ | Telnyx Call Control App (SIP connection) ID |
| `TELNYX_FROM_NUMBER` | ⬜ | E.164 number that Telnyx dials **from** (e.g., `+14155551234`) |
| `CLOUDFLARE_API_TOKEN` | ⬜ | Cloudflare API token — needed only for `wrangler` CLI deploys |
| `CLOUDFLARE_ACCOUNT_ID` | ⬜ | Cloudflare account ID |

### Neon Connection String Format
```
postgresql://neondb_owner:<password>@<endpoint>-pooler.<region>.aws.neon.tech/neondb?sslmode=require
```
Use the **pooler** endpoint (port 5432) for all application connections. Use the **direct** endpoint only for migrations.

---

## Database Management

### Neon Project
- **Project ID**: `aged-butterfly-52244878`
- **Database**: `neondb`
- **Region**: `us-east-1`
- **Primary branch**: `main`
- **Tables**: 10 (organizations, users, job_titles, scenarios, criteria, job_criteria, simulation_sessions, chat_messages, scores, _prisma_migrations)

### Workflow: Schema Changes

The project is on **Prisma Migrate** (not `db push`). Always test on a Neon branch first.

```bash
# 1. Create a branch in Neon console (or MCP tool)
# 2. Set DATABASE_URL to the branch connection string in .env

# 3. Edit prisma/schema.prisma

# 4. Generate and apply migration on the branch
npx prisma migrate dev --name <description>

# 5. Test thoroughly, then reset DATABASE_URL to main

# 6. Deploy migration to production
npx prisma migrate deploy
```

> **Do not use `prisma db push` on the production Neon branch** — it bypasses migration history.

### Seed Data

```bash
npm run seed        # runs tsx prisma/seed.ts — idempotent (safe to re-run)
```

The seed file (`prisma/seed.ts`) inserts: 3 job titles (L1, L2, L3), 7 criteria, 6 scenarios with full JSONB persona scripts, and all job-criteria links.

---

## Code Conventions

### TypeScript
- **Strict mode** enabled (`strict: true` in tsconfig)
- Prefer `interface` over `type` for object shapes
- Avoid `any`; use `unknown` and narrow
- API response types should be co-located with their consumers or in `src/types/`

### React / Next.js
- **Server Components by default** — only add `'use client'` when you need interactivity, browser APIs, or hooks
- Data fetching in server components uses `fetch()` or Prisma directly (no API round-trip needed)
- Client components fetch data via the API routes
- Keep components small and focused; extract logic to hooks in `src/hooks/`

### File Naming
- Pages: `page.tsx` (Next.js App Router requirement)
- Route handlers: `route.ts`
- Components: `PascalCase.tsx`
- Utilities / lib: `camelCase.ts`
- Types: `src/types/index.ts` (barrel file)

### Styling (Tailwind CSS v4)
- Use Tailwind utility classes directly in JSX — no separate CSS modules
- Group related utilities with consistent ordering: layout → sizing → spacing → colors → typography → interactive states
- Dark theme uses `slate-900` / `blue-950` gradient backgrounds, `slate-800` cards, `blue-400`/`blue-500` accents
- See [tech/TAILWIND.md](tech/TAILWIND.md) for v4-specific patterns

### Error Handling
- API routes: always `try/catch`, return `NextResponse.json({ error: '...' }, { status: 5xx })`
- Client components: maintain `error` state alongside `loading` state
- Never expose stack traces to the client

---

## API Design Conventions

All API routes are under `src/app/api/`. Route handlers use `NextResponse`.

### Standard Response Shapes

```ts
// Success (list)
Response: T[]  // or { data: T[], meta: { total, page } } for paginated

// Success (single)
Response: T

// Error
Response: { error: string }
Status: 400 (bad input) | 401 (unauthorized) | 404 (not found) | 500 (server error)
```

### Route Handler Pattern

```ts
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    // ... query prisma
    return NextResponse.json(data);
  } catch (error) {
    console.error('[route name] GET failed:', error);
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 });
  }
}
```

### Dynamic Routes

```ts
// src/app/api/criteria/[id]/route.ts
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;   // ⚠️ Next.js 15+: params is a Promise — always await it
}
```

### SSE (Server-Sent Events) Pattern

Used by `/api/chat` for streaming AI responses:

```ts
export const runtime = 'edge';   // Required for CF Workers

const readable = new ReadableStream({
  async start(controller) {
    const encoder = new TextEncoder();
    for await (const chunk of streamResponse(messages)) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`));
    }
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
    controller.close();
  }
});

return new Response(readable, {
  headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }
});
```

Client consumption (`/simulate/[sessionId]/page.tsx`):
```ts
const reader = res.body!.getReader();
const decoder = new TextDecoder();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  const lines = decoder.decode(value).split('\n\n').filter(Boolean);
  for (const line of lines) {
    const payload = JSON.parse(line.replace(/^data: /, ''));
    if (payload.type === 'chunk') setStreamingText(prev => prev + payload.content);
    if (payload.type === 'session_ended') handleSessionEnd(payload);
  }
}

---

## Branching & Git Workflow

```
main          — production-ready, deploys to Cloudflare Pages
develop       — integration branch, staging deploys
feature/*     — feature branches (e.g., feature/chat-simulation)
fix/*         — bug fixes
docs/*        — documentation updates
```

### Commit Message Format
```
type(scope): short description

feat(chat): add streaming AI response to simulation
fix(admin): prevent empty criteria name on save
docs(engineering): add branching guide
refactor(api): consolidate error handling in route handlers
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`

---

## Deployment

### Cloudflare Pages (using `@opennextjs/cloudflare`)

```bash
# Build for Cloudflare (replaces `next build` for deployment)
npm run pages:build           # runs: npx @opennextjs/cloudflare build

# Local preview (emulates CF Workers)
npm run preview               # pages:build + bundle:worker + wrangler pages dev

# Deploy to production
npm run deploy                # pages:build + bundle:worker + wrangler pages deploy
```

> **Note**: Ensure `npx next build` completes and produces `.next/required-server-files.json` before running `npx @opennextjs/cloudflare build`. If the Next.js build exits early, the OpenNext worker will have no routes and deploy as a 404.

### Environment Variables in Cloudflare
Set via Cloudflare dashboard → Pages → project → Settings → Environment variables (Production & Preview), or:
```bash
wrangler pages secret put DATABASE_URL --project-name xpelevator
wrangler pages secret put GROQ_API_KEY --project-name xpelevator
wrangler pages secret put AUTH_SECRET --project-name xpelevator
```

### Build Settings (Cloudflare Dashboard)
| Setting | Value |
|---------|-------|
| Framework preset | None (custom) |
| Build command | `npm run pages:build` |
| Build output directory | `.open-next/assets` |
| Node.js version | 20.x |
| `nodejs_compat` flag | ✅ Required (set in wrangler.toml) |

### CI/CD (GitHub Actions)
Workflow: `.github/workflows/ci.yml`
- **lint** job: `npm run lint`
- **typecheck** job: `npx tsc --noEmit`
- **build** job: `npm run build` (uses dummy env vars)
- Triggers on push/PR to `main`

---

## Debugging Guide

### Dev Server Won't Start
```bash
# Kill any process on port 3000
npx kill-port 3000
# Re-start
npm run dev
```

### Prisma Errors

**`Can't reach database server`**
- Check `DATABASE_URL` in `.env` — strip trailing whitespace/CRLF (Windows)
- Neon free tier suspends after inactivity — first connection takes 3-5s (cold start); retry

**`Unknown field in Prisma query`**
```bash
npx prisma generate   # regenerate client after any schema change
```

**`P2002 Unique constraint violation`**
- `JobTitle.name` has a global `@unique` — two orgs cannot share the same job title name until BL-056 is resolved
- `Criteria` does not have a unique name constraint — duplicates allowed

**Prisma client not found after schema change**
```bash
npx prisma generate
```

### NextAuth / Authentication Errors

**`server configuration` error at `/api/auth/session`**
- `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` are set to empty strings or partially set — either set both or set neither. The auth config guards against this but check `.env` values.

**Session not persisting**
- Verify `AUTH_SECRET` is set. Without it NextAuth cannot sign JWTs.
- In dev: cookie is `authjs.session-token`; in prod (https): `__Secure-authjs.session-token`

### Groq API Errors

**`401 Unauthorized`**
- `GROQ_API_KEY` is missing or has CRLF line endings (common on Windows). The client does `.replace(/\r/g, '')` but double-check.

**Phone call opens but AI never speaks**
- The Telnyx webhook uses the deprecated model `llama3-70b-8192` (BL-050). Groq may return a 404 or fail silently.

### Cloudflare Build Failures (BL-045)

If `npm run pages:build` (OpenNext CF) fails:
1. Check for `groq-sdk` CJS interop errors in the bundler output — the lazy `import()` in `src/lib/ai.ts` should resolve this but verify the bundle error message
2. Check for `next-auth` v5 beta issues — React 19 + next-auth v5 beta have known build incompatibilities
3. Try `npm run build` (plain Next.js) first to isolate whether the issue is Next.js or the CF adapter

### TypeScript Errors in VS Code
- Ghost errors from deleted files → reload VS Code: `Ctrl+Shift+P` → "Developer: Reload Window"

### Windows / WSL npm Issues
- **Never** run `npm install` from WSL on a Windows NTFS drive
- Use Windows cmd.exe or PowerShell for all npm/node commands
- Corrupt `node_modules`: delete with PowerShell (`Remove-Item -Recurse -Force node_modules`), reinstall from cmd.exe

---

## Common Tasks

### Add a New API Route

1. Create `src/app/api/<resource>/route.ts`
2. Export `GET`, `POST` etc handlers
3. **If handler writes to the DB**: every `INSERT INTO ... VALUES (...)` must include `gen_random_uuid()` as the `id` value — there is no DB default for any `id` column
4. Add corresponding types if needed in `src/types/`
5. Update `docs/ARCHITECTURE.md` if it changes the system design

### Add a New Page

1. Create `src/app/<path>/page.tsx`
2. If it needs data from DB on server → use Prisma directly (server component)
3. If it needs interactivity → `'use client'` + fetch from API route
4. Add a navigation link from the home page or layout

### Modify the Database Schema

1. Edit `prisma/schema.prisma`
2. `npx prisma generate` to update the client
3. `npx prisma db push` (against a Neon dev branch first)
4. Update seed data if necessary

### Add a New AI Prompt

1. Edit `src/lib/ai.ts`
2. Add a new exported function with a well-typed signature
3. Keep system prompts as constants at the top of the file
4. Document the prompt purpose and expected output format
5. **Ensure every entry point that needs the prompt imports from `src/lib/ai.ts`** — never duplicate prompt logic locally in route handlers (see BL-082 in LESSONS_LEARNED.md)

### Run a Manual DB Query (via Neon MCP)
Use the Neon MCP tool (`mcp_neon_run_sql`) with project ID `aged-butterfly-52244878`.
