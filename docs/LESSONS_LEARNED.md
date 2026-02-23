# XPElevator — Lessons Learned

> Last updated: 2026-02-23
> Maintained by: Engineering team
> Purpose: Prevent recurring issues — consult before starting new features or debugging.

---

## How to Use This Document

Before starting a new feature, scan the relevant category tables for patterns that apply to your work. When debugging an issue, check the Root Cause column for a quick match. Prevention Rules are the actionable takeaways — treat them as non-negotiable checklist items.

---

## Categories

1. [Prisma & Database](#1-prisma--database)
2. [AI & External APIs](#2-ai--external-apis)
3. [Authentication & Identity](#3-authentication--identity)
4. [Browser APIs & Frontend](#4-browser-apis--frontend)
5. [Build & Deployment](#5-build--deployment)
6. [Architecture & Design Patterns](#6-architecture--design-patterns)

---

## 1. Prisma & Database

| Issue | Root Cause | Fix Pattern | Prevention Rule |
|---|---|---|---|
| **Prisma Client fails in Cloudflare Workers runtime** (BL-072) | PrismaNeonHTTP adapter has runtime incompatibility with Cloudflare Workers edge environment; all `prisma.*` calls fail with 500 errors in production but work fine locally in Node.js | Replace all Prisma Client calls with raw SQL using `@neondatabase/serverless`; change imports from `@/lib/prisma` to `@/lib/db` and use template literal SQL queries | Never use Prisma Client in Cloudflare Workers/Pages deployments; use raw SQL via Neon's HTTP client; test on actual Cloudflare runtime, not just local Node |
| **Auth helper breaks all API routes** (BL-073) | `requireAuth()` in `src/lib/auth-api.ts` used `prisma.user.findUnique()`; when called at start of every authenticated route, this caused ALL API endpoints to fail with 500 errors | Convert auth helper to use raw SQL: `SELECT id, role, org_id FROM users WHERE email = $1` | Auth helpers are called by EVERY route — they must use edge-compatible code; validate auth paths work in production before testing business logic |
| **WASM client import** (BL-058) | `prisma.ts` imported `@prisma/client/wasm`; Node.js rejects `.wasm` extension, all DB writes silently no-op | Import from `@prisma/client`; reserve WASM import for Cloudflare Workers build only | After initial setup, execute an explicit DB write and verify it persists before moving on |
| **Implicit transaction with Neon HTTP adapter** (BL-059) | `create({ include: {...} })` triggers an implicit multi-statement transaction; Neon HTTP transport does not support transactions, throws opaque error | Split into `create()` then `findUnique()` as two separate calls | With Neon HTTP adapter, never use `create+include` or any implicit transaction pattern; use only single-statement operations |
| **Schema enum not regenerated** (BL-067) | Added `VOICE` to `SimulationType` enum but skipped `npx prisma generate`; generated client still had stale type definitions | Run `npx prisma generate` then restart dev server | Make `prisma generate` + dev server restart a mandatory post-schema-change step; do not test until both are done |
| **Missing FK indexes** (BL-052) | PostgreSQL does not auto-index foreign key columns; `session_id`, `user_id` etc. caused sequential scans on every transcript query | Add explicit `@@index` declarations in Prisma schema for all FK columns | Add FK indexes as a standard checklist item whenever a relation is created |
| **Global unique instead of scoped unique** (BL-056) | `job_titles.name` had `@unique` globally; in multi-tenant context, organisations legitimately share names | Change to `@@unique([orgId, name])` | In multi-tenant schemas, always scope unique constraints to `(orgId, fieldName)` |
| **Missing cascade deletes** (BL-057) | No `onDelete: Cascade` on Session→Messages, Session→Scores, JobTitle→Scenarios; SQL deletes leave orphaned rows | Add `onDelete: Cascade` to all parent→child relations in schema | Define cascade behaviour at schema creation time, not retroactively |
| **Column name mismatches in raw SQL** (BL-074) | Used `sc.created_at` when scores table has `scored_at`; used `s.simulation_type` when column is `type`; used `jt.updated_at` when job_titles has no such column | Always reference Prisma schema when writing SQL; use actual database column names (snake_case) not Prisma field names (camelCase) | Before writing any SQL query, check `prisma/schema.prisma` for exact column names; never assume column names match field names |

---

## 2. AI & External APIs

| Issue | Root Cause | Fix Pattern | Prevention Rule |
|---|---|---|---|
| **Deprecated Groq model name** (BL-050) | `llama3-70b-8192` was removed by Groq; calls silently errored | Update to `llama-3.3-70b-versatile` | Store model name in an env var; monitor Groq deprecation notices; never hard-code model strings |
| **Inverted CUSTOMER/AGENT roles** (BL-060) | Telnyx webhook saved AI messages as `AGENT` and trainee speech as `CUSTOMER`; scoring and replay used wrong roles | Swap role assignments to match logical ownership | Write a unit test asserting role assignment for both message directions immediately after implementing any message-storage pathway |
| **Wrong script field names** (BL-061) | Webhook accessed `script.persona` / `script.objective` (undefined) instead of `script.customerPersona` / `script.customerObjective`; AI had no persona context | Correct field names to match `ScenarioScript` type | Use typed property access (`script.customerPersona` via the TypeScript type) — never access scenario fields via untyped string keys |
| **Wrong Groq history role mapping** (BL-062) | History mapped with `m.role === 'USER'` but DB stores `'AGENT'`/`'CUSTOMER'`; all history resolved to `assistant`, stripping user context | Map using correct DB role constants | Use `MessageRole` enum constants when mapping roles; add a role-mapping unit test |
| **Unbounded session turns** (BL-053) | `ScenarioScript.maxTurns` defined in type but never checked; sessions run indefinitely, consuming unbounded Groq calls and DB rows | Count agent turns before each Groq call; end session when `maxTurns` is reached | Always implement resource limits (turn cap, token budget, timeout) alongside the resource that consumes them |

---

## 3. Authentication & Identity

| Issue | Root Cause | Fix Pattern | Prevention Rule |
|---|---|---|---|
| **Credentials provider accepts any username** (BL-047) | `authorize()` returns a user object for any non-empty string; anyone knowing the sign-in URL can claim any identity including `admin` | Add proper user lookup and role verification in `authorize()` | Never ship a credentials provider that accepts arbitrary input; use OAuth or verified credentials |
| **`dbUserId` always null** (BL-048) | Dual identity model: NextAuth `userId` (string) and `dbUserId` (FK to `User` table) coexist; `User` table is never populated on sign-in, making the FK permanently null | Upsert `User` on sign-in in the NextAuth `signIn` callback; set `dbUserId` FK on session creation | Decide and document the canonical user identity FK before building any session or history features |
| **Unguarded API routes** (BL-046) | All `/api/*` routes serve unauthenticated requests; any caller can read transcripts or create sessions | Add auth middleware to all API routes | Auth guard is the first line of every new route handler — add it before any business logic |

---

## 4. Browser APIs & Frontend

| Issue | Root Cause | Fix Pattern | Prevention Rule |
|---|---|---|---|
| **Stale closure in SpeechRecognition callbacks** | `finalTranscript` state captured at callback-creation time; `onend` always saw the initial empty string | Maintain a `finalTranscriptRef` updated in `useEffect`; read the ref inside event callbacks | Never read React state inside async browser event callbacks; always bridge via a ref |
| **Wrong CSS keyframe for waveform animation** | Tailwind `bounce` uses `translateY` (vertical jump); audio bars need `scaleY` from bottom anchor | Custom `@keyframes bar-wave` using `scaleY` + `transform-origin: bottom` | Verify the exact CSS property required before reaching for a utility class; animate scale/origin separately |

---

## 5. Build & Deployment

| Issue | Root Cause | Fix Pattern | Prevention Rule |
|---|---|---|---|
| **OpenNext Cloudflare build failure** (BL-045) | `groq-sdk` CJS/ESM interop or `next-auth` v5 + React 19 incompatibility in Cloudflare bundler; build exits with code 1 | Investigate ESM interop shims; track upstream fixes in `@opennextjs/cloudflare` | Run a Cloudflare build in CI on every dependency update, not just before release |
| **Missing `required-server-files.json` → empty Pages deploy** (BL-070) | Next build exited early / hung on type-check; `.next/required-server-files.json` absent, so OpenNext produced a worker with no routes, yielding 404/empty body in production | Ensure `npx next build` completes and `.next/required-server-files.json` exists before running `npx @opennextjs/cloudflare build`; rerun Next build if file is missing | Gate every Pages deploy on a successful Next build that outputs `required-server-files.json`; add a CI check to fail if the file is absent |
| **Pages assets 404 after deploy** (BL-071) | Deployed `.open-next` root instead of `.open-next/assets`; worker ran but `_next/static/...` assets were missing from Pages bucket, causing 404 for CSS/JS/fonts | Deploy with `pages_build_output_dir = ".open-next/assets"` so static assets and `_worker.js` are shipped together | Always point `pages_build_output_dir` to the OpenNext `assets` folder when using Pages advanced mode |
| **`outputFileTracingRoot` lockfile warning** (BL-065) | Next.js detected multiple `package-lock.json` files and emitted noisy warnings on every start | Add `outputFileTracingRoot: path.join(__dirname)` in `next.config.ts` | Set `outputFileTracingRoot` whenever the project root differs from the Next.js app root |

---

## 6. Architecture & Design Patterns

| Issue | Root Cause | Fix Pattern | Prevention Rule |
|---|---|---|---|
| **633-line monolith page** (BL-068/069) | `simulate/[sessionId]/page.tsx` grew to 633 lines with three UI modes inline; became untestable | Extract `useChatSession` hook; split chat, phone, and voice into dedicated components; extract `MessageBubble` | Extract a custom hook at the first sign of complex async state; each distinct UI mode must be its own component |
| **Missing multi-tenancy scope on all queries** (BL-049) | `orgId` columns exist in schema but no API route filters by them; all data is cross-tenant visible | Add `where: { orgId }` to every query; derive `orgId` from the authenticated session | If a multi-tenant schema is in place, every query must scope to `orgId` — enforce via code review checklist or lint rule |

---

## Recurring Patterns — Quick Reference

| Common Mistake | Rule |
|---|---|
| **Using Prisma Client in Cloudflare Workers** | **NEVER use `prisma.*` in edge runtime — use raw SQL via `@neondatabase/serverless`** |
| **Schema column names vs Prisma field names in SQL** | **Always check `schema.prisma` for actual column names (snake_case) before writing SQL** |
| **Auth helpers with Prisma calls** | **Auth helpers run on EVERY route — must use edge-compatible raw SQL only** |
| Importing Prisma WASM client in Node.js dev | Import `@prisma/client`; WASM only for Workers build |
| Skipping `prisma generate` after schema change | Always run generate + restart before testing |
| Using `create+include` with Neon HTTP adapter | One Prisma operation per HTTP call; no implicit transactions |
| Hard-coding Groq model names | Store in env var; monitor deprecation notices |
| Reading React state inside browser event callbacks | Bridge via ref updated in `useEffect` |
| Global unique constraints in multi-tenant schema | Scope all unique constraints to `(orgId, field)` |
| No FK indexes on new relations | Declare `@@index` for every FK column at creation time |
| No cascade deletes on parent–child relations | Define `onDelete: Cascade` at schema creation time |
| API routes without auth guard | Auth guard is the first thing in every route handler |
| Accessing typed objects via unverified string keys | Use TypeScript typed access; let the compiler catch typos |
| No resource limits on external API calls | Implement turn cap, timeout, or token budget alongside the call |
| Monolith page components mixing multiple UI modes | One UI mode = one component; complex state = one custom hook |
| Missing `orgId` filter on queries | Every query in a multi-tenant system must include `where: { orgId }` |

---

## Checklist: Before Merging a New Feature

- [ ] **All API routes and server components use raw SQL (`@neondatabase/serverless`), NOT Prisma Client**
- [ ] All SQL queries use actual database column names from `schema.prisma` (snake_case), not Prisma field names
- [ ] All Prisma relations have `@@index` on FK columns and `onDelete` behaviour defined
- [ ] `npx prisma generate` has been run and dev server restarted after any schema change
- [ ] No `create({ include })` patterns used with the Neon HTTP adapter
- [ ] Every new API route has an auth guard as its first statement
- [ ] All queries that touch multi-tenant data include a `where: { orgId }` clause
- [ ] External API model names / config values are stored in env vars, not hard-coded
- [ ] Any message-role mapping has a unit test covering both directions
- [ ] React state is never read inside async browser event callbacks — refs are used instead
- [ ] Resource limits (turn cap, timeout) are implemented for every call to an external AI API
- [ ] Unique constraints that must be scoped per organisation use `@@unique([orgId, field])`
- [ ] New page components exceeding ~150 lines or containing async state have been refactored into hooks and sub-components
- [ ] Cloudflare build (`npx @opennextjs/cloudflare build`) has been verified after any dependency change
- [ ] DB writes introduced during setup have been verified with an explicit read-back query

---

## Prisma Client Migration Status

**Context:** Prisma Client is incompatible with Cloudflare Workers runtime. All production code must use raw SQL via `@neondatabase/serverless`.

### ✅ MIGRATION COMPLETE (2026-02-23)

**All production routes and server components successfully migrated to raw SQL.**

**API Routes (Production):**
- `src/app/api/jobs/route.ts` - Job title listing (GET, POST)
- `src/app/api/jobs/[id]/route.ts` - Job title details/edit (PUT, DELETE) [commit 1fe3293]
- `src/app/api/jobs/[id]/criteria/route.ts` - Job-criteria associations [commit 1fe3293]
- `src/app/api/scenarios/route.ts` - Scenario listing (GET, POST)
- `src/app/api/scenarios/[id]/route.ts` - Scenario details/edit (GET, PUT, DELETE) [commit 45a4120]
- `src/app/api/simulations/route.ts` - Session creation and listing
- `src/app/api/chat/route.ts` - Chat interactions (GET, POST) [commits 7e0a58f, 693be89]
- `src/app/api/analytics/route.ts` - Session analytics/reporting [commit 35355d3]
- `src/app/api/scoring/route.ts` - Manual score adjustments [commit 15e4d0b]
- `src/app/api/criteria/[id]/route.ts` - Criteria CRUD (PUT, DELETE) [commit 8afc27f]
- `src/app/api/orgs/route.ts` - Organization management (GET, POST) [commit aacb77d]
- `src/app/api/orgs/[id]/route.ts` - Organization details (GET, PUT, DELETE) [commit aacb77d]
- `src/app/api/orgs/[id]/members/route.ts` - Member management (GET, POST, DELETE) [commit aacb77d]
- `src/app/api/telnyx/call/route.ts` - Voice call initiation [commit 9a18595]
- `src/app/api/telnyx/webhook/route.ts` - Voice call webhooks [commit 9a18595]

**Server Components:**
- `src/app/sessions/[id]/page.tsx` - Session detail page (SSR) [commit d35dc98]

**Auth System (CRITICAL):**
- `src/auth.ts` - NextAuth callbacks (signIn, session, jwt) [commit 135c754]

**Core Libraries:**
- `src/lib/auth-api.ts` - Authentication helper (requireAuth function) [commit 9d79ae8]
- `src/lib/db.ts` - Raw SQL client wrapper

**Migration Timeline:**
- **Feb 22**: Initial crisis - discovered Prisma Client failures in Cloudflare Workers
- **Feb 22-23**: Emergency auth system migration (commits 9d79ae8, 135c754)
- **Feb 23**: Systematic migration of all 13 production files (9 commits total)
- **Feb 23**: Migration completed - all production routes now edge-compatible

**Total Files Migrated:** 16 production files
**Total Commits:** 10 deployment commits
**Lines Changed:** ~500 insertions (raw SQL), ~300 deletions (Prisma calls)

**Impact:** Application is now fully compatible with Cloudflare Workers runtime. All routes tested and deployed to production.

### 📚 TEST/DEV FILES (Lower Priority)

**Testing Infrastructure:**
- `tests/integration/helpers/db.ts` - Test database helpers
- `tests/integration/api/*.test.ts` - Integration tests (8 files)
- `validate.mjs` - Local validation script

**Database Seeding:**
- `prisma/seed.ts` - Initial data population

**Impact:** These can continue using Prisma Client for local development/testing. Only production runtime code needs migration.

### 🔄 Migration Pattern

**Before (Prisma Client - fails in Cloudflare Workers):**
```typescript
import prisma from '@/lib/prisma';

const jobs = await prisma.jobTitle.findMany({
  where: { orgId },
  include: { scenarios: true }
});
```

**After (Raw SQL - works in Cloudflare Workers):**
```typescript
import { sql } from '@/lib/db';

const jobs = await sql`
  SELECT 
    jt.*,
    COALESCE(
      json_agg(
        json_build_object('id', s.id, 'name', s.name)
      ) FILTER (WHERE s.id IS NOT NULL),
      '[]'
    ) as scenarios
  FROM job_titles jt
  LEFT JOIN scenarios s ON s.job_title_id = jt.id
  WHERE jt.org_id = ${orgId}
  GROUP BY jt.id
`;
```

**Key Conversions:**
- `findUnique` → `SELECT ... WHERE ... LIMIT 1`
- `findMany` → `SELECT ... WHERE ...`
- `create` → `INSERT INTO ... VALUES (...) RETURNING *`
- `update` → `UPDATE ... SET ... WHERE ... RETURNING *`
- `delete` → `DELETE FROM ... WHERE ... RETURNING *`
- `include` → `LEFT JOIN` + `json_build_object()` + `json_agg()`
- Relations (one-to-many) → `COALESCE(json_agg(...), '[]')`
- Relations (one-to-one) → `json_build_object(...)`

**Common Pitfalls:**
- ❌ Using Prisma field names (`jobTitleId`) → ✅ Use DB column names (`job_title_id`)
- ❌ Using `created_at` on scores table → ✅ Use `scored_at`
- ❌ Using `simulation_type` column → ✅ Use `type`
- ❌ Assuming `updated_at` exists on all tables → ✅ Only `criteria` table has it

---

### Migration Priority Order

1. **CRITICAL (blocking core features):**
   - `src/auth.ts` - Blocks all authenticated routes if it fails
   - `src/app/api/analytics/route.ts` - Used by main dashboard

2. **HIGH (user-facing features):**
   - `src/app/api/scoring/route.ts` - Manual scoring
   - `src/app/sessions/[id]/page.tsx` - Session review page
   - `src/app/api/scenarios/[id]/route.ts` - Scenario editing

3. **MEDIUM (admin features):**
   - `src/app/api/jobs/[id]/route.ts` - Job title management
   - `src/app/api/jobs/[id]/criteria/route.ts` - Criteria assignment
   - `src/app/api/criteria/[id]/route.ts` - Criteria editing
   - `src/app/api/orgs/*` - Organization management (3 files)

4. **LOW (future features):**
   - `src/app/api/telnyx/*` - Voice calling (2 files)



