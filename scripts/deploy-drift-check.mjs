/**
 * deploy-drift-check.mjs — detect when production (the live /api/health build)
 * has drifted BEHIND `origin/main`, and classify the drift (#343).
 *
 * Runs on the GitHub Actions runner (the sandbox/prod egress to the branded
 * domain is policy-blocked; all live checks run runner-side, per the repo's
 * staged-secrets pattern). Dependency-free: Node's global fetch + git.
 *
 * WHY (#343): dependabot auto-merges push with `GITHUB_TOKEN`, which does NOT
 * re-trigger `push`-triggered workflows, so ci.yml + deploy.yml (both
 * `on: push: [main]`) are silently skipped and production keeps serving the
 * previously-deployed build. deploy.yml's G72 gate only proves a deploy serves
 * its OWN commit at promote time; nothing watches for drift afterward. This is
 * that watch — DETECTION ONLY, no deploy authority (the auto-deploy reconciler
 * in #343 option (c) is a founder call).
 *
 * This script only GATHERS evidence and writes it to `drift-result.json`; the
 * verdict is the pure, unit-tested evaluateDeployDrift() (scripts/lib/
 * deploy-drift-eval.mjs). The workflow's github-script step reads the JSON and
 * opens/closes a single titled alert issue — and only `status: 'stale'`
 * (production serving stale SHIPPED code) ever opens one; an inert devDeps-only
 * drift is recorded to the job summary and stays quiet. Always exits 0 (the
 * issue, not a red run, is the signal — a perpetual red here would mask the
 * health probe).
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { evaluateDeployDrift } from './lib/deploy-drift-eval.mjs';

const BASE_URL = (process.env.BASE_URL || 'https://xpelevator.com').replace(/\/+$/, '');
const RESULT_FILE = process.env.DRIFT_RESULT_FILE || 'drift-result.json';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function tryGit(args) {
  try {
    return git(args);
  } catch {
    return null;
  }
}

/** The current main tip: prefer the explicit env (github.sha on a scheduled run
 *  is the default-branch tip), else local HEAD. */
function resolveMainSha() {
  const fromEnv = (process.env.MAIN_SHA || process.env.GITHUB_SHA || '').trim();
  if (/^[0-9a-f]{40}$/i.test(fromEnv)) return fromEnv.toLowerCase();
  return (tryGit(['rev-parse', 'HEAD']) || '').toLowerCase();
}

async function fetchDeployedCommit() {
  const url = `${BASE_URL}/api/health`;
  const res = await fetch(url, { headers: { 'user-agent': 'xpelevator-deploy-drift-check' } }).catch(
    (e) => ({ ok: false, status: 0, _err: String(e && e.message ? e.message : e) }),
  );
  if (!res || !res.ok) {
    return { commit: null, note: `GET ${url} -> ${res ? res.status : '000'}${res && res._err ? ` (${res._err})` : ''}` };
  }
  const body = await res.json().catch(() => null);
  const commit = body && typeof body.commit === 'string' ? body.commit : null;
  return { commit, note: `GET ${url} -> 200, commit=${commit ?? '<missing>'}` };
}

/** Did package.json's RUNTIME `dependencies` block change deployed..main? */
function runtimeDepsChanged(deployed, main) {
  const read = (sha) => {
    const raw = tryGit(['show', `${sha}:package.json`]);
    if (!raw) return null;
    try {
      const pkg = JSON.parse(raw);
      return JSON.stringify(pkg.dependencies || {});
    } catch {
      return null;
    }
  };
  const a = read(deployed);
  const b = read(main);
  if (a === null || b === null) return null; // can't tell
  return a !== b;
}

async function main() {
  const mainSha = resolveMainSha();
  const { commit: deployedCommit, note } = await fetchDeployedCommit();

  // Can we diff the two commits locally? (checkout uses fetch-depth: 0)
  let changedFiles = [];
  let diffable = true;
  let depsChanged = null;
  const is40 = (s) => /^[0-9a-f]{40}$/i.test(s || '');
  if (is40(deployedCommit) && is40(mainSha) && deployedCommit.toLowerCase() !== mainSha) {
    const haveDeployed = tryGit(['cat-file', '-e', `${deployedCommit}^{commit}`]) !== null;
    if (!haveDeployed) {
      diffable = false;
    } else {
      const out = tryGit(['diff', '--name-only', `${deployedCommit}`, `${mainSha}`]);
      if (out === null) {
        diffable = false;
      } else {
        changedFiles = out.split('\n').map((s) => s.trim()).filter(Boolean);
        depsChanged = runtimeDepsChanged(deployedCommit, mainSha);
      }
    }
  }

  const verdict = evaluateDeployDrift({
    deployedCommit,
    mainSha,
    changedFiles,
    runtimeDepsChanged: depsChanged,
    diffable,
  });

  const result = { ...verdict, baseUrl: BASE_URL, probe: note, changedFiles, runtimeDepsChanged: depsChanged };
  writeFileSync(RESULT_FILE, JSON.stringify(result, null, 2));

  // Human-readable summary (Actions step summary + log).
  const icon = { stale: '🔴', benign: 'ℹ️', 'in-sync': '✅', unknown: '⚪' }[verdict.status] || '•';
  const lines = [
    `## Deploy-drift check — ${icon} ${verdict.status}`,
    '',
    `- Live build (${BASE_URL}/api/health): \`${verdict.deployedCommit ?? '<unknown>'}\``,
    `- \`main\` tip: \`${verdict.mainSha ?? '<unknown>'}\``,
    `- Probe: ${note}`,
    verdict.runtimeFiles.length ? `- Shipped files behind: ${verdict.runtimeFiles.map((f) => `\`${f}\``).join(', ')}` : null,
    depsChanged === true ? '- Runtime `dependencies` changed: yes' : null,
    '',
    verdict.reason,
  ].filter((l) => l !== null);
  const summary = lines.join('\n');
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`, { flag: 'a' });
    } catch {
      /* non-fatal */
    }
  }
  // Always exit 0: the alert issue (managed by the workflow) is the signal.
}

main().catch((e) => {
  // Never fail the job — drift detection must never redden the monitor.
  console.error(`deploy-drift-check: unexpected error (non-fatal): ${e && e.stack ? e.stack : e}`);
  try {
    writeFileSync(RESULT_FILE, JSON.stringify({ status: 'unknown', drifted: false, pages: false, error: String(e) }, null, 2));
  } catch {
    /* ignore */
  }
  process.exit(0);
});
