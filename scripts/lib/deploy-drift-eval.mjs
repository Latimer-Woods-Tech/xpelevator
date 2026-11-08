/**
 * deploy-drift-eval.mjs — pure verdict logic for the uptime monitor's
 * deploy-drift check (scripts/deploy-drift-check.mjs → runner).
 *
 * WHY THIS EXISTS (#343): dependabot auto-merges land their squash with the
 * repo's `GITHUB_TOKEN`, and a push made with `GITHUB_TOKEN` does NOT trigger
 * `push`-triggered workflows (GitHub's recursion guard). Both ci.yml and
 * deploy.yml are `on: push: branches: [main]`, so EVERY dependabot auto-merge
 * silently skips CI + Deploy: `main` advances but production keeps serving the
 * previously-deployed build until the next human/feature merge carries the bumps
 * forward. deploy.yml's own G72 gate only proves a deploy serves ITS OWN commit
 * at promote time; nothing watches for `origin/main` drifting AHEAD of the live
 * build afterward. This is that missing ongoing watch — detection-only, no deploy
 * authority (the auto-deploy reconciler in #343 option (c) is a founder call).
 *
 * The one failure mode that matters: production serving STALE SHIPPED CODE — a
 * runtime-dependency or `src/**`/config change sitting on `main`, unbuilt, while
 * trainees run the old worker. A security or runtime bump that auto-merged this
 * way would be invisible. That MUST surface.
 *
 * The one failure mode that does NOT matter (and must stay quiet, or the monitor
 * becomes the churn the loop has spent 25+ runs avoiding): a devDependency-only
 * drift (the exact 2026-11-08 #341 state — vitest / adapter / eslint-config-next
 * dev bumps). Those never reach the runtime bundle; the live build is
 * byte-for-byte functionally identical and healthy, and the bumps land
 * automatically on the next feature merge. Drift that touches only devDeps,
 * tests, docs, CI, or monitor scripts is reported `benign` and never pages.
 *
 * Deploy-ordering safety: in the window between a merge (the monitor workflow
 * updates immediately) and the promote (minutes later), `/api/health` still
 * reports the PRIOR commit — a transient, self-healing drift, not an outage. And
 * a build predating the G72 stamp reports `commit: 'dev'`. Neither is a
 * trustworthy drift signal, so an unknown/unstamped deployed commit returns
 * `status: 'unknown'` and NEVER pages — liveness is the health probe's job, not
 * this one's.
 *
 * Pure, dependency-free, Node/Worker-safe (no I/O). Being pure, it carries its
 * own proof-of-rejection unit test (Standing Law 1): the same function the
 * monitor trusts is exercised with a shipped-code drift to prove it STILL fires.
 */

const SHA40 = /^[0-9a-f]{40}$/;

/**
 * Paths whose change between the deployed commit and `main` means the live
 * worker is serving STALE SHIPPED CODE (a real page). Everything NOT matched
 * here — tests, docs, `.github/**`, `scripts/**`, the lockfile, a devDeps-only
 * package.json bump — is inert until the next feature merge and stays quiet.
 *
 * `package.json` is deliberately NOT keyed off its filename: a devDeps bump and
 * a runtime-dependency bump both touch it, and only the latter ships. The runner
 * diffs the `dependencies` block across the two commits and passes the result as
 * `runtimeDepsChanged`; the filename alone is treated as benign.
 */
function shipsToRuntime(path) {
  if (path.startsWith('src/')) return true;
  // Root config files that are compiled into or configure the shipped worker.
  const SHIPPED_CONFIG = new Set([
    'next.config.js',
    'next.config.mjs',
    'next.config.ts',
    'open-next.config.ts',
    'open-next.config.js',
    'open-next.config.mjs',
    'wrangler.toml',
    'wrangler.jsonc',
    'wrangler.json',
    'middleware.ts',
    'src/middleware.ts',
    'prisma/schema.prisma',
  ]);
  return SHIPPED_CONFIG.has(path);
}

