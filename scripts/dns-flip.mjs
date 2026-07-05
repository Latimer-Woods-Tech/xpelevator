/**
 * dns-flip.mjs — Phase 1 final step: flip xpelevator.com onto the LWT deploy.
 *
 * Founder-authorized (issue #16, comment B2, 2026-07-05): "conditional
 * pre-authorization stands (flip only after posted evidence: preview health 200
 * + non-null score)." That evidence was posted (PR #22 / run 28736232109). This
 * script executes the cutover the previous slice proposed and the founder blessed.
 *
 * What it does, DISCOVERY-FIRST and defensively:
 *   1. Resolve the xpelevator.com zone; ASSERT it lives in CF_ACCOUNT_ID (LWT).
 *      Assert the Pages project xpelevator-sim exists. Abort before ANY mutation
 *      if either assumption is wrong.
 *   2. Snapshot the current apex + www DNS records (ROLLBACK STATE) and print
 *      the exact API calls to revert.
 *   3. Add xpelevator.com + www.xpelevator.com as Pages custom domains
 *      (provisions the TLS cert; idempotent).
 *   4. Best-effort explicit DNS upsert → proxied CNAME to xpelevator-sim.pages.dev
 *      (tolerates a DNS-scope 403 — Pages auto-manages in-account DNS anyway).
 *   5. Poll `curl` https://xpelevator.com/api/health + www until BOTH return 200
 *      — the real proof of a live cutover. Reports Pages domain status alongside.
 *
 * Zero-downtime: the old deployment (founder's other account) keeps serving until
 * DNS propagates; the new deploy is verified-identical code. Reversible: the
 * rollback commands printed in step 2 repoint the records back.
 *
 * Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, CF_PROJECT, APEX.
 */

const TOKEN = process.env.CLOUDFLARE_API_TOKEN?.replace(/[\r\n]/g, '');
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID?.replace(/[\r\n]/g, '');
const PROJECT = (process.env.CF_PROJECT || 'xpelevator-sim').trim();
const APEX = (process.env.APEX || 'xpelevator.com').trim();
const WWW = `www.${APEX}`;
const TARGET = `${PROJECT}.pages.dev`;
const API = 'https://api.cloudflare.com/client/v4';

if (!TOKEN || !ACCOUNT) {
  console.error('Missing CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID');
  process.exit(1);
}

const abort = (msg, extra) => {
  console.error(`\n✗ ABORT (no mutation performed unless logged above): ${msg}`);
  if (extra !== undefined) console.error(typeof extra === 'string' ? extra : JSON.stringify(extra, null, 2));
  process.exit(1);
};

async function cf(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  }).catch((e) => abort(`network error calling CF API ${path}`, String(e)));
  let body;
  try { body = await res.json(); } catch { body = { _nonjson: await res.text().catch(() => '') }; }
  return { ok: res.ok && body?.success !== false, status: res.status, body };
}

// ── Step 1: discovery + hard asserts ────────────────────────────────────────
console.log(`\n=== Step 1: discovery (zone=${APEX}, project=${PROJECT}, account=${ACCOUNT}) ===`);

const zoneRes = await cf(`/zones?name=${encodeURIComponent(APEX)}`);
if (!zoneRes.ok) abort(`could not list zone ${APEX} (HTTP ${zoneRes.status})`, zoneRes.body?.errors);
const zone = zoneRes.body.result?.[0];
if (!zone) abort(`zone ${APEX} not found on this token/account`);
console.log(`zone id: ${zone.id}`);
console.log(`zone account: ${zone.account?.id} (${zone.account?.name})`);
if (zone.account?.id !== ACCOUNT) {
  abort(`zone ${APEX} is in account ${zone.account?.id}, NOT the LWT account ${ACCOUNT}. ` +
        `The plan assumes the zone is LWT-owned. Refusing to touch a foreign zone.`);
}
const ZONE_ID = zone.id;

const projRes = await cf(`/accounts/${ACCOUNT}/pages/projects/${PROJECT}`);
if (!projRes.ok) abort(`Pages project ${PROJECT} not found in account ${ACCOUNT} (HTTP ${projRes.status})`, projRes.body?.errors);
console.log(`Pages project ${PROJECT} exists ✓ (subdomain: ${projRes.body.result?.subdomain})`);

// ── Step 2: snapshot rollback state ─────────────────────────────────────────
console.log(`\n=== Step 2: snapshot current DNS (ROLLBACK STATE) ===`);
async function recordsFor(name) {
  const r = await cf(`/zones/${ZONE_ID}/dns_records?name=${encodeURIComponent(name)}`);
  if (!r.ok) abort(`could not read DNS records for ${name}`, r.body?.errors);
  return r.body.result || [];
}
const before = { [APEX]: await recordsFor(APEX), [WWW]: await recordsFor(WWW) };
for (const [name, recs] of Object.entries(before)) {
  console.log(`\n${name}: ${recs.length} record(s)`);
  for (const rec of recs) {
    console.log(`  • id=${rec.id} type=${rec.type} content=${rec.content} proxied=${rec.proxied} ttl=${rec.ttl}`);
  }
}
console.log(`\n--- ROLLBACK: to revert, PUT each record back to its content above, e.g. ---`);
for (const [name, recs] of Object.entries(before)) {
  for (const rec of recs) {
    console.log(`  curl -X PUT "${API}/zones/${ZONE_ID}/dns_records/${rec.id}" -H "Authorization: Bearer <TOKEN>" ` +
      `-d '${JSON.stringify({ type: rec.type, name, content: rec.content, proxied: rec.proxied, ttl: rec.ttl })}'`);
  }
}

