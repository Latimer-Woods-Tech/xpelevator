# XPElevator — Lessons Learned

> Last updated: 2026-02-22
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
| **WASM client import** (BL-058) | `prisma.ts` imported `@prisma/client/wasm`; Node.js rejects `.wasm` extension, all DB writes silently no-op | Import from `@prisma/client`; reserve WASM import for Cloudflare Workers build only | After initial setup, execute an explicit DB write and verify it persists before moving on |
| **Implicit transaction with Neon HTTP adapter** (BL-059) | `create({ include: {...} })` triggers an implicit multi-statement transaction; Neon HTTP transport does not support transactions, throws opaque error | Split into `create()` then `findUnique()` as two separate calls | With Neon HTTP adapter, never use `create+include` or any implicit transaction pattern; use only single-statement operations |
| **Schema enum not regenerated** (BL-067) | Added `VOICE` to `SimulationType` enum but skipped `npx prisma generate`; generated client still had stale type definitions | Run `npx prisma generate` then restart dev server | Make `prisma generate` + dev server restart a mandatory post-schema-change step; do not test until both are done |
| **Missing FK indexes** (BL-052) | PostgreSQL does not auto-index foreign key columns; `session_id`, `user_id` etc. caused sequential scans on every transcript query | Add explicit `@@index` declarations in Prisma schema for all FK columns | Add FK indexes as a standard checklist item whenever a relation is created |
| **Global unique instead of scoped unique** (BL-056) | `job_titles.name` had `@unique` globally; in multi-tenant context, organisations legitimately share names | Change to `@@unique([orgId, name])` | In multi-tenant schemas, always scope unique constraints to `(orgId, fieldName)` |
| **Missing cascade deletes** (BL-057) | No `onDelete: Cascade` on Session→Messages, Session→Scores, JobTitle→Scenarios; SQL deletes leave orphaned rows | Add `onDelete: Cascade` to all parent→child relations in schema | Define cascade behaviour at schema creation time, not retroactively |

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
