import { describe, it, expect } from 'vitest';
// The uptime monitor (scripts/deploy-drift-check.mjs → runner, wired into
// .github/workflows/uptime-monitor.yml) imports this exact module to decide
// whether `origin/main` has drifted AHEAD of the live build in a way that means
// production is serving STALE SHIPPED CODE (#343). Testing it here is the
// proof-of-rejection (Standing Law 1) for that new gate: the same verdict
// function the monitor trusts is exercised below with a shipped-code drift to
// prove it STILL fires — the dependabot-auto-merge-skips-deploy blind spot the
// G72 promote-time gate cannot see.
import { evaluateDeployDrift } from '../../../scripts/lib/deploy-drift-eval.mjs';

const A = 'a'.repeat(40); // a deployed commit SHA
const B = 'b'.repeat(40); // the current main tip SHA

describe('evaluateDeployDrift — fires only on stale SHIPPED code, quiet on inert drift', () => {
  it('in-sync: deployed == main → not drifted, no page', () => {
    const v = evaluateDeployDrift({
      deployedCommit: A,
      mainSha: A,
      changedFiles: [],
      runtimeDepsChanged: false,
      diffable: true,
    });
    expect(v.status).toBe('in-sync');
    expect(v.drifted).toBe(false);
    expect(v.pages).toBe(false);
  });

  // The load-bearing proof-of-rejection: a src/** change on main that the live
  // build was not rebuilt with MUST page.
  it('REJECTS stale shipped code: a src/** change on main → stale (pages)', () => {
    const v = evaluateDeployDrift({
      deployedCommit: A,
      mainSha: B,
      changedFiles: ['src/app/api/chat/route.ts', 'README.md'],
      runtimeDepsChanged: false,
      diffable: true,
    });
    expect(v.status).toBe('stale');
    expect(v.drifted).toBe(true);
    expect(v.pages).toBe(true);
    expect(v.runtimeFiles).toEqual(['src/app/api/chat/route.ts']);
  });

  // A runtime-dependency bump ships even if no src/** file changed — it MUST page.
  it('REJECTS a runtime-dependency drift: runtimeDepsChanged → stale (pages)', () => {
    const v = evaluateDeployDrift({
      deployedCommit: A,
      mainSha: B,
      changedFiles: ['package.json', 'package-lock.json'],
      runtimeDepsChanged: true,
      diffable: true,
    });
    expect(v.status).toBe('stale');
    expect(v.pages).toBe(true);
  });

  // Shipped config (wrangler / next / open-next / middleware / prisma schema) ships.
  it('REJECTS a shipped-config drift: wrangler.jsonc on main → stale (pages)', () => {
    const v = evaluateDeployDrift({
      deployedCommit: A,
      mainSha: B,
      changedFiles: ['wrangler.jsonc'],
      runtimeDepsChanged: false,
      diffable: true,
    });
    expect(v.status).toBe('stale');
    expect(v.pages).toBe(true);
    expect(v.runtimeFiles).toEqual(['wrangler.jsonc']);
  });

  // The exact 2026-11-08 #341 state: devDeps-only drift is INERT and must stay
  // quiet — paging on it would be the manufactured churn the loop avoids.
  it('stays quiet on inert devDeps-only drift (the #341 state) → benign, no page', () => {
    const v = evaluateDeployDrift({
      deployedCommit: A,
      mainSha: B,
      changedFiles: ['package.json', 'package-lock.json'],
      runtimeDepsChanged: false,
      diffable: true,
    });
    expect(v.status).toBe('benign');
    expect(v.drifted).toBe(true);
    expect(v.pages).toBe(false);
  });

  it('stays quiet when only tests / docs / CI / monitor scripts changed → benign', () => {
    const v = evaluateDeployDrift({
      deployedCommit: A,
      mainSha: B,
      changedFiles: [
        'tests/unit/scripts/deploy-drift-eval.test.ts',
        'docs/ARCHITECTURE.md',
        '.github/workflows/uptime-monitor.yml',
        'scripts/lib/deploy-drift-eval.mjs',
      ],
      runtimeDepsChanged: false,
      diffable: true,
    });
    expect(v.status).toBe('benign');
    expect(v.pages).toBe(false);
  });

  it('never pages on a pre-stamp or unreachable build: commit "dev" → unknown', () => {
    const v = evaluateDeployDrift({
      deployedCommit: 'dev',
      mainSha: B,
      changedFiles: [],
      runtimeDepsChanged: false,
      diffable: true,
    });
    expect(v.status).toBe('unknown');
    expect(v.drifted).toBe(false);
    expect(v.pages).toBe(false);
  });

  it('never pages when the deployed commit is missing/empty → unknown', () => {
    const v = evaluateDeployDrift({
      deployedCommit: null,
      mainSha: B,
      changedFiles: [],
      runtimeDepsChanged: false,
      diffable: true,
    });
    expect(v.status).toBe('unknown');
    expect(v.pages).toBe(false);
  });

  // When the drift is real but the deployed commit is not in local history we
  // cannot PROVE it benign — surface it rather than hide a possible stale ship.
  it('surfaces an unclassifiable drift (deployed commit not in history) → stale', () => {
    const v = evaluateDeployDrift({
      deployedCommit: A,
      mainSha: B,
      changedFiles: [],
      runtimeDepsChanged: false,
      diffable: false,
    });
    expect(v.status).toBe('stale');
    expect(v.pages).toBe(true);
  });

  it('is case-insensitive and trims the two SHAs before comparing', () => {
    const v = evaluateDeployDrift({
      deployedCommit: `  ${A.toUpperCase()}  `,
      mainSha: A,
      changedFiles: [],
      runtimeDepsChanged: false,
      diffable: true,
    });
    expect(v.status).toBe('in-sync');
    expect(v.drifted).toBe(false);
  });
});
