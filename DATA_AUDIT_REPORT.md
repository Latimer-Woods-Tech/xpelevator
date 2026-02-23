# XPElevator Data Audit Report
**Date:** February 23, 2026  
**Auditor:** AI Assessment Agent  
**Scope:** Scenarios, Job Titles, Criteria, and Evaluation Configuration

---

## Executive Summary

⚠️ **CRITICAL ISSUES FOUND** - The application's seed data and database are **out of sync** and have **significant gaps** that will impact the quality and validity of evaluations.

**Overall Status:** ❌ **NOT READY FOR PRODUCTION EVALUATIONS**

**Key Findings:**
- ✅ Scenario scripts are well-structured with personas and objectives
- ❌ Only 7 scenarios total (limited variety)
- ❌ No `maxTurns` enforcement (conversations could run indefinitely)
- ❌ No VOICE-type scenarios (feature exists but no content)
- ❌ All job titles have **identical criteria mappings** (illogical)
- ❌ Seed file doesn't match database (sync issue)
- ❌ One test scenario ("lost dog") is incomplete/toy data

---

## Detailed Findings

### 1. Job Titles (3 total) ✅ ADEQUATE

**Current in Database:**
1. Customer Service Representative
2. Sales Associate
3. Technical Support Specialist

**Current in Seed File (not matching!):**
1. Customer Service Representative
2. IT Help Desk Agent ← Different
3. Sales Representative ← Different

**Issue:** Database and seed file have diverged. Running `npx prisma db seed` will not update existing records properly.

---

### 2. Evaluation Criteria (8 total) ⚠️ ADEQUATE BUT ILLOGICAL MAPPINGS

**Current Criteria:**
1. Empathy (weight: 8, category: Soft Skills)
2. Problem Resolution (weight: 9, category: Core Skills)
3. Communication Clarity (weight: 7, category: Soft Skills)
4. Product Knowledge (weight: 8, category: Core Skills)
5. Active Listening (weight: 7, category: Soft Skills)
6. **Upsell/Cross-sell** (weight: 5, category: Sales Skills)
7. **Compliance** (weight: 9, category: Compliance)
8. Call Control (weight: 6, category: Core Skills)

**Major Issue:** ❌ ALL job titles have ALL 8 criteria assigned identically.

**Why This Is Wrong:**
- Technical Support Specialist should NOT be evaluated on "Upsell/Cross-sell"
- Sales Associate doesn't need "Compliance" at weight 9
- No role-specific differentiation in scoring

**Recommendation:** Create job-specific criteria mappings:
- **Customer Service:** Empathy, Problem Resolution, Communication Clarity, Product Knowledge, Active Listening, Compliance, Call Control
- **Sales Associate:** Communication Clarity, Product Knowledge, Upsell/Cross-sell, Empathy, Active Listening, Call Control
- **Technical Support:** Problem Resolution, Communication Clarity, Product Knowledge, Active Listening, Call Control, Compliance (if regulated industry)

---

### 3. Scenarios (7 total) ❌ INSUFFICIENT VARIETY

**Breakdown by Job Title:**

#### Customer Service Representative (3 scenarios)
1. **Billing Dispute** (PHONE, medium) ✅ Complete
2. **Product Return Chat** (CHAT, medium) ✅ Complete  
3. **lost dog** (CHAT, medium) ❌ INCOMPLETE - Test/toy data

#### Sales Associate (2 scenarios)
1. **Product Recommendation** (CHAT, easy) ✅ Complete
2. **Upsell Opportunity** (PHONE, hard) ✅ Complete

#### Technical Support Specialist (2 scenarios)
1. **Internet Connectivity Issue** (PHONE, hard) ✅ Complete
2. **Software Installation Help** (CHAT, easy) ✅ Complete

**Issues:**
- ❌ Only 6 production-ready scenarios (1 is test data)
- ❌ Each job has only 2 real scenarios (minimal variety)
- ❌ No VOICE scenarios despite VOICE type being supported
- ❌ No difficulty variety within some job titles
- ❌ **CRITICAL:** No `maxTurns` property set on ANY scenario (all show "unlimited")

---

### 4. Scenario Script Quality ✅ GOOD STRUCTURE

**What's Working:**
- All scenarios have `customerPersona` (detailed character descriptions)
- All scenarios have `customerObjective` (clear resolution criteria)
- All scenarios have `difficulty` (easy, medium, hard)
- All scenarios have `hints` array (guidance for AI behavior)

