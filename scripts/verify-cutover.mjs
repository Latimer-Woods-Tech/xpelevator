/**
 * verify-cutover.mjs — decisive proof that xpelevator.com now serves the NEW
 * LWT build (xpelevator-sim), not the old deployment.
 *
 * The DNS repoint (scripts/dns-flip.mjs) is already verified at the CF API
 * layer (apex + www CNAME → xpelevator-sim.pages.dev). But /api/health returns
 * 200 on BOTH the old and new builds, so health alone can't distinguish them.
 * This script:
 *   1. Polls the Pages custom-domain status for apex + www until "active"
 *      (cert fully issued + routing binding live).
 *   2. Fingerprints the running build by extracting the Next.js buildId from the
 *      HTML of xpelevator.com AND xpelevator-sim.pages.dev, and asserts they are
 *      EQUAL — i.e. the branded domain is serving the exact same build as the
 *      new project. Equality is self-calibrating: no need to hardcode a hash.
 *
 * Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, CF_PROJECT, APEX.
 */

const TOKEN = process.env.CLOUDFLARE_API_TOKEN?.replace(/[\r\n]/g, '');
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID?.replace(/[\r\n]/g, '');
const PROJECT = (process.env.CF_PROJECT || 'xpelevator-sim').trim();
const APEX = (process.env.APEX || 'xpelevator.com').trim();
const WWW = `www.${APEX}`;
const SIM = `${PROJECT}.pages.dev`;
const API = 'https://api.cloudflare.com/client/v4';

const fail = (msg, extra) => {
  console.error(`\n✗ VERIFY FAILED: ${msg}`);
  if (extra !== undefined) console.error(typeof extra === 'string' ? extra : JSON.stringify(extra, null, 2));
  process.exit(1);
};

async function cf(path) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  }).catch((e) => fail(`network error calling CF API ${path}`, String(e)));
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok && body?.success !== false, status: res.status, body };
}

async function domainStatus(name) {
  const r = await cf(`/accounts/${ACCOUNT}/pages/projects/${PROJECT}/domains/${name}`);
  return r.ok ? (r.body.result?.status || 'unknown') : `err${r.status}`;
}

// Extract the Next.js buildId from a page's HTML (App Router emits
// /_next/static/<buildId>/_buildManifest.js etc.). Returns null if not found.
async function buildId(host) {
  try {
    const res = await fetch(`https://${host}/`, { redirect: 'follow' });
    const html = await res.text();
    const m = html.match(/\/_next\/static\/([^/"']+)\/_(?:buildManifest|ssgManifest)/) ||
              html.match(/"buildId":"([^"]+)"/) ||
              html.match(/\/_next\/static\/([^/"']+)\/_next/);
    return { code: res.status, id: m ? m[1] : null, len: html.length };
  } catch (e) { return { code: 0, id: null, err: String(e).slice(0, 120) }; }
}

// ── Step 1: wait for the Pages custom domain to go active ────────────────────
console.log(`=== Wait for Pages custom-domain status = active (${APEX}, ${WWW}) ===`);
const DEADLINE = Date.now() + 10 * 60 * 1000;
let sA = '', sW = '', attempt = 0;
while (Date.now() < DEADLINE) {
  attempt++;
  [sA, sW] = [await domainStatus(APEX), await domainStatus(WWW)];
  console.log(`attempt ${attempt}: ${APEX}=${sA} | ${WWW}=${sW}`);
  if (sA === 'active' && sW === 'active') break;
  await new Promise((r) => setTimeout(r, 20000));
}
if (sA !== 'active' || sW !== 'active') {
  console.warn(`⚠️ domains not both 'active' yet (apex=${sA} www=${sW}) — continuing to build-fingerprint anyway`);
}

// ── Step 2: fingerprint the running build (branded vs new project) ───────────
console.log(`\n=== Build fingerprint: ${APEX} vs ${SIM} ===`);
const [apexFp, simFp] = [await buildId(APEX), await buildId(SIM)];
console.log(`${APEX}   → HTTP ${apexFp.code}, buildId=${apexFp.id}`);
console.log(`${SIM} → HTTP ${simFp.code}, buildId=${simFp.id}`);

if (!simFp.id) fail(`could not read a buildId from ${SIM} (HTTP ${simFp.code}) — cannot calibrate`);
if (!apexFp.id) fail(`could not read a buildId from ${APEX} (HTTP ${apexFp.code})`);

if (apexFp.id === simFp.id) {
  console.log(`\n✅ CUTOVER CONFIRMED: ${APEX} is serving the SAME build as ${SIM} (buildId ${apexFp.id}).`);
  console.log(`   Pages domain status: ${APEX}=${sA}, ${WWW}=${sW}.`);
  process.exit(0);
}
fail(`${APEX} buildId (${apexFp.id}) ≠ ${SIM} buildId (${simFp.id}) — branded domain is NOT yet serving the new build ` +
     `(propagation lag or the old deployment still answering). Re-run shortly; DNS is already repointed.`);