/**
 * Decide the deploy-drift verdict from the live deployed commit, the current
 * `main` tip, and the set of files (and runtime-deps flag) that differ between
 * them.
 *
 * @param {{
 *   deployedCommit?: string | null,
 *   mainSha?: string | null,
 *   changedFiles?: string[] | null,
 *   runtimeDepsChanged?: boolean | null,
 *   diffable?: boolean,
 * }} input
 *   deployedCommit     — `.commit` from GET /api/health (the live build's SHA).
 *   mainSha            — the current `origin/main` tip SHA.
 *   changedFiles       — repo-relative paths that differ deployed..main.
 *   runtimeDepsChanged — did package.json's runtime `dependencies` change?
 *   diffable           — were both commits present locally to compute the diff?
 *                        false → drift exists but could not be classified.
 * @returns {{
 *   status: 'unknown' | 'in-sync' | 'benign' | 'stale',
 *   drifted: boolean,
 *   pages: boolean,
 *   deployedCommit: string | null,
 *   mainSha: string | null,
 *   runtimeFiles: string[],
 *   reason: string,
 * }}
 *   pages — true only for `stale`: production is serving stale SHIPPED code.
 */
export function evaluateDeployDrift({
  deployedCommit,
  mainSha,
  changedFiles,
  runtimeDepsChanged,
  diffable,
} = {}) {
  const dep = typeof deployedCommit === 'string' ? deployedCommit.trim().toLowerCase() : '';
  const main = typeof mainSha === 'string' ? mainSha.trim().toLowerCase() : '';

  // Can't trust the comparison unless BOTH sides are real 40-hex commit SHAs.
  // A missing/`dev`/short deployed commit = pre-stamp or unreachable build:
  // liveness is the health probe's concern, never a drift page.
  if (!SHA40.test(dep) || !SHA40.test(main)) {
    return {
      status: 'unknown',
      drifted: false,
      pages: false,
      deployedCommit: dep || null,
      mainSha: main || null,
      runtimeFiles: [],
      reason:
        'Deployed commit or main tip is not a stampable 40-hex SHA ' +
        `(deployed=${deployedCommit ?? 'null'}, main=${mainSha ?? 'null'}) — ` +
        'cannot judge drift; left to the health probe.',
    };
  }

  if (dep === main) {
    return {
      status: 'in-sync',
      drifted: false,
      pages: false,
      deployedCommit: dep,
      mainSha: main,
      runtimeFiles: [],
      reason: 'Production serves the current main tip — no drift.',
    };
  }

  // Drifted. Classify benign (inert) vs stale (shipped code is behind).
  const files = Array.isArray(changedFiles) ? changedFiles.filter((f) => typeof f === 'string') : [];
  const runtimeFiles = files.filter(shipsToRuntime);
  const depsChanged = runtimeDepsChanged === true;

  // Could not compute the diff (deployed commit absent from local history) →
  // we cannot PROVE the drift is benign, so surface it rather than hide it.
  if (diffable === false) {
    return {
      status: 'stale',
      drifted: true,
      pages: true,
      deployedCommit: dep,
      mainSha: main,
      runtimeFiles: [],
      reason:
        'Production is behind main and the deployed commit is not in local ' +
        'history, so the change set could not be classified — surfacing it to be ' +
        'safe (treat as potential stale shipped code until a deploy syncs).',
    };
  }

  if (runtimeFiles.length > 0 || depsChanged) {
    const bits = [];
    if (runtimeFiles.length > 0) bits.push(`${runtimeFiles.length} shipped file(s)`);
    if (depsChanged) bits.push('runtime dependencies');
    return {
      status: 'stale',
      drifted: true,
      pages: true,
      deployedCommit: dep,
      mainSha: main,
      runtimeFiles,
      reason:
        `Production is serving a stale build: main changed ${bits.join(' + ')} ` +
        'that the live worker has not been rebuilt with. Deploy main to sync.',
    };
  }

  return {
    status: 'benign',
    drifted: true,
    pages: false,
    deployedCommit: dep,
    mainSha: main,
    runtimeFiles: [],
    reason:
      'Production is behind main, but only devDependencies / tests / docs / CI / ' +
      'monitor scripts changed — nothing reaches the runtime bundle. Inert until ' +
      'the next feature merge carries it forward; no page.',
  };
}
