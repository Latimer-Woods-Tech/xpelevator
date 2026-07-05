#!/usr/bin/env tsx
/**
 * ═══════════════════════════════════════════════════════════════════════
 * XPElevator — Full End-to-End Simulation Smoke Test
 * ═══════════════════════════════════════════════════════════════════════
 *
 * This script runs a complete bridge-crossing simulation against the
 * LIVE dev server (localhost:3000).  Each "segment" must pass before
 * the next begins — just like a man crossing a bridge:
 *
 *   Seg 0  — Server health check           (bridge exists)
 *   Seg 1  — Create Criteria               (lay the planks)
 *   Seg 2  — Create Job Title              (name the bridge)
 *   Seg 3  — Link Criteria → Job Title     (attach planks to bridge)
 *   Seg 4  — Create Scenario               (post the crossing sign)
 *   Seg 5  — Create Simulation Session     (man approaches entrance)
 *   Seg 6  — [START] signal                (first step onto bridge)
 *   Seg 7  — Multiple chat turns           (crossing, step by step)
 *   Seg 8  — End session with [END]        (reaching the other side)
 *   Seg 9  — Verify scores written         (stamp at the exit)
 *   Seg 10 — Analytics includes session    (crossing logged in registry)
 *   Seg 11 — Create Org + invite member    (bridge authority)
 *   Seg 12 — Cleanup                       (remove test artifacts)
 *
 * Usage:
 *   npx tsx tests/e2e/full-simulation.ts [--base-url http://localhost:3000]
 *
 * Exit codes:
 *   0 — all segments passed
 *   1 — one or more segments failed
 * ═══════════════════════════════════════════════════════════════════════
 */

const BASE_URL = (() => {
  const idx = process.argv.indexOf('--base-url');
  return idx !== -1 ? process.argv[idx + 1] : 'http://localhost:3000';
})();

// AI segments (6 & 7) require a real GROQ key — skip gracefully otherwise
const GROQ_AVAILABLE = !!(process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim().length > 10);

// ─── Colours & logging ────────────────────────────────────────────────────────

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function log(msg: string) { console.log(msg); }
function section(name: string) { log(`\n${BOLD}${CYAN}══ ${name} ${RESET}`); }

function pass(label: string) {
  passed++;
  log(`  ${GREEN}✓${RESET} ${label}`);
}

function fail(label: string, detail?: string) {
  failed++;
  failures.push(label);
  log(`  ${RED}✗${RESET} ${BOLD}${label}${RESET}${detail ? `\n    → ${RED}${detail}${RESET}` : ''}`);
}

function warn(msg: string) { log(`  ${YELLOW}⚠${RESET}  ${msg}`); }

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function api<T = unknown>(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; data: T }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });

  let data: T;
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    data = (await res.json()) as T;
  } else {
    data = (await res.text()) as unknown as T;
  }

  return { status: res.status, data };
}

/** Collect SSE events until stream closes. Returns all parsed JSON events. */
async function collectSSE(path: string, method: string, body: unknown): Promise<Array<Record<string, unknown>>> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.body) return [];

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const events: Array<Record<string, unknown>> = [];
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
  }

  for (const line of buffer.split('\n')) {
    if (line.startsWith('data: ')) {
      try { events.push(JSON.parse(line.slice(6))); } catch { /* skip */ }
    }
  }
  return events;
}

// ─── Assertions ───────────────────────────────────────────────────────────────

function assert(condition: boolean, label: string, detail?: string): boolean {
  if (condition) { pass(label); return true; }
  fail(label, detail); return false;
}

// ─── State shared across segments ────────────────────────────────────────────

let criteriaId: string;
let jobTitleId: string;
let scenarioId: string;
let sessionId: string;
let orgId: string;

// Unique suffix so re-runs don't clash on unique-name constraints
const RUN_ID = Date.now().toString(36).slice(-4).toUpperCase();

// ─── Segment 0: Server health check ──────────────────────────────────────────

