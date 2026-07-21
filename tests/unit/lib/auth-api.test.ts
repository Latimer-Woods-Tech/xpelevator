/**
 * Unit tests for src/lib/auth-api.ts — the shared API auth gate.
 *
 * This module enforces authentication and role checks on every protected
 * /api/* route (Phase 2 security work) plus Telnyx webhook signature
 * verification. It was previously exercised only indirectly through live
 * integration tests (0% deterministic coverage), so a regression in the
 * 401/403 decision logic or the ED25519 replay guard could ship unnoticed.
 *
 * Everything here is deterministic: `@/auth` (NextAuth `auth()`) and `@/lib/db`
 * (`sql`) are mocked, and the webhook tests generate a real ED25519 key pair via
 * Web Crypto so the signature path runs end-to-end without a network or secret.
 *
 * Covered:
 *   requireAuth        — DISABLE_AUTH bypass (+ production guard), 401 when
 *                        unauthenticated, MEMBER default, ADMIN 403 gate,
 *                        orgId/role propagation from the DB row
 *   getAuthOrNull      — null on failure, session on success
 *   withAuth           — passes through on success, maps AuthError → JSON
 *                        status, rethrows non-AuthError
 *   verifyTelnyxWebhook — dev pass-through, missing headers, replay window,
 *                        valid vs. tampered signature
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type AuthUser = {
  id: string;
  email?: string | null;
  name?: string | null;
} | null;

type SqlRows = Array<Record<string, unknown>>;

/**
 * Load a fresh copy of `@/lib/auth-api` with `@/auth` and `@/lib/db` mocked.
 * `authUser` is what `auth()` resolves to; `sqlRows` is what the tagged-template
 * `sql` query resolves to (the users lookup).
 */
async function loadAuthApi(
  opts: { authUser?: AuthUser; sqlRows?: SqlRows; cfEnv?: Record<string, string> } = {}
) {
  const { authUser = null, sqlRows = [], cfEnv } = opts;
  vi.resetModules();
  const authFn = vi.fn().mockResolvedValue(authUser ? { user: authUser } : null);
  const sqlFn = vi.fn(() => Promise.resolve(sqlRows));
  vi.doMock('@/auth', () => ({
    auth: authFn,
    handlers: { GET: vi.fn(), POST: vi.fn() },
    signIn: vi.fn(),
    signOut: vi.fn(),
  }));
  vi.doMock('@/lib/db', () => ({ sql: sqlFn, default: sqlFn }));
  // When cfEnv is provided, stand in for the Cloudflare runtime binding so the
  // Telnyx secret resolver (getTelnyxPublicKey) reads the key from env, not
  // process.env — the production path. Without it, getCloudflareContext throws
  // (as it does in a non-Worker test) and the resolver falls back to process.env.
  if (cfEnv) {
    vi.doMock('@opennextjs/cloudflare', () => ({
      getCloudflareContext: () => ({ env: cfEnv }),
    }));
  }
  const mod = await import('@/lib/auth-api');
  return { mod, authFn, sqlFn };
}

// ── requireAuth ───────────────────────────────────────────────────────────────

