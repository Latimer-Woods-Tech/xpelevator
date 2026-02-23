/**
 * API Route Authentication Helpers
 *
 * Provides consistent auth enforcement across all API routes.
 * Uses the NextAuth session to verify authentication and authorization.
 *
 * Usage in route handlers:
 *   const session = await requireAuth(request);              // Any authenticated user
 *   const session = await requireAuth(request, 'ADMIN');     // Admin only
 *   const session = await requireAuth(request, 'MEMBER');    // Member or Admin
 */

import { auth } from '@/auth';
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export type UserRole = 'ADMIN' | 'MEMBER';

export interface AuthResult {
  session: {
    user: {
      id: string;
      email?: string | null;
      name?: string | null;
      dbUserId?: string;
      role?: UserRole;
      orgId?: string | null;
    };
  };
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'AuthError';
  }
}

/**
 * Requires authentication for an API route.
 * Throws AuthError if not authenticated or insufficient permissions.
 *
 * @param _request - The incoming request (for future use with API keys)
 * @param requiredRole - Optional minimum role required ('ADMIN' or 'MEMBER')
 * @returns The authenticated session with user info
 */
export async function requireAuth(
  _request?: Request,
  requiredRole?: UserRole
): Promise<AuthResult> {
  // TESTING MODE: Bypass auth if DISABLE_AUTH is set
  if (process.env.DISABLE_AUTH === 'true') {
    return {
      session: {
        user: {
          id: 'test-user-id',
          email: 'test@example.com',
          name: 'Test User',
          dbUserId: undefined,
          role: 'ADMIN', // Grant admin access in test mode
          orgId: null,
        },
      },
    };
  }

  const session = await auth();

  if (!session?.user?.id) {
    throw new AuthError('Authentication required', 401);
  }

  // Look up the actual user in the database to get role and org
  let dbUser: { id: string; role: string; orgId: string | null } | null = null;

  if (session.user.email) {
    dbUser = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, role: true, orgId: true },
    });
  }

  const userRole = (dbUser?.role as UserRole) ?? 'MEMBER';
  const orgId = dbUser?.orgId ?? null;

  // Check role requirement
  if (requiredRole === 'ADMIN' && userRole !== 'ADMIN') {
    throw new AuthError('Admin access required', 403);
  }

  return {
    session: {
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        dbUserId: dbUser?.id,
        role: userRole,
        orgId,
      },
    },
  };
}

/**
 * Wraps an API handler with authentication.
 * Returns a 401/403 JSON response on auth failure.
 */
export function withAuth<T>(
  handler: (request: Request, auth: AuthResult) => Promise<T>,
  requiredRole?: UserRole
) {
  return async (request: Request): Promise<T | NextResponse> => {
    try {
      const authResult = await requireAuth(request, requiredRole);
      return await handler(request, authResult);
    } catch (error) {
      if (error instanceof AuthError) {
        return NextResponse.json(
          { error: error.message },
          { status: error.status }
        );
      }
      throw error;
    }
  };
}

/**
 * Safe auth check that doesn't throw — returns null if not authenticated.
 * Useful for routes that have different behavior for authed vs anonymous users.
 */
export async function getAuthOrNull(): Promise<AuthResult | null> {
  try {
    return await requireAuth();
  } catch {
    return null;
  }
}

/**
 * Verify webhook signature from Telnyx.
 * Returns true if signature is valid or verification is disabled.
 *
 * Telnyx signs webhooks with ED25519. The signature is in the
 * `telnyx-signature-ed25519` header, and the timestamp in `telnyx-timestamp`.
 */
export async function verifyTelnyxWebhook(
  headers: Headers,
  body: string
): Promise<boolean> {
  const publicKey = process.env.TELNYX_PUBLIC_KEY;

  // If no public key configured, skip verification (dev mode)
  if (!publicKey) {
    if (process.env.NODE_ENV === 'production') {
      console.warn('[Telnyx] TELNYX_PUBLIC_KEY not set — webhook verification disabled in production!');
    }
    return true;
  }

  const signature = headers.get('telnyx-signature-ed25519');
  const timestamp = headers.get('telnyx-timestamp');

  if (!signature || !timestamp) {
    console.warn('[Telnyx] Missing signature headers');
    return false;
  }

  // Verify timestamp is within 5 minutes to prevent replay attacks
  const timestampMs = parseInt(timestamp, 10) * 1000;
  const now = Date.now();
  if (Math.abs(now - timestampMs) > 5 * 60 * 1000) {
    console.warn('[Telnyx] Timestamp too old or in future');
    return false;
  }

  // Construct signed payload: timestamp + | + body
  const signedPayload = `${timestamp}|${body}`;

  try {
    // Use Web Crypto API for ED25519 verification (works in Edge runtime)
    const keyData = hexToBytes(publicKey);
    const key = await crypto.subtle.importKey(
      'raw',
      keyData.buffer as ArrayBuffer,
      { name: 'Ed25519' },
      false,
      ['verify']
    );

    const signatureBytes = hexToBytes(signature);
    const payloadBytes = new TextEncoder().encode(signedPayload);

    const valid = await crypto.subtle.verify(
      'Ed25519',
      key,
      signatureBytes.buffer as ArrayBuffer,
      payloadBytes
    );

    if (!valid) {
      console.warn('[Telnyx] Invalid webhook signature');
    }

    return valid;
  } catch (error) {
    console.error('[Telnyx] Signature verification error:', error);
    return false;
  }
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
