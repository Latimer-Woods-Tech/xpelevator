# Schema Mismatch Audit - February 23, 2026

## Summary
Schema mismatch errors and Prisma Client incompatibility issues on Cloudflare Workers runtime.

## Error Classifications

### Type 1: Runtime Database Schema Mismatch
- **Severity:** HIGH (causes 500 errors in production)
- **Detection:** Only at runtime when query executes
- **Root Cause:** Code written assuming schema that doesn't match actual database

### Type 2: Prisma Client Runtime Incompatibility
- **Severity:** HIGH (causes 500 errors in production)
- **Detection:** Only at runtime when Prisma Client methods are called
- **Root Cause:** PrismaNeonHTTP adapter has compatibility issues with Cloudflare Workers

## Errors Found & Fixed

### ✅ FIXED: `/api/jobs` Route
**File:** `src/app/api/jobs/route.ts`

1. **Column doesn't exist:**
   - ❌ `jt.updated_at` → job_titles table has NO updated_at column
   - ✅ Fixed: Removed from GET and POST queries

2. **Wrong column names:**
   - ❌ `s.title` → ✅ `s.name`
   - ❌ `s.persona` → ✅ `s.description`
   - ❌ `s.simulation_type` → ✅ `s.type`

**Commits:**
- `dc5ce49` - Fixed wrong column names (title/persona/simulation_type)
- `cd40146` - Removed non-existent updated_at column

---

### ✅ FIXED: `/api/scenarios` Route
**File:** `src/app/api/scenarios/route.ts`

**Issues Fixed (10 occurrences):**

1. **Lines 27, 45, 63, 81, 145:** Used `s.updated_at`
   - ❌ scenarios table has NO updated_at column
   - ✅ Fixed: Removed `updated_at` from all queries

2. **Lines 25, 43, 61, 79, 124, 141:** Used `s.simulation_type`
   - ❌ Column is named `type` not `simulation_type`
   - ✅ Fixed: Changed to `s.type` in all queries

**Commit:** `359eaf7`

---

### ✅ FIXED: `/api/simulations` Route
**File:** `src/app/api/simulations/route.ts`

**Issue:** Prisma Client runtime incompatibility
- ❌ Used `prisma.simulationSession.create()` and `prisma.simulationSession.findMany()`
- ❌ Caused 500 errors on both POST and GET endpoints
- ✅ Fixed: Converted to raw SQL using `@neondatabase/serverless`
- ✅ Matches pattern used in `/api/jobs` and `/api/scenarios`

**Commit:** `6e003e2`

**Additional Fix:** Missing UUID generation
- ❌ `simulation_sessions.id` column lacks DEFAULT value in database
- ✅ Fixed: Added `gen_random_uuid()` in INSERT query

**Commit:** `422f09e`

---

### ✅ FIXED: `/api/chat` GET Handler
**File:** `src/app/api/chat/route.ts`

**Issue:** Prisma Client runtime incompatibility
- ❌ Used `prisma.simulationSession.findUnique()` with complex includes
- ❌ Caused 500 errors on GET /api/chat?sessionId=...
- ✅ Fixed: Converted GET handler to raw SQL with json_build_object for relations

**Commit:** `1dad949`

---

### ⚠️  NEEDS FIX: Multiple Routes Still Use Prisma Client

**High Priority (Core Functionality):**
1. `/api/chat` - POST handler (main chat interaction)
2. `/api/chat` - phoneTranscriptStream helper function
3. `/api/chat` - endSession helper function
4. `/api/scoring` - Manual scoring endpoints
5. `/api/analytics` - Session analytics

**Medium Priority (Additional Features):**
6. `/api/orgs` - Organization management
7. `/api/orgs/[id]` - Organization details
8. `/api/orgs/[id]/members` - Member management
9. `/api/jobs/[id]` - Job title details
10. `/api/jobs/[id]/criteria` - Criteria management
11. `/api/scenarios/[id]` - Scenario details
12. `/api/criteria/[id]` - Criteria details

