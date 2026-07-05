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
import { sql } from '@/lib/db';

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

    // Credentials provider — looks up user by email in the database.
    // For demo/dev: if no user exists, creates one with MEMBER role.
    // For production: set CREDENTIALS_REQUIRE_EXISTING=true to only allow existing users.
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email', placeholder: 'you@example.com' },
        // Password field included for future bcrypt support
        password: { label: 'Password', type: 'password', placeholder: 'Optional in dev' },
      },
      async authorize(credentials) {
        const email = (credentials?.email as string | undefined)?.trim().toLowerCase();
        if (!email || !email.includes('@')) return null;

        try {
          // Look up existing user
          const existingUsers = await sql`
            SELECT id, email, name, role
            FROM users
            WHERE email = ${email}
            LIMIT 1
          `;
          let user = existingUsers.length > 0 ? {
            id: existingUsers[0].id as string,
            email: existingUsers[0].email as string,
            name: existingUsers[0].name as string | null,
            role: existingUsers[0].role as string,
          } : null;

          // In dev/demo mode, auto-create user if not exists
          if (!user && process.env.CREDENTIALS_REQUIRE_EXISTING !== 'true') {
            const created = await sql`
              INSERT INTO users (id, email, name, role, created_at)
              VALUES (gen_random_uuid(), ${email}, ${email.split('@')[0]}, 'MEMBER', NOW())
              RETURNING id, email, name, role
            `;
            user = created[0] ? {
              id: created[0].id as string,
              email: created[0].email as string,
              name: created[0].name as string | null,
              role: created[0].role as string,
            } : null;
          }

          if (!user) return null;

          // Return user object. `id` becomes `token.sub` in the JWT.
          // Include role for downstream checks.
          return {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
          };
        } catch (err) {
          console.error('[auth] Credentials authorize failed:', err);
          return null;
        }
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
          await sql`
            INSERT INTO users (id, email, name, created_at)
            VALUES (gen_random_uuid(), ${user.email}, ${user.name ?? null}, NOW())
            ON CONFLICT (email)
            DO UPDATE SET name = ${user.name ?? null}
          `;
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
          const users = await sql`
            SELECT id FROM users WHERE email = ${token.email} LIMIT 1
          `;
          if (users.length > 0 && users[0].id) {
            (token as Record<string, unknown>).dbUserId = users[0].id;
          }
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
