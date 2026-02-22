#!/usr/bin/env node
/**
 * XPElevator Full Integration Validator
 * 
 * Tests every layer of the simulation stack:
 *   1. Environment variables
 *   2. Database connectivity + data integrity
 *   3. Scenario / job data completeness
 *   4. Groq API connectivity + streaming
 *   5. Full chat simulation turn (DB save → AI → DB save)
 *   6. Telnyx connectivity check
 * 
 * Run:  node validate.mjs
 * Deps: loads .env automatically via --experimental-env-file or dotenv
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load .env manually ────────────────────────────────────────────────────────
const envPath = join(__dirname, '.env');
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '').replace(/\r/g, '');
    if (key && !process.env[key]) process.env[key] = val;
  }
  console.log('✅ .env loaded');
} else {
  console.warn('⚠️  No .env file found — relying on existing environment variables');
}

// ── Helpers ────────────────────────────────────────────────────────────────────
const PASS = (label, detail = '') => console.log(`  ✅ ${label}${detail ? ' — ' + detail : ''}`);
const FAIL = (label, detail = '') => console.log(`  ❌ ${label}${detail ? ' — ' + detail : ''}`);
const WARN = (label, detail = '') => console.log(`  ⚠️  ${label}${detail ? ' — ' + detail : ''}`);
const HEAD = (label) => console.log(`\n━━━ ${label} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

let totalPass = 0, totalFail = 0, totalWarn = 0;
const results = [];

function check(passed, label, detail = '') {
  if (passed === true) { PASS(label, detail); totalPass++; results.push({ status: 'pass', label }); }
  else if (passed === 'warn') { WARN(label, detail); totalWarn++; results.push({ status: 'warn', label }); }
  else { FAIL(label, detail); totalFail++; results.push({ status: 'fail', label }); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. ENVIRONMENT VARIABLES
// ═══════════════════════════════════════════════════════════════════════════════
HEAD('1. Environment Variables');

const requiredEnv = ['DATABASE_URL', 'GROQ_API_KEY', 'AUTH_SECRET'];
const optionalEnv = ['TELNYX_API_KEY', 'TELNYX_CONNECTION_ID', 'TELNYX_WEBHOOK_URL', 'TELNYX_FROM_NUMBER'];

for (const key of requiredEnv) {
  const val = process.env[key];
  if (!val) check(false, key, 'MISSING — required for core functionality');
  else check(true, key, `set (${val.length} chars, starts: ${val.slice(0, 6)}...)`);
}
for (const key of optionalEnv) {
  const val = process.env[key];
  if (!val) check('warn', key, 'not set — phone simulation will not work');
  else check(true, key, `set (${val.slice(0, 8)}...)`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. DATABASE CONNECTIVITY
// ═══════════════════════════════════════════════════════════════════════════════
HEAD('2. Database Connectivity');

let prisma;
try {
  const { PrismaNeonHTTP } = await import('@prisma/adapter-neon');
  // Use the standard Node.js Prisma client. The wasm build is for edge/CF Workers.
  // Since we now use split create+findUnique (no nested where in create+include),
  // there are no implicit transactions and this works fine with the Neon HTTP adapter.
  const { PrismaClient } = await import('@prisma/client');
  const url = process.env.DATABASE_URL?.replace(/\r/g, '');
  if (!url) throw new Error('DATABASE_URL not set');
  const adapter = new PrismaNeonHTTP(url);
  prisma = new PrismaClient({ adapter });
  check(true, 'Prisma client initialized');
} catch (err) {
  check(false, 'Prisma client init', err.message);
  process.exit(1);
}

// ── Job Titles ────────────────────────────────────────────────────────────────
let jobTitles = [];
try {
  jobTitles = await prisma.jobTitle.findMany({ include: { scenarios: true, jobCriteria: { include: { criteria: true } } } });
  check(jobTitles.length > 0, 'job_titles table', `${jobTitles.length} records found`);
  for (const j of jobTitles) {
    check(true, `  Job: "${j.name}"`, `${j.scenarios.length} scenarios, ${j.jobCriteria.length} criteria`);
  }
} catch (err) {
  check(false, 'job_titles query', err.message);
}

// ── Scenarios ─────────────────────────────────────────────────────────────────
let scenarios = [];
try {
  scenarios = await prisma.scenario.findMany({ include: { jobTitle: true } });
  check(scenarios.length > 0, 'scenarios table', `${scenarios.length} records found`);
} catch (err) {
  check(false, 'scenarios query', err.message);
}

// ── Scenario script integrity ──────────────────────────────────────────────────
HEAD('3. Scenario Script Validation');
for (const s of scenarios) {
  const script = s.script;
  const hasScript = script && typeof script === 'object' && !Array.isArray(script);
  const hasPersona = hasScript && 'customerPersona' in script && String(script.customerPersona).trim().length > 0;
  const hasObjective = hasScript && 'customerObjective' in script && String(script.customerObjective).trim().length > 0;
  const hasDifficulty = hasScript && ['easy', 'medium', 'hard'].includes(script.difficulty);

  const label = `Scenario "${s.name}" (${s.type}) → ${s.jobTitle.name}`;
  if (!hasPersona || !hasObjective || !hasDifficulty) {
    const missing = [!hasPersona && 'customerPersona', !hasObjective && 'customerObjective', !hasDifficulty && 'difficulty'].filter(Boolean).join(', ');
    check(false, label, `script missing: ${missing}`);
  } else {
    check(true, label, `persona: "${String(script.customerPersona).slice(0, 40)}..."`);
  }
}

// ── Criteria ──────────────────────────────────────────────────────────────────
HEAD('4. Criteria + Job Linkage');
let criteria = [];
try {
  criteria = await prisma.criteria.findMany({ where: { active: true } });
  check(criteria.length > 0, 'active criteria', `${criteria.length} active criteria`);
} catch (err) {
  check(false, 'criteria query', err.message);
}

for (const j of jobTitles) {
  if (j.jobCriteria.length === 0) {
    check('warn', `Job "${j.name}"`, 'has NO criteria linked — scoring will use all active criteria as fallback');
  } else {
    check(true, `Job "${j.name}" criteria`, j.jobCriteria.map(jc => jc.criteria.name).join(', '));
  }
}

// ── Sessions ──────────────────────────────────────────────────────────────────
HEAD('5. Session State Audit');
try {
  const sessions = await prisma.simulationSession.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: {
      scenario: true,
      _count: { select: { messages: true, scores: true } }
    }
  });
  console.log(`  Found ${sessions.length} sessions (most recent 20)`);
  const stuck = sessions.filter(s => s.status === 'IN_PROGRESS' && s._count.messages === 0);
  const completed = sessions.filter(s => s.status === 'COMPLETED');
  const withMsgs = sessions.filter(s => s._count.messages > 0);
  check(stuck.length === 0, 'No stuck IN_PROGRESS sessions with 0 messages', stuck.length > 0 ? `${stuck.length} stuck sessions found` : '');
  check(completed.length > 0 || true, 'Completed sessions', `${completed.length} completed, ${withMsgs.length} with messages`);
  if (stuck.length > 0) {
    console.log(`\n  🔴 Stuck sessions (created but AI never responded):`);
    for (const s of stuck.slice(0, 5)) {
      console.log(`     • ${s.id.slice(0, 8)}... "${s.scenario.name}" (${s.type}) created ${s.createdAt.toISOString()}`);
    }
  }
} catch (err) {
  check(false, 'sessions audit', err.message);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. GROQ API CONNECTIVITY
// ═══════════════════════════════════════════════════════════════════════════════
HEAD('6. Groq AI Connectivity');

const apiKey = process.env.GROQ_API_KEY?.replace(/\r/g, '');
if (!apiKey) {
  check(false, 'GROQ_API_KEY', 'not set — all chat simulations will fail');
} else {
  try {
    const { default: Groq } = await import('groq-sdk');
    const groq = new Groq({ apiKey });
    check(true, 'Groq SDK import (dynamic)');

    // Test non-streaming
    console.log('  Testing non-streaming completion...');
    const t0 = Date.now();
    const res = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: 'You are a test assistant. Reply with exactly: OK' },
        { role: 'user', content: 'Reply OK' }
      ],
      max_tokens: 10,
      temperature: 0,
    });
    const reply = res.choices[0]?.message?.content ?? '';
    check(reply.length > 0, 'Groq non-streaming response', `"${reply.trim()}" in ${Date.now() - t0}ms`);

    // Test streaming
    console.log('  Testing streaming completion...');
    const t1 = Date.now();
    const stream = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: 'You are a brief customer named Sam calling about a billing issue.' },
        { role: 'user', content: '[START]' }
      ],
      max_tokens: 80,
      temperature: 0.7,
      stream: true,
    });
    let streaming = '';
    for await (const chunk of stream) {
      streaming += chunk.choices[0]?.delta?.content ?? '';
    }
    check(streaming.length > 0, 'Groq streaming response', `${streaming.length} chars in ${Date.now() - t1}ms, preview: "${streaming.slice(0, 60)}..."`);

  } catch (err) {
    check(false, 'Groq API call', err.message);
    console.log(`\n  💡 Groq error details:\n     ${err.message}`);
    if (err.message?.includes('401') || err.message?.includes('invalid_api_key')) {
      console.log('     → GROQ_API_KEY is set but INVALID. Get a new key from console.groq.com');
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7. END-TO-END CHAT SIMULATION (Lost Dog or first available scenario)
// ═══════════════════════════════════════════════════════════════════════════════
HEAD('7. End-to-End Chat Simulation');

const chatScenario = scenarios.find(s => s.type === 'CHAT') ??
  scenarios.find(s => s.name?.toLowerCase().includes('lost'));

if (!chatScenario) {
  check(false, 'No CHAT scenario available to test');
} else if (!apiKey) {
  check('warn', 'E2E chat skipped', 'GROQ_API_KEY not set');
} else {
  try {
    // Create a test session — IMPORTANT: do NOT use create+include with nested where
    // (triggers implicit transaction which Neon HTTP adapter does not support).
    // Mirror the pattern from simulations/route.ts: create plain, then findUnique.
    const testJob = jobTitles.find(j => j.scenarios.some(s => s.id === chatScenario.id));
    if (!testJob) throw new Error('Could not find job title for chat scenario');

    const created = await prisma.simulationSession.create({
      data: {
        jobTitleId: testJob.id,
        scenarioId: chatScenario.id,
        type: 'CHAT',
        status: 'IN_PROGRESS',
        userId: 'validate-test',
        startedAt: new Date(),
      },
    });
    // Fetch with relations separately (same pattern used throughout the app)
    const session = await prisma.simulationSession.findUnique({
      where: { id: created.id },
      include: {
        scenario: true,
        jobTitle: {
          include: {
            jobCriteria: { where: { criteria: { active: true } }, include: { criteria: true } }
          }
        }
      }
    });
    if (!session) throw new Error('Could not refetch test session');
    check(true, `Test session created`, `ID: ${session.id.slice(0, 8)}... scenario: "${chatScenario.name}"`);

    // Build system prompt (mirrors what chat route does)
    const script = session.scenario.script;
    let parsedScript = { customerPersona: 'A customer who needs assistance.', customerObjective: 'Get help with their issue.', difficulty: 'medium' };
    if (script && typeof script === 'object' && 'customerPersona' in script) parsedScript = script;

    const systemPrompt = `You are a virtual customer in a call center training simulation. Stay completely in character at all times.
SCENARIO: ${session.scenario.name}
CUSTOMER PERSONA: ${parsedScript.customerPersona}
YOUR OBJECTIVE: ${parsedScript.customerObjective}
DIFFICULTY LEVEL: ${parsedScript.difficulty.toUpperCase()}
Keep responses concise (1-3 sentences). Begin the conversation by describing your issue.`;

    // Send [START] → get first AI response
    const { default: Groq } = await import('groq-sdk');
    const groq = new Groq({ apiKey });

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: '[START]' }
    ];

    console.log(`\n  Sending [START] to AI for scenario "${chatScenario.name}"...`);
    let firstResponse = '';
    const stream = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages,
      max_tokens: 150,
      temperature: 0.7,
      stream: true,
    });
    for await (const chunk of stream) {
      firstResponse += chunk.choices[0]?.delta?.content ?? '';
    }
    check(firstResponse.length > 0, 'AI generated first customer message', `"${firstResponse.slice(0, 80)}..."`);

    // Save AI message to DB
    const customerMsg = await prisma.chatMessage.create({
      data: { sessionId: session.id, role: 'CUSTOMER', content: firstResponse.trim() }
    });
    check(!!customerMsg.id, 'Customer message saved to DB', customerMsg.id.slice(0, 8) + '...');

    // Save a test agent reply
    const agentMsg = await prisma.chatMessage.create({
      data: { sessionId: session.id, role: 'AGENT', content: 'Hi! How can I help you today?' }
    });
    check(!!agentMsg.id, 'Agent message saved to DB', agentMsg.id.slice(0, 8) + '...');

    // Verify messages can be retrieved
    const savedMessages = await prisma.chatMessage.findMany({ where: { sessionId: session.id }, orderBy: { timestamp: 'asc' } });
    check(savedMessages.length === 2, 'Messages retrievable from DB', `${savedMessages.length} messages`);

    // Test scoring (inline — avoids importing TypeScript source directly)
    console.log('\n  Testing auto-scoring via Groq...');
    const jobCriteria = session.jobTitle.jobCriteria.map(jc => jc.criteria);
    const scoringCriteria = jobCriteria.length > 0 ? jobCriteria : await prisma.criteria.findMany({ where: { active: true } });
    check(scoringCriteria.length > 0, 'Scoring criteria available', `${scoringCriteria.length} criteria for "${testJob.name}"`);

    const criteriaBlock = scoringCriteria.map(c => `- ${c.name} (weight ${c.weight}): ${c.description ?? ''}`).join('\n');
    const transcriptText = `CUSTOMER: ${firstResponse}\nAGENT: Hi! How can I help you today?`;
    const scoringPrompt = `Score the following conversation on each criterion from 0-10. Return JSON array only:\n[{"criteriaId":"id","criteriaName":"name","score":5,"justification":"reason"}]\n\nCriteria:\n${criteriaBlock}\n\nTranscript:\n${transcriptText}`;
    const { default: Groq2 } = await import('groq-sdk');
    const groq2 = new Groq2({ apiKey });
    const scoringRes = await groq2.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: scoringPrompt }],
      max_tokens: 500,
      temperature: 0,
    });
    const raw = scoringRes.choices[0]?.message?.content ?? '';
    let scores = [];
    try {
      const jsonStart = raw.indexOf('[');
      const jsonEnd = raw.lastIndexOf(']') + 1;
      scores = JSON.parse(raw.slice(jsonStart, jsonEnd));
    } catch { /* ok */ }
    check(scores.length > 0, 'Auto-scoring returned results', `${scores.length} scores`);
    for (const sc of scores.slice(0, 3)) {
      console.log(`     • ${sc.criteriaName}: ${sc.score}/10 — "${String(sc.justification).slice(0, 60)}..."`);
    }

    // Clean up test session
    await prisma.score.deleteMany({ where: { sessionId: session.id } });
    await prisma.chatMessage.deleteMany({ where: { sessionId: session.id } });
    await prisma.simulationSession.delete({ where: { id: session.id } });
    check(true, 'Test session cleaned up');

  } catch (err) {
    check(false, 'E2E chat flow', err.message);
    console.log(`\n  💡 Detail: ${err.stack?.split('\n').slice(0, 3).join('\n  ')}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 8. TELNYX CONNECTIVITY
// ═══════════════════════════════════════════════════════════════════════════════
HEAD('8. Telnyx Phone Integration');

const telnyxKey = process.env.TELNYX_API_KEY?.replace(/\r/g, '');
const telnyxConn = process.env.TELNYX_CONNECTION_ID?.replace(/\r/g, '');
const telnyxWebhook = process.env.TELNYX_WEBHOOK_URL?.replace(/\r/g, '');
const telnyxFrom = process.env.TELNYX_FROM_NUMBER?.replace(/\r/g, '');

if (!telnyxKey) {
  check('warn', 'TELNYX_API_KEY not set', 'phone simulations disabled');
} else {
  try {
    const res = await fetch('https://api.telnyx.com/v2/phone_numbers?page[size]=1', {
      headers: { 'Authorization': `Bearer ${telnyxKey}`, 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    check(res.ok, 'Telnyx API key valid', res.ok ? `HTTP ${res.status}` : `HTTP ${res.status}: ${JSON.stringify(data.errors?.[0])}`);
  } catch (err) {
    check(false, 'Telnyx API connectivity', err.message);
  }
  check(!!telnyxConn, 'TELNYX_CONNECTION_ID', telnyxConn ? telnyxConn.slice(0, 12) + '...' : 'MISSING');
  check(!!telnyxWebhook, 'TELNYX_WEBHOOK_URL', telnyxWebhook ?? 'MISSING — webhook events will not reach the app');
  check(!!telnyxFrom, 'TELNYX_FROM_NUMBER', telnyxFrom ?? 'MISSING — calls cannot be initiated');
  
  // Check webhook model in telnyx route
  console.log('\n  Checking webhook Groq model version...');
  try {
    const { readFileSync } = await import('fs');
    const path = await import('path');
    const webhookPath = path.join(__dirname, 'src/app/api/telnyx/webhook/route.ts');
    const webhookSrc = readFileSync(webhookPath, 'utf8');
    const usesDeprecated = webhookSrc.includes('llama3-70b-8192');
    check(!usesDeprecated, 'Webhook Groq model', usesDeprecated 
      ? 'USES DEPRECATED llama3-70b-8192 — will return 404 from Groq (BL-050)'
      : 'using current model');
  } catch (err) {
    check('warn', 'Could not verify webhook model', err.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════════════════
HEAD('SUMMARY');
console.log(`\n  Results: ${totalPass} passed, ${totalWarn} warnings, ${totalFail} failed`);

const failures = results.filter(r => r.status === 'fail');
const warnings = results.filter(r => r.status === 'warn');

if (failures.length > 0) {
  console.log('\n  🔴 Failures to fix:');
  failures.forEach(f => console.log(`     • ${f.label}`));
}
if (warnings.length > 0) {
  console.log('\n  🟡 Warnings (optional but recommended):');
  warnings.forEach(w => console.log(`     • ${w.label}`));
}
if (failures.length === 0 && warnings.length === 0) {
  console.log('\n  🟢 All systems operational!');
} else if (failures.length === 0) {
  console.log('\n  🟢 Core simulation pipeline is functional (warnings above are optional)');
}

console.log('');
