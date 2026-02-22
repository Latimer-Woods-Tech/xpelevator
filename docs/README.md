# XPElevator — Documentation Index

> Last updated: February 21, 2026

## Quick Links

| Document | Purpose |
|----------|---------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System design: C4 diagrams, Mermaid flow diagrams, DB schema, scenario catalog, scoring rubric, API reference |
| [ENGINEERING.md](ENGINEERING.md) | Developer guide: setup, project structure, conventions, deployment, debugging runbooks |
| [BACKLOG.md](BACKLOG.md) | Product & engineering backlog — all open issues, sprint assignments, completed history |
| [ROADMAP.md](ROADMAP.md) | Phase plan, gap analysis, architecture decision log |
| [tech/](tech/) | Per-technology reference docs (Groq, Telnyx, Prisma, Cloudflare, Next.js, Tailwind) |

---

## Current Status Summary (Sprint 5 complete — Feb 21 2026)

### ✅ Fully Functional
- Chat simulation (SSE streaming, AI virtual customer, auto-scoring)
- Phone simulation (Telnyx outbound call + webhook flow)
- Admin panel (4 tabs: Criteria, Jobs, Scenarios, Job↔Criteria)
- Session history + per-criteria score breakdown
- Analytics dashboard (score trends, heatmap, breakdowns)
- NextAuth v5 authentication (GitHub OAuth + Credentials)
- Cloudflare deployment config + GitHub Actions CI/CD
- Neon Postgres (10 tables, migration baseline, idempotent seed)

### ❌ Blocked / Broken
- **CF build** (`@opennextjs/cloudflare` exits code 1) — BL-045

### ⚠️ Security Gaps (fix before production)
- API routes are not auth-gated — only `/admin` is protected (BL-046)
- Any non-empty Credentials username gets admin access (BL-047)
- Telnyx webhook has no signature verification (BL-051)

### ⚠️ Data Integrity Gaps (fix before multi-tenant launch)
- `orgId` not filtered in any API query (BL-049)
- Dual identity model: `userId` string vs `dbUserId` FK (BL-048)
- No DB indexes on FK columns (BL-052)

---

## Architecture at a Glance

```
Browser (Next.js 15 / React 19)
  ├── /simulate/[sessionId]  ──── POST /api/chat ──────────► Groq (SSE stream)
  │                               GET /api/chat              Neon (messages)
  │
  ├── /simulate/[sessionId]  ──── POST /api/telnyx/call ───► Telnyx (outbound)
  │                                   ◄── webhook POST ──── Telnyx → /api/telnyx/webhook
  │
  ├── /admin                 ──── /api/jobs, /api/scenarios, /api/criteria
  ├── /analytics             ──── /api/analytics
  └── /sessions/[id]         ──── /api/chat (session loader)

All API routes: Cloudflare Workers (edge runtime)
Database: Neon Postgres via HTTP adapter (aged-butterfly-52244878)
Auth: NextAuth v5 JWT — /admin protected; all other routes open (BL-046)
```

---

## Key Files

| File | What it does |
|------|-------------|
| `src/lib/ai.ts` | Groq lazy client; `buildSessionSystemPrompt()`; `streamNextCustomerMessage()`; `scoreSession()` |
| `src/lib/prisma.ts` | Prisma client with Neon HTTP adapter (CF Workers compatible) |
| `src/lib/telnyx.ts` | Telnyx helpers: `callSpeak`, `callGather`, `callHangup`, `encode/decodeClientState` |
| `src/lib/env.ts` | Env var validation (warns in dev, throws in prod) |
| `src/auth.ts` | NextAuth v5 config (GitHub + Credentials, JWT) |
| `src/middleware.ts` | Edge middleware — protects `/admin` routes |
| `src/types/index.ts` | Shared TS types + SSE event payload shapes |
| `prisma/schema.prisma` | Full DB schema (10 models, 4 enums) |
| `prisma/seed.ts` | Idempotent seed data (`npm run seed`) |
| `wrangler.toml` | Cloudflare Pages deployment config |
| `open-next.config.ts` | `@opennextjs/cloudflare` adapter config |

---

## Neon Database

- **Project**: `aged-butterfly-52244878`
- **Database**: `neondb` / `us-east-1`
- **Tables**: organizations, users, job_titles, scenarios, criteria, job_criteria, simulation_sessions, chat_messages, scores, _prisma_migrations

Run seed: `npm run seed`  
Apply migrations: `npx prisma migrate deploy`  
Inspect DB: use Neon MCP tool with project ID `aged-butterfly-52244878`

---

## Tech Reference Docs

| Doc | Topic |
|-----|-------|
| [tech/GROQ.md](tech/GROQ.md) | Groq API, models, streaming, rate limits |
| [tech/TELNYX.md](tech/TELNYX.md) | Telnyx Call Control, TTS/STT, webhook events |
| [tech/PRISMA.md](tech/PRISMA.md) | Prisma ORM patterns, migrations, Neon adapter |
| [tech/CLOUDFLARE.md](tech/CLOUDFLARE.md) | CF Workers, Pages, OpenNext, edge runtime |
| [tech/NEXTJS.md](tech/NEXTJS.md) | App Router, server components, route handlers |
| [tech/TAILWIND.md](tech/TAILWIND.md) | Tailwind v4, dark theme conventions |