**What's Missing:**
- ❌ **No `maxTurns` property** - conversations could run indefinitely (infinite loops possible)
- ❌ No `voiceInstructions` for PHONE scenarios (tone, pacing, interruptions)
- ⚠️ Some hints are generic vs. specific trigger points

**Example of Good Scenario (Billing Dispute):**
```json
{
  "customerPersona": "Margaret, 58, retired schoolteacher. She discovered a $47.99 charge she does not recognize. She has been a loyal customer for 11 years and is initially frustrated but reasonable if treated with respect. She becomes more upset if talked down to or transferred multiple times.",
  "customerObjective": "Get the unrecognized charge removed and receive confirmation in writing. She will escalate if not resolved in this call.",
  "difficulty": "medium",
  "hints": [
    "Acknowledge the frustration before asking for account details",
    "Do not interrupt the customer while they are explaining",
    "Offer to investigate the charge immediately rather than scheduling a callback",
    "Confirm the resolution clearly before ending the call"
  ]
}
```

**Example of Incomplete Scenario (lost dog):**
```json
{
  "customerPersona": "happy, but pensive. Clumsy and aloof",
  "customerObjective": "Customer needs help finding puppy and will not be satisfied until the agent asks for the puppy's name",
  "difficulty": "medium",
  "hints": []
}
```
This is clearly test data and should be removed or completed.

---

## Critical Gaps for Evaluations