**Low Priority (Voice Features):**
13. `/api/telnyx/call` - Voice call initiation
14. `/api/telnyx/webhook` - Voice webhooks

**Impact:** Users will encounter 500 errors when using chat, scoring, or analytics features.

---

## Schema Reference

### Actual Database Columns:

**job_titles:**
- id, org_id, name, description, created_at

**scenarios:**
- id, org_id, job_title_id, name, description, type, script, created_at

**criteria:**
- id, org_id, name, description, weight, category, active, created_at, updated_at

---

## Similar Error Patterns to Watch For

1. **Column existence** - Querying columns that were never added
2. **Column naming** - Using camelCase in SQL when DB uses snake_case
3. **Type mismatches** - Treating JSONB as TEXT, etc.
4. **Enum values** - Using enum values not in schema
5. **Foreign key names** - Wrong column names in JOINs
6. **Table name typos** - Pluralization errors (scenario vs scenarios)
7. **Prisma Client usage** - PrismaNeonHTTP adapter has runtime issues on Cloudflare Workers

---

## Prevention Strategies

### 1. **Use Raw SQL with @neondatabase/serverless** (REQUIRED for Cloudflare Workers)
Prisma Client with PrismaNeonHTTP adapter has compatibility issues. Use raw SQL instead:
```typescript
// ✅ CORRECT - Works on Cloudflare Workers:
import { sql } from '@/lib/db';
const jobs = await sql`SELECT id, name FROM job_titles WHERE org_id = ${orgId}`;

// ❌ WRONG - Causes 500 errors on Cloudflare Workers:
import prisma from '@/lib/prisma';
const jobs = await prisma.jobTitle.findMany({ where: { orgId } });
```

### 2. **Always Use Actual Column Names**
Reference the Prisma schema when writing SQL:
```typescript
// ✅ CORRECT - Uses actual DB column names:
await sql`SELECT s.type, s.name FROM scenarios s WHERE s.org_id = ${orgId}`;

// ❌ WRONG - Uses non-existent columns:
await sql`SELECT s.simulation_type, s.title FROM scenarios s`;
```

### 3. **Database Schema Tests**
Create tests that verify expected columns exist:
```typescript
test('scenarios table has correct columns', async () => {
  const cols = await getTableColumns('scenarios');
  expect(cols).toContain('type');
  expect(cols).not.toContain('simulation_type');
});
```

### 4. **Pre-deployment Validation**
Run schema validation before each deployment:
```bash
npm run validate-schema
```

### 5. **Code Review Checklist**
- [ ] All SQL column names match Prisma schema
- [ ] No references to deleted/renamed columns
- [ ] Table names use correct pluralization
- [ ] Enum values match schema definition
- [ ] Using `sql` from `@/lib/db`, NOT `prisma` from `@/lib/prisma`

### 6. **Integration Tests**
Test API endpoints against actual database:
```typescript
test('GET /api/jobs returns valid data', async () => {
  const res = await fetch('/api/jobs');
  expect(res.status).toBe(200); // Should not 500
  const data = await res.json();
  expect(Array.isArray(data)).toBe(true);
});
```

---

## Completed Actions

- ✅ Fixed `/api/jobs` route (columns: title→name, persona→description, simulation_type→type, removed updated_at)
- ✅ Fixed `/api/scenarios` route (changed simulation_type→type, removed updated_at)
- ✅ Fixed `/api/simulations` route (converted from Prisma Client to raw SQL)
- ✅ Created comprehensive audit documentation

## Recommended Next Steps

1. **HIGH:** Audit remaining API routes for Prisma Client usage
2. **MEDIUM:** Add schema validation to CI/CD pipeline
3. **MEDIUM:** Create integration tests for all API endpoints
4. **LOW:** Add grep checks in CI/CD to catch common column name errors

---

## Testing Commands

```bash
# Test all API endpoints
npm run test:api

# Validate schema matches code
npm run validate-schema

# Check for schema mismatches
grep -r "updated_at" src/app/api/
grep -r "simulation_type" src/app/api/
```