describe('requireAuth', () => {
  afterEach(() => {
    delete process.env.DISABLE_AUTH;
    (process.env as Record<string, string>).NODE_ENV = 'test';
    vi.resetModules();
  });

  it('bypasses auth and grants a test ADMIN when DISABLE_AUTH=true outside production', async () => {
    process.env.DISABLE_AUTH = 'true';
    const { mod, authFn } = await loadAuthApi();
    const result = await mod.requireAuth();
    expect(result.session.user.role).toBe('ADMIN');
    expect(result.session.user.id).toBe('test-user-id');
    // Bypass must short-circuit before ever calling the real auth()
    expect(authFn).not.toHaveBeenCalled();
  });

  it('ignores the DISABLE_AUTH backdoor in production and enforces real auth', async () => {
    process.env.DISABLE_AUTH = 'true';
    (process.env as Record<string, string>).NODE_ENV = 'production';
    const { mod } = await loadAuthApi({ authUser: null });
    await expect(mod.requireAuth()).rejects.toMatchObject({ status: 401 });
  });

  it('throws AuthError(401) when there is no authenticated session', async () => {
    const { mod } = await loadAuthApi({ authUser: null });
    await expect(mod.requireAuth()).rejects.toMatchObject({
      name: 'AuthError',
      status: 401,
      message: 'Authentication required',
    });
  });

  it('resolves role + orgId from the DB row for an authenticated user', async () => {
    const { mod } = await loadAuthApi({
      authUser: { id: 'auth-1', email: 'admin@acme.test', name: 'Ada' },
      sqlRows: [{ id: 'db-1', role: 'ADMIN', orgId: 'org-1' }],
    });
    const result = await mod.requireAuth();
    expect(result.session.user).toMatchObject({
      id: 'auth-1',
      role: 'ADMIN',
      orgId: 'org-1',
      dbUserId: 'db-1',
    });
  });

  it('defaults to MEMBER / null org when no DB user row matches', async () => {
    const { mod } = await loadAuthApi({
      authUser: { id: 'auth-2', email: 'nobody@acme.test' },
      sqlRows: [],
    });
    const result = await mod.requireAuth();
    expect(result.session.user.role).toBe('MEMBER');
    expect(result.session.user.orgId).toBeNull();
    expect(result.session.user.dbUserId).toBeUndefined();
  });

  it('skips the DB lookup entirely when the session carries no email', async () => {
    const { mod, sqlFn } = await loadAuthApi({
      authUser: { id: 'auth-3', email: null },
    });
    const result = await mod.requireAuth();
    expect(sqlFn).not.toHaveBeenCalled();
    expect(result.session.user.role).toBe('MEMBER');
  });

  it('throws AuthError(403) when ADMIN is required but the user is a MEMBER', async () => {
    const { mod } = await loadAuthApi({
      authUser: { id: 'auth-4', email: 'member@acme.test' },
      sqlRows: [{ id: 'db-4', role: 'MEMBER', orgId: 'org-1' }],
    });
    await expect(mod.requireAuth(undefined, 'ADMIN')).rejects.toMatchObject({
      status: 403,
      message: 'Admin access required',
    });
  });

  it('allows an ADMIN through the ADMIN-required gate', async () => {
    const { mod } = await loadAuthApi({
      authUser: { id: 'auth-5', email: 'admin@acme.test' },
      sqlRows: [{ id: 'db-5', role: 'ADMIN', orgId: null }],
    });
    const result = await mod.requireAuth(undefined, 'ADMIN');
    expect(result.session.user.role).toBe('ADMIN');
  });
});

// ── getAuthOrNull ─────────────────────────────────────────────────────────────

describe('getAuthOrNull', () => {
  afterEach(() => {
    delete process.env.DISABLE_AUTH;
    vi.resetModules();
  });

  it('returns null when authentication fails', async () => {
    const { mod } = await loadAuthApi({ authUser: null });
    await expect(mod.getAuthOrNull()).resolves.toBeNull();
  });

  it('returns the auth result when authenticated', async () => {
    const { mod } = await loadAuthApi({
      authUser: { id: 'auth-6', email: 'x@acme.test' },
      sqlRows: [{ id: 'db-6', role: 'MEMBER', orgId: 'org-9' }],
    });
    const result = await mod.getAuthOrNull();
    expect(result?.session.user.id).toBe('auth-6');
    expect(result?.session.user.orgId).toBe('org-9');
  });
});

// ── withAuth ──────────────────────────────────────────────────────────────────

