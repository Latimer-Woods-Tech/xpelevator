/**
 * Auth.js (NextAuth v5) configuration.
 *
 * Providers:
 *   - GitHub OAuth  (set AUTH_GITHUB_ID + AUTH_GITHUB_SECRET in .env)
 *   - Credentials   (username-only, for local dev / demo use)
 *
 * Session strategy: JWT (no DB needed for session storage)
 *
 * Setup:
 *   1. Generate a secret:  openssl rand -base64 32
 *   2. Add to .env:
 *        AUTH_SECRET="<generated>"
 *        AUTH_GITHUB_ID="<your GitHub OAuth app ID>"
 *        AUTH_GITHUB_SECRET="<your GitHub OAuth app secret>"
 *   3. In your GitHub OAuth app, set the callback URL to:
 *        http://localhost:3000/api/auth/callback/github  (dev)
 *        https://<your-domain>/api/auth/callback/github (prod)
 */
import NextAuth, { type DefaultSession } from 'next-auth';
import GitHub from 'next-auth/providers/github';
import Credentials from 'next-auth/providers/credentials';
import prisma from '@/lib/prisma';

// Extend the Session type to include the user.id and optional dbUserId fields
declare module 'next-auth' {
  interface Session {
    user: { id: string; dbUserId?: string } & DefaultSession['user'];
  }
}

// Only include GitHub provider when credentials are configured.
// Without this guard, NextAuth v5 throws "server configuration" errors at
// runtime whenever AUTH_GITHUB_ID / AUTH_GITHUB_SECRET are not set, which
// breaks /api/auth/session and cascades to all useSession() calls in the UI.
const githubProvider =
  process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET ? [GitHub] : [];

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    ...githubProvider,

    // Simple credentials provider — accepts any non-empty username.
    // Replace with real user lookup + bcrypt verification for production.
    Credentials({
      credentials: {
        username: { label: 'Username', type: 'text', placeholder: 'Your name' },
      },
      authorize(credentials) {
        const name = (credentials?.username as string | undefined)?.trim();
        if (!name) return null;
        // Return a minimal user object. `id` becomes `token.sub` in the JWT.
        return { id: name, name, email: null };
      },
    }),
  ],

  pages: {
    signIn: '/auth/signin',
  },

  callbacks: {
    // Upsert a DB User row for OAuth sign-ins (Credentials have no email — skip).
    // This populates the users table so dbUserId FK can be set on sessions.
    async signIn({ user, account }) {
      if (account?.provider !== 'credentials' && user.email) {
        try {
          await prisma.user.upsert({
            where: { email: user.email },
            update: { name: user.name ?? undefined },
            create: { email: user.email, name: user.name ?? null },
          });
        } catch (err) {
          // Non-fatal: log and continue sign-in
          console.warn('[auth] User upsert failed:', err);
        }
      }
      return true;
    },

    // Cache the DB User id in the JWT on first sign-in so we avoid a DB
    // lookup on every subsequent request.
    async jwt({ token, account }) {
      if (account && token.email) {
        try {
          const dbUser = await prisma.user.findUnique({ where: { email: token.email } });
          if (dbUser) (token as Record<string, unknown>).dbUserId = dbUser.id;
        } catch {
          // Non-fatal
        }
      }
      return token;
    },

    // Expose user.id (NextAuth sub) and user.dbUserId on the session object.
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      const dbUserId = (token as Record<string, unknown>).dbUserId;
      if (typeof dbUserId === 'string') session.user.dbUserId = dbUserId;
      return session;
    },
  },
});
