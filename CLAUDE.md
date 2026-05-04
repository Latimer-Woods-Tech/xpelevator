# xpelevator — Standing Orders

> Canonical reference for all agents, engineers, and AI tools working in this repository.
> This app is currently in early scaffold stage — mission and routes will expand.

## Mission

xpelevator is an experience-elevation platform built on Factory Core. It is designed
to help users level up specific areas of their life or work through structured
experience (XP) frameworks, tracking, and guided progression. Currently in scaffold
stage with foundational auth and profile endpoints.

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Cloudflare Workers only |
| Router | Hono |
| Database | Neon Postgres via Hyperdrive binding (`env.DB`) |
| Auth | JWT self-managed via `@latimer-woods-tech/auth` |
| Errors | Sentry via `@latimer-woods-tech/monitoring` |
| Analytics | PostHog + `factory_events` via `@latimer-woods-tech/analytics` |
| Build | tsup (ESM only) |
| Tests | Vitest + `@cloudflare/vitest-pool-workers` |

## Routes (Current Scaffold)

- `/health` — health check
- `/api/me` — authenticated user profile

## Hard Constraints

- No `process.env` — use `c.env.VAR` (Hono) or `env.VAR` (Worker) only
- No Node.js built-ins (`fs`, `path`, `crypto`) — use Web APIs
- No CommonJS `require()` — ESM `import`/`export` only
- No `Buffer` — use `Uint8Array`, `TextEncoder`, `TextDecoder`
- No raw `fetch` without error handling
- No secrets in source code or `wrangler.jsonc` `vars` — use `wrangler secret put`
- TypeScript strict — zero `any` in public APIs

## Surfaces

| Surface | URL |
|---------|-----|
| Worker | https://xpelevator.adrper79.workers.dev |
| Health | `curl https://xpelevator.adrper79.workers.dev/health` |

A fix is done when `curl https://xpelevator.adrper79.workers.dev/health` returns `200`.

## Commands

```bash
npm run typecheck       # Zero errors required
npm test                # Vitest suite
npm run build           # tsup ESM build
npm run deploy          # wrangler deploy
```

## Session Start Checklist

1. Read `src/index.ts` — middleware wiring and route mounts
2. Run `npm run typecheck` — note existing errors
3. Run `npm test` — note coverage baseline
4. Check `git log --oneline -10`
5. Confirm Hyperdrive binding ID in `wrangler.jsonc`

## Commit Format

`type(xpelevator): description`

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`
