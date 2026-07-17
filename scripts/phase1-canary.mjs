/**
 * phase1-canary.mjs — Phase 1(d) end-to-end scoring canary.
 *
 * Drives ONE full authenticated chat session against the LIVE LWT deploy
 * (xpelevator-sim.pages.dev) and asserts the core loop produces a NON-NULL score
 * — the exact acceptance for Phase 1 (live-issue #1 was "scoring is DOWN,
 * every session score null"). Doubles as the Phase-1 "scoring canary".
 *
 * Auth: rather than fight the NextAuth credentials sign-in flow over curl (the
 * app sets no trustHost/AUTH_URL, so the sign-in POST would throw UntrustedHost),
 * we MINT a valid Auth.js v5 JWT session cookie from the staged AUTH_SECRET and
 * present it. Reading/decoding an existing session cookie needs no host trust, so
 * this exercises the real deployed endpoints exactly as a signed-in user would.
 *
 * Env: BASE_URL, DATABASE_URL, AUTH_SECRET.
 */
import { neon } from '@neondatabase/serverless';
import { encode } from 'next-auth/jwt';

const BASE = (process.env.BASE_URL || '').replace(/\/$/, '');
const AUTH_SECRET = process.env.AUTH_SECRET?.replace(/\r/g, '');
const DB = process.env.DATABASE_URL?.replace(/\r/g, '');
if (!BASE || !AUTH_SECRET || !DB) {
  console.error('Missing BASE_URL / AUTH_SECRET / DATABASE_URL');
  process.exit(1);
}
const sql = neon(DB);
const CANARY_EMAIL = 'phase1-canary@xpelevator.internal';
const AGENT_LINE =
  "I'm really sorry for the frustration this has caused — that's not the " +
  "experience we want for you. Let me pull up your account right now and make " +
  "this right. Can you confirm the email on the account so I can locate it and " +
  "issue the correction today?";

const fail = (msg, extra) => {
  console.error(`\n✗ CANARY FAILED: ${msg}`);
  if (extra !== undefined) console.error(extra);
  process.exit(1);
};