### 1. No Turn Limits ❌ CRITICAL
Without `maxTurns`, simulations can run indefinitely. This causes:
- Unpredictable session lengths
- Potential infinite loops
- Unclear failure criteria
- Inconsistent scoring (some sessions end naturally, others don't)

**Fix:** Add `maxTurns` to all scenarios:
- Easy: 8-10 turns
- Medium: 10-14 turns
- Hard: 12-16 turns

### 2. Illogical Criteria Mappings ❌ HIGH
All jobs have identical criteria, making scores meaningless for role comparison.

**Fix:** Differentiate criteria per role (see recommendations above).

### 3. Insufficient Scenario Variety ❌ HIGH
Only 2 scenarios per job means:
- Trainees can memorize responses
- No variety in training
- Limited skill coverage per role

**Fix:** Add at least 5-7 scenarios per job title, covering:
- Different difficulty levels
- Different customer types (angry, confused, technical, non-technical)
- Different resolution types (refund, technical fix, upsell, education)

### 4. No VOICE Scenarios ⚠️ MEDIUM
VOICE mode exists in the code but has no content.

**Fix:** Either remove VOICE type or add voice-optimized scenarios with specific instructions for:
- Pacing and pause handling
- Interruption behavior
- Vocal tone cues

---

## Recommended Actions (Priority Order)

### 🔴 CRITICAL (Do Before Production Testing)

1. **Add `maxTurns` to all scenarios**
   - Update database directly or via migration
   - Set appropriate limits based on difficulty
   - Test that sessions actually end at `maxTurns`

2. **Delete or complete "lost dog" scenario**
   - This is toy data and will confuse evaluations

3. **Fix job-criteria mappings**
   - Remove "Upsell/Cross-sell" from Technical Support
   - Remove "Compliance" from Sales (or reduce weight to 3)
   - Differentiate based on role requirements

### 🟠 HIGH (Do This Week)

4. **Resync seed file with database**
   - Document current database state as source of truth
   - Update `prisma/seed.ts` to match
   - OR run seed to overwrite database (decide which is canonical)

5. **Add 10-15 more scenarios**
   - Target: 5-7 per job title
   - Mix of PHONE and CHAT
   - Full difficulty spectrum per role

6. **Add VOICE scenarios or remove VOICE type**
   - If keeping: Add 2-3 voice-optimized scenarios per job
   - If removing: Delete from SimulationType enum

### 🟡 MEDIUM (Do This Month)

7. **Enhance scenario hints**
   - Add specific trigger points ("If agent asks X, respond with Y")
   - Add escalation paths ("If not resolved in 8 turns, demand supervisor")

8. **Add scenario metadata**
   - Estimated duration
   - Required product knowledge level
   - Industry vertical (SaaS, retail, telecom, etc.)

9. **Validate script JSON schemas**
   - Add Zod schema validation for scenario scripts
   - Prevent incomplete scenarios from being created

---

## Data Completeness Scorecard

| Component | Count | Status | Score | Notes |
|-----------|-------|--------|-------|-------|
| Job Titles | 3 | ✅ Adequate | 8/10 | Good variety but limited |
| Criteria | 8 | ✅ Adequate | 7/10 | Good list but illogical mappings |
| Scenarios (total) | 7 | ❌ Insufficient | 4/10 | Only 6 usable (1 is test data) |
| Scenarios per job | 2-3 | ❌ Insufficient | 4/10 | Need 5-7 per job minimum |
| Scenario completeness | 86% | ⚠️ Partial | 6/10 | 6/7 complete, no maxTurns |
| VOICE scenarios | 0 | ❌ Missing | 0/10 | Feature exists, no content |
| Job-criteria logic | N/A | ❌ Broken | 2/10 | All jobs have identical criteria |
| Seed-DB sync | N/A | ❌ Broken | 3/10 | Diverged, unclear which is canonical |

**Overall Data Readiness:** 4.8/10 (❌ NOT PRODUCTION READY)

---

## Immediate Next Steps

1. Run this command to add `maxTurns` to existing scenarios:
   ```sql
   -- Update all scenarios to add maxTurns based on difficulty
   UPDATE scenarios 
   SET script = jsonb_set(script, '{maxTurns}', '10'::jsonb)
   WHERE script->>'difficulty' = 'easy';
   
   UPDATE scenarios 
   SET script = jsonb_set(script, '{maxTurns}', '12'::jsonb)
   WHERE script->>'difficulty' = 'medium';
   
   UPDATE scenarios 
   SET script = jsonb_set(script, '{maxTurns}', '16'::jsonb)
   WHERE script->>'difficulty' = 'hard';
   ```

2. Delete the toy "lost dog" scenario:
   ```sql
   DELETE FROM scenarios WHERE name = 'lost dog';
   ```

3. Fix job-criteria mappings (see SQL in next section)

4. Commit to either database or seed file as source of truth

5. Build out scenario library (detailed templates below)

---

## SQL Fixes (Ready to Run)

```sql
-- 1. Add maxTurns to all scenarios based on difficulty
UPDATE scenarios 
SET script = jsonb_set(script, '{maxTurns}', '10'::jsonb)
WHERE script->>'difficulty' = 'easy';

UPDATE scenarios 
SET script = jsonb_set(script, '{maxTurns}', '12'::jsonb)
WHERE script->>'difficulty' = 'medium';

UPDATE scenarios 
SET script = jsonb_set(script, '{maxTurns}', '16'::jsonb)
WHERE script->>'difficulty' = 'hard';

-- 2. Delete toy scenario
DELETE FROM chat_messages WHERE session_id IN (SELECT id FROM simulation_sessions WHERE scenario_id IN (SELECT id FROM scenarios WHERE name = 'lost dog'));
DELETE FROM scores WHERE session_id IN (SELECT id FROM simulation_sessions WHERE scenario_id IN (SELECT id FROM scenarios WHERE name = 'lost dog'));
DELETE FROM simulation_sessions WHERE scenario_id IN (SELECT id FROM scenarios WHERE name = 'lost dog');
DELETE FROM scenarios WHERE name = 'lost dog';

-- 3. Fix Technical Support criteria (remove Upsell/Cross-sell)
DELETE FROM job_criteria 
WHERE job_title_id IN (SELECT id FROM job_titles WHERE name = 'Technical Support Specialist')
AND criteria_id IN (SELECT id FROM criteria WHERE name = 'Upsell/Cross-sell');

-- 4. Fix Sales Associate criteria (remove Compliance or reduce weight)
DELETE FROM job_criteria 
WHERE job_title_id IN (SELECT id FROM job_titles WHERE name = 'Sales Associate')
AND criteria_id IN (SELECT id FROM criteria WHERE name = 'Compliance');

-- 5. Verify changes
SELECT jt.name, c.name, c.weight 
FROM job_criteria jc
JOIN job_titles jt ON jc.job_title_id = jt.id
JOIN criteria c ON jc.criteria_id = c.id
ORDER BY jt.name, c.name;
```

---

## Conclusion

The XPElevator application has a **solid technical foundation** but the **evaluation content is incomplete and illogical** in its current state.

**Can you run evaluations today?** Yes, technically.  
**Will those evaluations be meaningful?** No - insufficient variety, illogical criteria, no turn limits.

**Estimated effort to fix:**
- Critical issues: 2-4 hours (SQL updates + testing)
- High priority: 8-16 hours (scenario creation)
- Medium priority: 4-8 hours (enhancements)

**Total:** 14-28 hours to production-ready evaluation content.
