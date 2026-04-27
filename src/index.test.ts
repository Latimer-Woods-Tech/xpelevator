import { describe, it, expect } from 'vitest';
import app from './index.js';

describe('xpelevator', () => {
  it('GET /health returns ok', async () => {
    const res = await app.request('/health', {}, {
      ENVIRONMENT: 'test',
      WORKER_NAME: 'xpelevator',
      DB: {} as Hyperdrive,
      JWT_SECRET: 'test-secret',
      SENTRY_DSN: '',
      POSTHOG_KEY: '',
      ANTHROPIC_API_KEY: '',
      GROK_API_KEY: '',
      GROQ_API_KEY: '',
      RESEND_API_KEY: '',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'ok' });
  });
});