describe('withAuth', () => {
  afterEach(() => {
    delete process.env.DISABLE_AUTH;
    vi.resetModules();
  });

  it('invokes the handler and returns its result when authenticated', async () => {
    const { mod } = await loadAuthApi({
      authUser: { id: 'auth-7', email: 'ok@acme.test' },
      sqlRows: [{ id: 'db-7', role: 'MEMBER', orgId: null }],
    });
    const handler = vi.fn(async (_req: Request, auth) => ({
      ok: true,
      caller: auth.session.user.id,
    }));
    const wrapped = mod.withAuth(handler);
    const res = (await wrapped(new Request('http://localhost/api/x'))) as {
      ok: boolean;
      caller: string;
    };
    expect(res).toEqual({ ok: true, caller: 'auth-7' });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('maps an AuthError to a JSON response with the matching status', async () => {
    const { mod } = await loadAuthApi({ authUser: null });
    const handler = vi.fn();
    const wrapped = mod.withAuth(handler);
    const res = (await wrapped(new Request('http://localhost/api/x'))) as Response;
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'Authentication required' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('rethrows a non-AuthError raised inside the handler', async () => {
    const { mod } = await loadAuthApi({
      authUser: { id: 'auth-8', email: 'boom@acme.test' },
      sqlRows: [{ id: 'db-8', role: 'ADMIN', orgId: null }],
    });
    const wrapped = mod.withAuth(async () => {
      throw new Error('handler blew up');
    });
    await expect(wrapped(new Request('http://localhost/api/x'))).rejects.toThrow(
      'handler blew up'
    );
  });
});

// ── verifyTelnyxWebhook ───────────────────────────────────────────────────────

/** Base64-encode raw bytes (no Buffer — Worker-safe path mirrored). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

describe('verifyTelnyxWebhook', () => {
  beforeEach(() => {
    delete process.env.TELNYX_PUBLIC_KEY;
    (process.env as Record<string, string>).NODE_ENV = 'test';
  });
  afterEach(() => {
    delete process.env.TELNYX_PUBLIC_KEY;
    (process.env as Record<string, string>).NODE_ENV = 'test';
    vi.resetModules();
  });

  it('returns true (skips verification) when no public key is configured', async () => {
    const { mod } = await loadAuthApi();
    const ok = await mod.verifyTelnyxWebhook(new Headers(), '{}');
    expect(ok).toBe(true);
  });

  it('fails closed in production when no public key is configured', async () => {
    (process.env as Record<string, string>).NODE_ENV = 'production';
    const { mod } = await loadAuthApi();
    const ok = await mod.verifyTelnyxWebhook(new Headers(), '{}');
    expect(ok).toBe(false);
  });

  it('returns false when signature or timestamp headers are missing', async () => {
    process.env.TELNYX_PUBLIC_KEY = 'AAAA'; // presence is enough to require headers
    const { mod } = await loadAuthApi();
    const ok = await mod.verifyTelnyxWebhook(new Headers(), '{}');
    expect(ok).toBe(false);
  });

  it('rejects a timestamp outside the 5-minute replay window', async () => {
    process.env.TELNYX_PUBLIC_KEY = 'AAAA';
    const { mod } = await loadAuthApi();
    const stale = String(Math.floor(Date.now() / 1000) - 10 * 60); // 10 min old
    const headers = new Headers({
      'telnyx-signature-ed25519': 'sig',
      'telnyx-timestamp': stale,
    });
    const ok = await mod.verifyTelnyxWebhook(headers, '{}');
    expect(ok).toBe(false);
  });

  it('accepts a correctly-signed, fresh webhook and rejects a tampered one', async () => {
    const keyPair = (await crypto.subtle.generateKey(
      { name: 'Ed25519' },
      true,
      ['sign', 'verify']
    )) as CryptoKeyPair;
    const rawPub = new Uint8Array(
      await crypto.subtle.exportKey('raw', keyPair.publicKey)
    );
    process.env.TELNYX_PUBLIC_KEY = bytesToBase64(rawPub);

    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({ event_type: 'call.initiated' });
    const signed = new TextEncoder().encode(`${timestamp}|${body}`);
    const sig = new Uint8Array(
      await crypto.subtle.sign('Ed25519', keyPair.privateKey, signed)
    );

    const { mod } = await loadAuthApi();

    const goodHeaders = new Headers({
      'telnyx-signature-ed25519': bytesToBase64(sig),
      'telnyx-timestamp': timestamp,
    });
    await expect(mod.verifyTelnyxWebhook(goodHeaders, body)).resolves.toBe(true);

    // Tamper with the body → signature no longer matches the payload.
    await expect(
      mod.verifyTelnyxWebhook(goodHeaders, body + ' ')
    ).resolves.toBe(false);
  });

  // Regression: the verifier used to read TELNYX_PUBLIC_KEY from process.env
  // ONLY. In the deployed Worker that returns undefined (secrets live on the
  // CF runtime binding, not process.env — webpack inlines process.env at build
  // time), so in production it fell through to the fail-closed branch and
  // silently rejected EVERY Telnyx webhook — taking the phone modality dark.
  // With the key supplied only via the runtime binding and process.env unset,
  // a correctly-signed webhook must now verify (not fail closed) in production.
  it('sources the signing key from the CF runtime binding when process.env is unset (prod)', async () => {
    (process.env as Record<string, string>).NODE_ENV = 'production';
    delete process.env.TELNYX_PUBLIC_KEY;

    const keyPair = (await crypto.subtle.generateKey(
      { name: 'Ed25519' },
      true,
      ['sign', 'verify']
    )) as CryptoKeyPair;
    const rawPub = new Uint8Array(
      await crypto.subtle.exportKey('raw', keyPair.publicKey)
    );

    // Key present ONLY on the runtime binding (with a stray newline the resolver
    // must trim), never on process.env.
    const { mod } = await loadAuthApi({
      cfEnv: { TELNYX_PUBLIC_KEY: `${bytesToBase64(rawPub)}\n` },
    });

    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({ event_type: 'call.answered' });
    const signed = new TextEncoder().encode(`${timestamp}|${body}`);
    const sig = new Uint8Array(
      await crypto.subtle.sign('Ed25519', keyPair.privateKey, signed)
    );
    const goodHeaders = new Headers({
      'telnyx-signature-ed25519': bytesToBase64(sig),
      'telnyx-timestamp': timestamp,
    });

    await expect(mod.verifyTelnyxWebhook(goodHeaders, body)).resolves.toBe(true);
  });
});
