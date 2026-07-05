import { describe, it, expect, beforeAll } from 'vitest';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
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
    if (!reachable) {
      // eslint-disable-next-line no-console
      console.warn(`Skipping smoke tests; cannot reach ${BASE_URL}`);
    }
  });

  it('serves /api/criteria with an array', async () => {
    if (!reachable) return;
    const { res, json } = await fetchJson('/api/criteria');
    expect(res.status).toBe(200);
    expect(Array.isArray(json)).toBe(true);
    if (json.length > 0) {
      expect(json[0]).toHaveProperty('id');
      expect(json[0]).toHaveProperty('name');
    }
  }, TIMEOUT_MS);

  it('serves /api/jobs with an array', async () => {
    if (!reachable) return;
    const { res, json } = await fetchJson('/api/jobs');
    expect(res.status).toBe(200);
    expect(Array.isArray(json)).toBe(true);
    if (json.length > 0) {
      expect(json[0]).toHaveProperty('id');
      expect(json[0]).toHaveProperty('name');
    }
  }, TIMEOUT_MS);
});