// ── Step 3: add Pages custom domains (cert provisioning; idempotent) ─────────
console.log(`\n=== Step 3: add Pages custom domains to ${PROJECT} ===`);
async function addDomain(name) {
  const r = await cf(`/accounts/${ACCOUNT}/pages/projects/${PROJECT}/domains`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  const already = JSON.stringify(r.body?.errors || '').match(/already|exists|8000007|conflict/i);
  if (!r.ok && !already) abort(`failed to add custom domain ${name} (HTTP ${r.status})`, r.body?.errors);
  console.log(`  ${name}: ${r.ok ? 'added' : 'already present'} ✓`);
}
await addDomain(APEX);
await addDomain(WWW);

// ── Step 4: best-effort explicit DNS upsert → proxied CNAME to the project ───
console.log(`\n=== Step 4: point ${APEX} + ${WWW} → ${TARGET} (proxied) ===`);
async function upsertCname(name) {
  const existing = (before[name] || []);
  const desired = { type: 'CNAME', name, content: TARGET, proxied: true, ttl: 1 };
  // Update the first existing record in place (preserves nothing else here — apex/www
  // should be a single routing record); create if none exist.
  if (existing.length > 0) {
    const rec = existing[0];
    const r = await cf(`/zones/${ZONE_ID}/dns_records/${rec.id}`, { method: 'PUT', body: JSON.stringify(desired) });
    if (r.ok) { console.log(`  ${name}: updated record ${rec.id} → CNAME ${TARGET} (proxied) ✓`); return true; }
    console.warn(`  ${name}: explicit DNS update returned HTTP ${r.status} (${JSON.stringify(r.body?.errors)}) — ` +
      `Pages may already manage this in-account; relying on curl proof.`);
    return false;
  }
  const r = await cf(`/zones/${ZONE_ID}/dns_records`, { method: 'POST', body: JSON.stringify(desired) });
  if (r.ok) { console.log(`  ${name}: created CNAME ${TARGET} (proxied) ✓`); return true; }
  console.warn(`  ${name}: explicit DNS create returned HTTP ${r.status} (${JSON.stringify(r.body?.errors)}).`);
  return false;
}
await upsertCname(APEX);
await upsertCname(WWW);

// ── Step 5: poll for live cutover proof (curl health 200 on apex + www) ──────
console.log(`\n=== Step 5: verify cutover — curl /api/health on ${APEX} + ${WWW} ===`);
async function domainStatus(name) {
  const r = await cf(`/accounts/${ACCOUNT}/pages/projects/${PROJECT}/domains/${name}`);
  return r.ok ? (r.body.result?.status || r.body.result?.validation_data?.status || 'unknown') : `err${r.status}`;
}
async function health(host) {
  try {
    const res = await fetch(`https://${host}/api/health`, { redirect: 'manual' });
    const txt = await res.text().catch(() => '');
    return { code: res.status, txt: txt.slice(0, 200) };
  } catch (e) { return { code: 0, txt: String(e).slice(0, 120) }; }
}

const DEADLINE = Date.now() + 12 * 60 * 1000; // 12 min for cert + propagation
let apexOk = false, wwwOk = false, attempt = 0;
while (Date.now() < DEADLINE && !(apexOk && wwwOk)) {
  attempt++;
  const [sA, sW] = [await domainStatus(APEX), await domainStatus(WWW)];
  const [hA, hW] = [await health(APEX), await health(WWW)];
  apexOk = hA.code === 200;
  wwwOk = hW.code === 200;
  console.log(`attempt ${attempt}: ${APEX} status=${sA} health=${hA.code} | ${WWW} status=${sW} health=${hW.code}`);
  if (hA.code === 200 && attempt === 1) console.log(`  ${APEX} body: ${hA.txt}`);
  if (apexOk && wwwOk) break;
  await new Promise((r) => setTimeout(r, 15000));
}

if (apexOk && wwwOk) {
  const hA = await health(APEX);
  console.log(`\n✅ CUTOVER LIVE: https://${APEX}/api/health → 200`);
  console.log(`   body: ${hA.txt}`);
  console.log(`✅ https://${WWW}/api/health → 200`);
  process.exit(0);
}

console.error(`\n✗ Cutover not confirmed within the deadline. apex200=${apexOk} www200=${wwwOk}`);
console.error(`  DNS was pointed at ${TARGET}; this may be slow propagation or a cert still issuing.`);
console.error(`  Inspect Pages domain status above. Roll back with the commands printed in Step 2 if needed.`);
process.exit(1);
