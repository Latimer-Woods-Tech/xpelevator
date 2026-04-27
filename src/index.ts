import { Hono } from 'hono';
import {
  FactoryBaseError,
  ErrorCodes,
  withErrorBoundary,
  toErrorResponse,
} from '@adrper79-dot/errors';
import { createDb } from '@adrper79-dot/neon';
import { jwtMiddleware } from '@adrper79-dot/auth';
import type { Env } from './env.js';

const app = new Hono<{ Bindings: Env }>();

// ── Middleware ───────────────────────────────────────────────────────────────
app.use('*', withErrorBoundary());

// ── Health check (public) ────────────────────────────────────────────────────
app.get('/health', (c) =>
  c.json({ status: 'ok', worker: c.env.WORKER_NAME, env: c.env.ENVIRONMENT }),
);

// ── Protected routes (require JWT) ──────────────────────────────────────────
app.use('/api/*', (c, next) => jwtMiddleware(c.env.JWT_SECRET)(c, next));

app.get('/api/me', (c) => {
  // c.get('jwtPayload') is set by jwtMiddleware
  return c.json({ data: c.get('jwtPayload'), error: null });
});

// ── Add your routes here ─────────────────────────────────────────────────────
//
// Example: mount the admin panel
// import { createAdminRouter } from '@adrper79-dot/admin';
// app.route('/admin', createAdminRouter({
//   db: createDb(c.env.DB),
//   appId: 'xpelevator',
// }));

// ── Global unhandled error handler ───────────────────────────────────────────
app.onError((err, c) => {
  if (err instanceof FactoryBaseError) {
    return c.json(
      { error: { code: err.code, message: err.message }, data: null },
      err.status as 400 | 401 | 403 | 404 | 500,
    );
  }
  console.error('[unhandled]', err);
  return c.json(
    toErrorResponse(err),
    500,
  );
});

export default app;