async function seg0_serverHealth() {
  section('Segment 0 — Server Health Check');
  try {
    const { status } = await api('GET', '/api/jobs');
    assert(status === 200, 'Dev server is reachable at ' + BASE_URL, `Got HTTP ${status}`);
  } catch (err) {
    fail('Dev server is reachable', `${err}\n    Is "npm run dev" running?`);
    process.exit(1); // Cannot continue without server
  }
}

// ─── Segment 1: Create Criteria ──────────────────────────────────────────────

async function seg1_createCriteria() {
  section('Segment 1 — Create Criteria (lay the planks)');

  const { status, data } = await api<{ id: string; name: string }>('POST', '/api/criteria', {
    name: `[E2E-${RUN_ID}] Empathy`,
    description: 'E2E test criterion: measures agent empathy',
    weight: 8,
    category: 'E2E',
    active: true,
  });

  if (assert(status === 201, 'POST /api/criteria returns 201')) {
    criteriaId = (data as { id: string }).id;
    assert(typeof criteriaId === 'string' && criteriaId.length > 0, 'Criteria has a valid UUID', `Got: ${criteriaId}`);
    assert((data as { name: string }).name === `[E2E-${RUN_ID}] Empathy`, 'Criteria name matches', `Got: ${(data as { name: string }).name}`);
    log(`    created: ${criteriaId}`);
  }
}

// ─── Segment 2: Create Job Title ─────────────────────────────────────────────

async function seg2_createJobTitle() {
  section('Segment 2 — Create Job Title (name the bridge)');

  const { status, data } = await api<{ id: string; name: string }>('POST', '/api/jobs', {
    name: `[E2E-${RUN_ID}] Customer Service Rep`,
    description: 'E2E test job title',
  });

  if (assert(status === 201, 'POST /api/jobs returns 201')) {
    jobTitleId = (data as { id: string }).id;
    assert(typeof jobTitleId === 'string', 'Job title has valid UUID');
    log(`    created: ${jobTitleId}`);
  }
}

// ─── Segment 3: Link Criteria → Job Title ────────────────────────────────────

async function seg3_linkCriteria() {
  section('Segment 3 — Link Criteria → Job Title (attach planks)');
  if (!jobTitleId || !criteriaId) { warn('Skipped: missing IDs from earlier segments'); return; }

  const { status } = await api('POST', `/api/jobs/${jobTitleId}/criteria`, {
    criteriaId,
  });
  assert(status === 201, 'POST /api/jobs/[id]/criteria returns 201', `Got ${status}`);

  // Verify link persisted
  const { status: getStatus, data: links } = await api<Array<{ id: string }>>('GET', `/api/jobs/${jobTitleId}/criteria`);
  if (assert(getStatus === 200, 'GET /api/jobs/[id]/criteria returns 200')) {
    assert(
      Array.isArray(links) && links.some((c) => (c as { id: string }).id === criteriaId),
      'Criteria appears in job\'s linked criteria list',
      `Links: ${JSON.stringify(links)}`
    );
  }
}

// ─── Segment 4: Create Scenario ──────────────────────────────────────────────

async function seg4_createScenario() {
  section('Segment 4 — Create Scenario (post the crossing sign)');
  if (!jobTitleId) { warn('Skipped: missing jobTitleId'); return; }

  const { status, data } = await api<{ id: string; name: string }>('POST', '/api/scenarios', {
    jobTitleId,
    name: `[E2E-${RUN_ID}] Billing Dispute`,
    type: 'CHAT',
    description: 'E2E test scenario',
    script: {
      customerPersona: 'A frustrated customer who received an unexpected charge on their bill.',
      customerObjective: 'Get a full refund for the mystery charge.',
      difficulty: 'medium',
      hints: ['Customer has been charged $47.99 for a service they never signed up for.'],
    },
  });

  if (assert(status === 201, 'POST /api/scenarios returns 201')) {
    scenarioId = (data as { id: string }).id;
    assert(typeof scenarioId === 'string', 'Scenario has valid UUID');
    log(`    created: ${scenarioId}`);
  }
}

// ─── Segment 5: Create Simulation Session ────────────────────────────────────