// Drain a Response body fully (server-side DB writes in SSE streams only complete
// when the body is consumed), returning the text.
async function drain(res) {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

async function mintCookieHeader(userId) {
  // Auth.js binds the JWE to a salt = the cookie name. On https the session
  // cookie is __Secure-authjs.session-token; some proxy setups see http and use
  // the bare name. Mint one for each and send both — the server reads whichever
  // matches its config, ignores the other.
  const token = { name: 'Phase1 Canary', email: CANARY_EMAIL, sub: userId, id: userId };
  const maxAge = 30 * 24 * 60 * 60;
  const names = ['__Secure-authjs.session-token', 'authjs.session-token'];
  const parts = [];
  for (const salt of names) {
    const jwe = await encode({ token, secret: AUTH_SECRET, salt, maxAge });
    parts.push(`${salt}=${jwe}`);
  }
  return parts.join('; ');
}

async function req(method, path, cookie, body) {
  const headers = { cookie };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return res;
}

async function main() {
  console.log(`=== Phase 1(d) scoring canary → ${BASE} ===\n`);

  // ── 0. Preconditions: scenario + active criteria must exist ────────────────
  const scenarios = await sql`
    SELECT id, job_title_id AS "jobTitleId", type
    FROM scenarios ORDER BY created_at LIMIT 1
  `;
  if (scenarios.length === 0) fail('no scenarios in DB to run a session against');
  const scenario = scenarios[0];
  const critCount = await sql`SELECT count(*)::int AS n FROM criteria WHERE active = true`;
  console.log(`Scenario ${scenario.id} (job ${scenario.jobTitleId}); active criteria: ${critCount[0].n}`);
  if (critCount[0].n === 0) fail('no active criteria — scoring would have nothing to score');

  // ── 1. Upsert canary user (its id becomes the session subject) ─────────────
  const upsert = await sql`
    INSERT INTO users (id, email, name, role, created_at)
    VALUES (gen_random_uuid(), ${CANARY_EMAIL}, 'Phase1 Canary', 'MEMBER', NOW())
    ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
  `;
  const userId = upsert[0].id;
  console.log(`Canary user: ${userId}`);

  const cookie = await mintCookieHeader(userId);

  // ── 2. Validate the minted cookie authenticates ────────────────────────────
  const sessRes = await req('GET', '/api/auth/session', cookie);
  const sessTxt = await drain(sessRes);
  let sessJson = {};
  try { sessJson = JSON.parse(sessTxt); } catch { /* may be empty */ }
  console.log(`GET /api/auth/session -> HTTP ${sessRes.status}: ${sessTxt.slice(0, 200)}`);
  if (sessRes.status !== 200 || sessJson?.user?.email !== CANARY_EMAIL) {
    fail('minted session cookie did not authenticate (server user.email mismatch)', sessTxt);
  }
  console.log('✓ authenticated as canary user\n');

  // ── 3. Create a CHAT session ───────────────────────────────────────────────
  const createRes = await req('POST', '/api/simulations', cookie, {
    jobTitleId: scenario.jobTitleId,
    scenarioId: scenario.id,
    type: 'CHAT',
  });
  const createTxt = await drain(createRes);
  if (createRes.status !== 201) fail(`POST /api/simulations -> ${createRes.status}`, createTxt);
  const sessionId = JSON.parse(createTxt).id;
  console.log(`✓ session created: ${sessionId}`);

  // ── 4. Drive the conversation ──────────────────────────────────────────────
  // [START] → customer opener; then a real agent turn; then [END] → score.
  //
  // Conversation-latency instrumentation (R-057): the opener's terminal SSE
  // event must carry a numeric `timing` object so speed is a monitored metric,
  // not a vibe — the founder-flagged "half-speed" feel becomes trackable.
  //
  // This canary auto-fires on a merge to `main` (paths filter), CONCURRENTLY
  // with the separate "Deploy to Cloudflare Pages" workflow — so for the first
  // minutes after a merge, BASE can still be serving the PREVIOUS build, whose
  // `done` event has no `timing`. Retry the opener until the new build's timing
  // object appears (bounded), instead of failing on a build-propagation race.
  const MAX_START_ATTEMPTS = 15;
  const START_RETRY_MS = 20000;
  let startTxt = '';
  let timing;
  for (let attempt = 1; attempt <= MAX_START_ATTEMPTS; attempt++) {
    const startRes = await req('POST', '/api/chat', cookie, { sessionId, content: '[START]' });
    startTxt = await drain(startRes);
    if (startRes.status !== 200) fail(`chat [START] -> ${startRes.status}`, startTxt);
    const m = startTxt.match(/"timing":\s*(\{[^}]*\})/);
    if (m) {
      try {
        timing = JSON.parse(m[1]);
      } catch {
        fail('chat [START] timing object is not valid JSON', m[1]);
      }
      break;
    }
    if (attempt < MAX_START_ATTEMPTS) {
      console.log(`  [START] attempt ${attempt}: no timing yet (new build may still be propagating) — retrying in ${START_RETRY_MS / 1000}s...`);
      await new Promise((r) => setTimeout(r, START_RETRY_MS));
    }
  }
  console.log(`✓ [START] streamed (${startTxt.length} bytes of SSE)`);
  if (!timing) {
    fail('chat [START] SSE carried no timing object after retries — latency instrumentation missing', startTxt.slice(-400));
  }
  if (typeof timing.ttftMs !== 'number' || typeof timing.totalMs !== 'number' || typeof timing.tier !== 'string') {
    fail('timing present but ttftMs/totalMs/tier not the expected shape', JSON.stringify(timing));
  }
  console.log(`✓ turn latency instrumented: ttft=${timing.ttftMs}ms total=${timing.totalMs}ms tier=${timing.tier}`);

  const turnRes = await req('POST', '/api/chat', cookie, { sessionId, content: AGENT_LINE });
  const turnTxt = await drain(turnRes);
  if (turnRes.status !== 200) fail(`chat agent-turn -> ${turnRes.status}`, turnTxt);
  // The turn may itself end the session: customer auto-resolve ([RESOLVED] →
  // session_ended SSE) or a maxTurns cap (endSession JSON with "ended":true).
  const autoEnded = /"session_ended"|"ended"\s*:\s*true/.test(turnTxt);
  console.log(`✓ agent turn streamed${autoEnded ? ' (session already ended → scored)' : ''}`);

  if (!autoEnded) {
    const endRes = await req('POST', '/api/chat', cookie, { sessionId, content: '[END]' });
    const endTxt = await drain(endRes);
    if (endRes.status === 200) {
      console.log('✓ [END] processed (session scored server-side)');
    } else if (endRes.status === 400) {
      // "already closed" — the turn ended the session first (auto-resolve /
      // maxTurns). Benign; the score assertion below is the real gate.
      console.log(`ℹ [END] -> 400 (session already closed by the turn): ${endTxt.slice(0, 120)}`);
    } else {
      // Any OTHER status means [END] was REJECTED, so endSession/scoring never
      // fired and the session can never produce a score. A 429 here is exactly
      // the regression fixed in PR #109 — control signals ([START]/[END]) must
      // bypass the per-turn throttle; a trainee (or this canary) ending within
      // MIN_TURN_INTERVAL_MS of their last reply was 429'd, nulling the score
      // (alert #107). Fail fast with the cause instead of masking it as the
      // generic "no scores" failure the poll loop would otherwise report.
      fail(
        `[END] rejected with ${endRes.status} — session could not close or score ` +
          `(control-signal throttle regression? see PR #109)`,
        endTxt.slice(0, 200)
      );
    }
  }

  // ── 5. Verify a NON-NULL score persisted ───────────────────────────────────
  // Poll the session GET; scoring is a synchronous LLM call but re-read to be safe.
  let scores = [];
  let status = '';
  for (let i = 1; i <= 5; i++) {
    const getRes = await req('GET', `/api/chat?sessionId=${sessionId}`, cookie);
    const getTxt = await drain(getRes);
    if (getRes.status !== 200) fail(`GET session -> ${getRes.status}`, getTxt);
    const s = JSON.parse(getTxt);
    status = s.status;
    scores = Array.isArray(s.scores) ? s.scores : [];
    if (scores.length > 0) break;
    console.log(`  poll ${i}: status=${status}, scores=${scores.length} — retrying...`);
    await new Promise((r) => setTimeout(r, 3000));
  }

  if (scores.length === 0) fail(`session ${sessionId} produced NO scores (status=${status})`);

  const numeric = scores.filter((s) => typeof s.score === 'number' && s.score >= 1 && s.score <= 10);
  if (numeric.length === 0) {
    fail('scores present but all null/out-of-range', JSON.stringify(scores, null, 2));
  }

  const avg = (numeric.reduce((a, s) => a + s.score, 0) / numeric.length).toFixed(2);
  console.log(`\n✅ PASS — session ${sessionId} (status=${status}) scored:`);
  for (const s of numeric) {
    console.log(`   • ${s.criteria?.name ?? s.criteria?.id}: ${s.score}/10 — ${(s.feedback || '').slice(0, 90)}`);
  }
  console.log(`   Non-null criteria scored: ${numeric.length}/${scores.length}; simple avg ${avg}/10`);
  console.log('\nSCORING ENGINE IS LIVE — a full session produced non-null scores.');
}

main().catch((e) => fail('unexpected error', e?.stack || String(e)));
