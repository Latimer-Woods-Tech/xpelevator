import { defineConfig } from 'prisma/config';

// prisma.config.ts — Prisma 7 project configuration.
//
// Prisma 7 no longer accepts `url` in schema.prisma: the Migrate/CLI connection
// URL lives here. It is read from DATABASE_URL exactly as before (CI's
// migration-integrity job and deploy.yml's `migrate deploy` both set it).
// Prisma 7 also stopped auto-loading `.env`, so the variable must be in the
// process environment — which is already how every caller supplies it.
//
// `process.env` rather than Prisma's `env()` helper on purpose: `env()` throws
// when the variable is unset, and `prisma generate` (run from `postinstall`,
// in every CI job, most of which have no database) needs no URL at all. A
// command that does need one still fails loudly when it tries to connect.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