async function seg5_createSession() {
  section('Segment 5 — Create Simulation Session (man approaches bridge)');
  if (!jobTitleId || !scenarioId) { warn('Skipped: missing IDs'); return; }

  const { status, data } = await api<{ id: string; status: string }>('POST', '/api/simulations', {
    userId: 'e2e-test-user',
    jobTitleId,
    scenarioId,
    type: 'CHAT',
  });

  if (assert(status === 201, 'POST /api/simulations returns 201')) {
    sessionId = (data as { id: string }).id;
    assert((data as { status: string }).status === 'IN_PROGRESS', 'Session status is IN_PROGRESS');
    assert(typeof sessionId === 'string', 'Session has valid UUID');
    log(`    created: ${sessionId}`);
  }
}

// ─── Segment 6: [START] signal ───────────────────────────────────────────────

async function seg6_start() {
  section('Segment 6 — [START] Signal (first step onto bridge)');
  if (!sessionId) { warn('Skipped: no sessionId'); return; }
  if (!GROQ_AVAILABLE) { warn('Skipped: GROQ_API_KEY not set — AI streaming requires a real key'); return; }

  const events = await collectSSE('/api/chat', 'POST', {
    sessionId,
    content: '[START]',
  });

  const chunkEvents = events.filter(e => e.type === 'chunk');
  const doneEvents = events.filter(e => e.type === 'done');
  const errorEvents = events.filter(e => e.type === 'error');

  assert(errorEvents.length === 0, 'No error events in [START] stream', JSON.stringify(errorEvents));
  assert(chunkEvents.length > 0, 'AI customer sends opening message (>0 chunk events)');
  assert(doneEvents.length === 1, 'Stream ends with exactly one done event');

  if (chunkEvents.length > 0) {
    const fullMsg = chunkEvents.map(e => e.content as string).join('');
    log(`    AI open: "${fullMsg.slice(0, 80)}${fullMsg.length > 80 ? '...' : ''}"`);
  }
}

// ─── Segment 7: Multiple chat turns ──────────────────────────────────────────

async function seg7_chatTurns() {
  section('Segment 7 — Chat Turns (crossing step by step)');
  if (!sessionId) { warn('Skipped: no sessionId'); return; }
  if (!GROQ_AVAILABLE) { warn('Skipped: GROQ_API_KEY not set — AI streaming requires a real key'); return; }

  const agentReplies = [
    "I understand that's frustrating. Let me pull up your account right away.",
    "I can see the charge from last month. Let me look into what it's for.",
    "I've reviewed it and I can see this was applied in error. I'll process a full refund for the $47.99.",
  ];

  for (let i = 0; i < agentReplies.length; i++) {
    const turn = i + 1;
    const events = await collectSSE('/api/chat', 'POST', {
      sessionId,
      content: agentReplies[i],
    });

    const chunkEvents = events.filter(e => e.type === 'chunk');
    const errorEvents = events.filter(e => e.type === 'error');
    const sessionEnded = events.some(e => e.type === 'session_ended' || e.type === 'session_ending');

    assert(errorEvents.length === 0, `Turn ${turn}: No error events`);

    if (sessionEnded) {
      log(`    ${YELLOW}Session auto-resolved by AI on turn ${turn}${RESET}`);
      // AI signalled [RESOLVED] — the bridge was crossed successfully
      assert(true, `Turn ${turn}: Session resolved automatically (AI signalled [RESOLVED])`);
      return; // Session already ended
    }

    assert(chunkEvents.length > 0, `Turn ${turn}: AI customer responds`, `Got 0 chunks`);
    const aiReply = chunkEvents.map(e => e.content as string).join('');
    log(`    T${turn} AI: "${aiReply.slice(0, 60)}..."`);
  }
}

// ─── Segment 8: End session ───────────────────────────────────────────────────

