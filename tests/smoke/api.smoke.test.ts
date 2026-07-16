import { describe, it, expect, beforeAll } from 'vitest';

/** A usable smoke target is an absolute http(s) URL; anything else (unset, '',
 * a bare '/') is not a real deployment and means "no target configured". */
function isRealTarget(v: string | undefined): v is string {
  if (!v) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// The target comes from SMOKE_BASE_URL, NOT BASE_URL: Vite forces
// process.env.BASE_URL to its `base` ('/') under vitest, so BASE_URL can never
// carry a real deploy URL here. When a real target is set, an unreachable
// target is a hard failure (the deploy is down); with none, the suite skips
// visibly instead of passing vacuously.
const EXPLICIT_TARGET = isRealTarget(process.env.SMOKE_BASE_URL);
const BASE_URL = EXPLICIT_TARGET ? process.env.SMOKE_BASE_URL! : 'http://localhost:3000';
const TIMEOUT_MS = 15_000;

async function fetchJson(path: string) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}${path}`, { signal: controller.signal });
    const json = await res.json().catch(() => null);
    return { res, json } as const;
  } finally {
    clearTimeout(t);
  }
}

describe('Smoke: live API', () => {
  let reachable = true;

  beforeAll(async () => {
    try {
      const { res } = await fetchJson('/api/health');
      reachable = res.ok;
    } catch {
      reachable = false;
    }
    // An explicitly-targeted-but-unreachable host is a hard failure — silently
    // passing here is exactly the vacuous-green bug smoke tests must not have.
    if (!reachable && EXPLICIT_TARGET) {
      throw new Error(`Smoke target ${BASE_URL} is unreachable — /api/health did not return ok`);
    }
  });

  it('serves /api/criteria with an array', async (ctx) => {
    if (!reachable) ctx.skip();
    const { res, json } = await fetchJson('/api/criteria');
    expect(res.status).toBe(200);
    expect(Array.isArray(json)).toBe(true);
    if (json.length > 0) {
      expect(json[0]).toHaveProperty('id');
      expect(json[0]).toHaveProperty('name');
    }
  }, TIMEOUT_MS);

  it('serves /api/jobs with an array', async (ctx) => {
    if (!reachable) ctx.skip();
    const { res, json } = await fetchJson('/api/jobs');
    expect(res.status).toBe(200);
    expect(Array.isArray(json)).toBe(true);
    if (json.length > 0) {
      expect(json[0]).toHaveProperty('id');
      expect(json[0]).toHaveProperty('name');
    }
  }, TIMEOUT_MS);
});
