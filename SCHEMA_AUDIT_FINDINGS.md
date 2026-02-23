# Schema Mismatch Audit - February 23, 2026

## Summary
Schema mismatch errors occur when SQL queries reference columns that don't exist in the database, or use incorrect column names.

## Error Classification

### Type: Runtime Database Schema Mismatch
- **Severity:** HIGH (causes 500 errors in production)
- **Detection:** Only at runtime when query executes
- **Root Cause:** Code written assuming schema that doesn't match actual database

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

### ⚠️ NEEDS FIX: `/api/scenarios` Route
**File:** `src/app/api/scenarios/route.ts`

**Issues Found (5 occurrences):**

1. **Line 27, 45, 63, 81, 145:** Uses `s.updated_at`
   - ❌ scenarios table has NO updated_at column
   - ✅ Fix: Remove `updated_at` from queries

2. **Line 25, 43, 61, 79, 124, 141:** Uses `s.simulation_type`
   - ❌ Column is named `type` not `simulation_type`
   - ✅ Fix: Change to `s.type`

**Estimated Impact:** HIGH - /api/scenarios endpoint will 500 error when accessed

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

---

## Prevention Strategies

###  1. **Type-Safe Query Builder** (Recommended)
Use Prisma Client instead of raw SQL:
```typescript
// Instead of raw SQL:
await sql`SELECT * FROM scenarios WHERE simulation_type = 'CHAT'`

// Use Prisma (type-safe):
await prisma.scenario.findMany({ where: { type: 'CHAT' } })
```

### 2. **Database Schema Tests**
Create tests that verify expected columns exist:
```typescript
test('scenarios table has correct columns', async () => {
  const cols = await getTableColumns('scenarios');
  expect(cols).toContain('type');
  expect(cols).not.toContain('simulation_type');
});
```

### 3. **Pre-deployment Validation**
Run schema validation before each deployment:
```bash
npm run validate-schema
```

### 4. **Code Review Checklist**
- [ ] All SQL column names match Prisma schema
- [ ] No references to deleted/renamed columns
- [ ] Table names use correct pluralization
- [ ] Enum values match schema definition

### 5. **Integration Tests**
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

## Next Actions

1. **URGENT:** Fix `/api/scenarios` route (updated_at + simulation_type)
2. **HIGH:** Run full API test suite to find other broken endpoints
3. **MEDIUM:** Add schema validation to CI/CD pipeline
4. **LOW:** Migrate from raw SQL to Prisma Client where possible

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