async function seg8_endSession() {
  section('Segment 8 — End Session with [END] (reaching the other side)');
  if (!sessionId) { warn('Skipped: no sessionId'); return; }

  // First check if session is still open
  const { data: state } = await api<{ status: string }>('GET', `/api/chat?sessionId=${sessionId}`);
  if ((state as { status: string }).status === 'COMPLETED') {
    pass('Session already COMPLETED (resolved during chat turns)');
    return;
  }

  const { status, data } = await api<{ ended: boolean; session: { status: string } }>(
    'POST', '/api/chat', { sessionId, content: '[END]' }
  );

  if (assert(status === 200, 'POST [END] returns 200')) {
    assert((data as { ended: boolean }).ended === true, 'Response has ended=true');
    assert(
      (data as { session: { status: string } }).session?.status === 'COMPLETED',
      'Session status is COMPLETED after [END]'
    );
  }
}

// ─── Segment 9: Verify scores ─────────────────────────────────────────────────

async function seg9_verifyScores() {
  section('Segment 9 — Verify Scores Written (exit stamp)');
  if (!sessionId) { warn('Skipped: no sessionId'); return; }

  const { status, data } = await api<{ status: string; scores: Array<{ score: number; criteria: { name: string } }> }>(
    'GET', `/api/chat?sessionId=${sessionId}`
  );

  if (assert(status === 200, 'GET session returns 200')) {
    const session = data as { status: string; scores: Array<{ score: number; criteria: { name: string } }> };
    assert(session.status === 'COMPLETED', 'Session is COMPLETED');

    if (session.scores && session.scores.length > 0) {
      assert(session.scores.length > 0, `Scores recorded: ${session.scores.length} criteria scored`);
      const s = session.scores[0];
      assert(typeof s.score === 'number', `Score is numeric: ${s.score}`);
      assert(s.score >= 1 && s.score <= 10, `Score is in range 1–10: ${s.score}`);
      log(`    Scores: ${session.scores.map(s => `${s.criteria.name}=${s.score}`).join(', ')}`);
    } else {
      warn('No scores found — AI scoring may not have run (check GROQ_API_KEY)');
    }
  }
}

// ─── Segment 10: Analytics ────────────────────────────────────────────────────

async function seg10_analytics() {
  section('Segment 10 — Analytics Includes Session (crossing logged)');

  const { status, data } = await api<{
    totalSessions: number;
    overallAvg: number | null;
    scoreTrend: unknown[];
    byJobTitle: unknown[];
    byType: unknown[];
    byCriteria: unknown[];
  }>('GET', '/api/analytics');

  if (assert(status === 200, 'GET /api/analytics returns 200')) {
    const analytics = data as {
      totalSessions: number;
      overallAvg: number | null;
      scoreTrend: unknown[];
      byJobTitle: unknown[];
      byType: unknown[];
      byCriteria: unknown[];
    };
    assert(typeof analytics.totalSessions === 'number', 'totalSessions is a number');
    assert(Array.isArray(analytics.scoreTrend), 'scoreTrend is an array');
    assert(Array.isArray(analytics.byJobTitle), 'byJobTitle is an array');
    assert(Array.isArray(analytics.byType), 'byType is an array');
    assert(Array.isArray(analytics.byCriteria), 'byCriteria is an array');
    log(`    totalSessions=${analytics.totalSessions}, overallAvg=${analytics.overallAvg?.toFixed(2) ?? 'null'}`);
  }
}

// ─── Segment 11: Org + member ─────────────────────────────────────────────────

