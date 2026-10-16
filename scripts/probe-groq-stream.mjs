/**
 * probe-groq-stream.mjs — ground-truth diagnostic for the per-turn token-usage
 * regression the scoring canary caught (R-132 / #155, alerts #278 → #296).
 *
 * The 6-hourly scoring canary asserts that each simulated-customer reply row
 * carries a non-null Groq `total_tokens` (the Phase-4 wholesale-seat margin
 * input). It went red on 2026-10-05 and STAYED red after PR #295 taught
 * `pickStreamTokenUsage()` to read `usage` OR `x_groq.usage` — so the live
 * `openai/gpt-oss-*` stream must carry the terminal token block somewhere
 * neither location matches, or not emit it at all.
 *
 * The sandbox that authors these fixes cannot reach api.groq.com (egress
 * policy 403), so the shape was never OBSERVED — only assumed from mocked unit
 * tests. This probe runs on the Actions runner (which holds GROQ_API_KEY and
 * has egress), drives a REAL streaming completion for the exact models the live
 * customer turn uses, and prints the raw terminal SSE chunks + a structured
 * report of WHERE (if anywhere) the usage block lands. Read its output in the
 * uptime-monitor "health" job log to ground the next fix in observed data.
 *
 * Non-failing by contract: it always exits 0 (a diagnostic must never redden
 * the health probe). Env: GROQ_API_KEY.
 */

const BASE_URL = 'https://api.groq.com/openai/v1';
// The two models the live customer turn actually uses (src/lib/ai.ts):
//   fast   → openai/gpt-oss-20b  (easy/medium live turns — the common path)
//   realism→ openai/gpt-oss-120b (hard live turns + the scoring judge)
const MODELS = ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'];

/** The same tolerant extraction the Worker uses, inlined (no TS import here). */
function isUsage(v) {
  return (
    v &&
    typeof v === 'object' &&
    typeof v.prompt_tokens === 'number' &&
    Number.isFinite(v.prompt_tokens) &&
    typeof v.completion_tokens === 'number' &&
    Number.isFinite(v.completion_tokens) &&
    typeof v.total_tokens === 'number' &&
    Number.isFinite(v.total_tokens)
  );
}

/** Report every path in `obj` (bounded depth) that holds a usage-shaped block. */
function findUsagePaths(obj, prefix = '', depth = 0, out = []) {
  if (!obj || typeof obj !== 'object' || depth > 6) return out;
  if (isUsage(obj)) out.push(prefix || '<root>');
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object') {
      if (isUsage(v)) out.push(prefix ? `${prefix}.${k}` : k);
      else findUsagePaths(v, prefix ? `${prefix}.${k}` : k, depth + 1, out);
    }
  }
  return out;
}

async function probe(apiKey, model) {
  console.log(`\n───────────────────────────────────────────────`);
  console.log(`PROBE model=${model}`);
  let res;
  try {
    res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        stream: true,
        stream_options: { include_usage: true },
        temperature: 0.75,
        max_tokens: 40,
        messages: [
          { role: 'system', content: 'You are a terse assistant.' },
          { role: 'user', content: 'Reply with exactly: hello there friend' },
        ],
      }),
    });
  } catch (e) {
    console.log(`  ✗ fetch threw: ${e?.message || e}`);
    return;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.log(`  ✗ HTTP ${res.status}: ${body.slice(0, 300)}`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const rawChunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]' || data === '') continue;
      try {
        rawChunks.push(JSON.parse(data));
      } catch {
        /* skip */
      }
    }
  }
  // Flush any trailing buffered line the loop's `if (done) break` would drop —
  // this probe deliberately checks whether the terminal usage chunk can be lost
  // to an unflushed buffer (a hypothesis for the regression).
  const tail = buffer.trim();
  let tailHadData = false;
  if (tail.startsWith('data: ')) {
    const data = tail.slice(6).trim();
    if (data && data !== '[DONE]') {
      tailHadData = true;
      try {
        rawChunks.push(JSON.parse(data));
      } catch {
        /* skip */
      }
    }
  }

  console.log(`  chunks parsed: ${rawChunks.length}; unflushed-tail-carried-data: ${tailHadData}`);

  // Where does usage actually appear, across ALL chunks?
  const allPaths = new Set();
  let anyUsage = null;
  for (const c of rawChunks) {
    for (const p of findUsagePaths(c)) {
      allPaths.add(p);
      if (!anyUsage) anyUsage = { path: p, chunk: c };
    }
  }
  console.log(`  usage block found at path(s): ${allPaths.size ? [...allPaths].join(', ') : 'NONE'}`);

  // Print the last 3 raw chunks verbatim so the exact shape is observable.
  const lastN = rawChunks.slice(-3);
  console.log(`  last ${lastN.length} raw chunk(s):`);
  for (const c of lastN) {
    console.log(`    ${JSON.stringify(c).slice(0, 1000)}`);
  }
  if (anyUsage) {
    console.log(`  ✅ usage present → ${anyUsage.path} = ${JSON.stringify(
      findUsagePaths(anyUsage.chunk).length ? anyUsage.chunk : {}
    ).slice(0, 300)}`);
  } else {
    console.log(`  ⚠️  NO usage-shaped block in ANY chunk for ${model} — include_usage not honored in stream for this model`);
  }
}

async function main() {
  const apiKey = (process.env.GROQ_API_KEY || '').replace(/^﻿/, '').replace(/[\r\n]/g, '');
  console.log('=== Groq stream usage-shape probe (R-132 / #155) ===');
  if (!apiKey) {
    console.log('⚠️  GROQ_API_KEY absent — skipping probe (non-fatal diagnostic).');
    return;
  }
  console.log(`key length: ${apiKey.length}`);
  for (const model of MODELS) {
    await probe(apiKey, model);
  }
  console.log('\n=== probe complete (diagnostic — always exits 0) ===');
}

main()
  .catch((e) => console.log(`probe error (ignored): ${e?.stack || e}`))
  .finally(() => process.exit(0));