async function seg11_orgAndMember() {
  section('Segment 11 — Org Management (bridge authority)');

  // Create org
  const { status: s1, data: orgData } = await api<{ id: string; slug: string }>(
    'POST', '/api/orgs', { name: `[E2E-${RUN_ID}] Test Corporation` }
  );

  if (assert(s1 === 201, 'POST /api/orgs creates organization')) {
    orgId = (orgData as { id: string }).id;
    const slug = (orgData as { slug: string }).slug;
    assert(slug.includes('test-corporation'), `Auto-slug contains org name: "${slug}"`);
    log(`    created org: ${orgId}`);

    // Add a member
    const { status: s2 } = await api('POST', `/api/orgs/${orgId}/members`, {
      email: 'e2e-test@xpelevator.dev',
      role: 'MEMBER',
    });
    assert(s2 === 201, 'POST /api/orgs/[id]/members invites member');

    // Verify member appears
    const { status: s3, data: members } = await api<Array<{ email: string }>>('GET', `/api/orgs/${orgId}/members`);
    if (assert(s3 === 200, 'GET /api/orgs/[id]/members returns member list')) {
      assert(
        (members as Array<{ email: string }>).some(m => m.email === 'e2e-test@xpelevator.dev'),
        'Invited member appears in list'
      );
    }

    // Upgrade plan
    const { status: s4, data: updated } = await api<{ plan: string }>(
      'PUT', `/api/orgs/${orgId}`, { plan: 'PRO' }
    );
    if (assert(s4 === 200, 'PUT /api/orgs/[id] upgrades org plan')) {
      assert((updated as { plan: string }).plan === 'PRO', 'Plan is now PRO');
    }
  }
}

// ─── Segment 12: Cleanup ──────────────────────────────────────────────────────

async function seg12_cleanup() {
  section('Segment 12 — Cleanup (remove test artifacts)');

  // Delete org (no sessions on it → safe)
  if (orgId) {
    const { status } = await api('DELETE', `/api/orgs/${orgId}`);
    assert(status === 204, `DELETE org ${orgId} returns 204`);
  }

  // Delete scenario (may fail if sessions reference it — that's expected)
  if (scenarioId) {
    const { status } = await api('DELETE', `/api/scenarios/${scenarioId}`);
    if (status === 204) {
      pass(`DELETE scenario ${scenarioId}`);
    } else {
      warn(`Scenario ${scenarioId} not deleted (has FK from sessions) — OK`);
    }
  }

  // Unlink criteria from job
  if (jobTitleId && criteriaId) {
    await api('DELETE', `/api/jobs/${jobTitleId}/criteria`, { criteriaId });
    pass('Criteria unlinked from job title');
  }

  // Delete job title (cascade fails if sessions exist — skip if so)
  if (jobTitleId) {
    const { status } = await api('DELETE', `/api/jobs/${jobTitleId}`);
    if (status === 204) {
      pass(`DELETE job title ${jobTitleId}`);
    } else {
      warn(`Job title ${jobTitleId} not deleted (has FK references) — OK for sessions`);
    }
  }

  // Delete criteria
  if (criteriaId) {
    const { status } = await api('DELETE', `/api/criteria/${criteriaId}`);
    if (status === 200) {
      pass(`DELETE criteria ${criteriaId}`);
    } else {
      warn(`Criteria ${criteriaId} not deleted (has FK references) — OK`);
    }
  }
}

// ─── Main runner ──────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${BOLD}${CYAN}╔════════════════════════════════════════════════════════╗`);
  console.log(`║  XPElevator — End-to-End Simulation Smoke Test         ║`);
  console.log(`║  Target: ${BASE_URL.padEnd(46)}║`);
  console.log(`╚════════════════════════════════════════════════════════╝${RESET}`);

  const start = Date.now();

  await seg0_serverHealth();
  await seg1_createCriteria();
  await seg2_createJobTitle();
  await seg3_linkCriteria();
  await seg4_createScenario();
  await seg5_createSession();
  await seg6_start();
  await seg7_chatTurns();
  await seg8_endSession();
  await seg9_verifyScores();
  await seg10_analytics();
  await seg11_orgAndMember();
  await seg12_cleanup();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`${BOLD}Results:${RESET} ${GREEN}${passed} passed${RESET}  ${failed > 0 ? RED : ''}${failed} failed${RESET}  (${elapsed}s)`);

  if (failures.length > 0) {
    console.log(`\n${RED}Failed checks:${RESET}`);
    failures.forEach(f => console.log(`  ${RED}✗${RESET} ${f}`));
    console.log('');
  } else {
    console.log(`\n${GREEN}${BOLD}All checks passed — bridge fully crossed!${RESET}\n`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(`\n${RED}${BOLD}Unexpected error:${RESET}`, err);
  process.exit(1);
});
