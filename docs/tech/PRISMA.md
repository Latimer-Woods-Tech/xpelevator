# Prisma + Neon Reference — XPElevator

Versions: **Prisma 6.x**, **Neon Postgres** (PostgreSQL 16), **@prisma/client 6.x**

---

## Schema Overview

Location: `prisma/schema.prisma`

```
JobTitle ──< Scenario ──< SimulationSession ──< ChatMessage
    │                            │
    └──< JobCriteria >──┐        └──< Score >── Criteria
                     Criteria
```

### Model Quick Reference

| Model | Table | Key Fields |
|-------|-------|-----------|
| `JobTitle` | `job_titles` | `id`, `name` (unique) |
| `Scenario` | `scenarios` | `id`, `jobTitleId`, `type` (PHONE/CHAT), `script` (Json) |
| `Criteria` | `criteria` | `id`, `name`, `weight` (1-10), `category`, `active` |
| `JobCriteria` | `job_criteria` | `jobTitleId + criteriaId` (unique pair) |
| `SimulationSession` | `simulation_sessions` | `id`, `userId?`, `status`, `type` |
| `ChatMessage` | `chat_messages` | `id`, `sessionId`, `role` (CUSTOMER/AGENT), `content` |
| `Score` | `scores` | `id`, `sessionId`, `criteriaId`, `value` (1-10) |

---

## Prisma Client Singleton

Location: `src/lib/prisma.ts`

```ts
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
});

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;
```

**Why the global**: Next.js dev mode hot-reloads modules, which would create a new `PrismaClient` on every reload and exhaust the Neon connection pool. The global stores one client across reloads.

---

## Common Prisma Queries

### Fetch with Relations

```ts
// Get all job titles with their scenarios
const jobs = await prisma.jobTitle.findMany({
  include: {
    scenarios: true,
    jobCriteria: { include: { criteria: true } }
  }
});

// Get a simulation session with all messages and scores
const session = await prisma.simulationSession.findUnique({
  where: { id: sessionId },
  include: {
    messages: { orderBy: { createdAt: 'asc' } },
    scores: { include: { criteria: true } },
    scenario: true,
    jobTitle: true,
  }
});
```

### Create with Nested

```ts
// Create a session and immediately set it in-progress
const session = await prisma.simulationSession.create({
  data: {
    jobTitleId,
    scenarioId,
    type: 'CHAT',
    status: 'IN_PROGRESS',
    startedAt: new Date(),
    userId: userId ?? null,
  },
  include: { scenario: true, jobTitle: true },
});
```

### Update

```ts
// End a session
await prisma.simulationSession.update({
  where: { id: sessionId },
  data: {
    status: 'COMPLETED',
    endedAt: new Date(),
  }
});
```

### Upsert

```ts
// Ensure a job-criteria link exists without duplicating
await prisma.jobCriteria.upsert({
  where: { jobTitleId_criteriaId: { jobTitleId, criteriaId } },
  create: { jobTitleId, criteriaId },
  update: {},   // no-op — just ensure it exists
});
```

### Delete

```ts
// Cascade: delete session deletes messages and scores (if onDelete: Cascade set)
await prisma.simulationSession.delete({ where: { id: sessionId } });
```

### Aggregates

```ts
// Average score for a session
const result = await prisma.score.aggregate({
  where: { sessionId },
  _avg: { value: true },
  _count: true,
});
const avg = result._avg.value ?? 0;
```

---

## Schema Patterns

### UUID Primary Keys

```prisma
id  String  @id @default(uuid())
```

Postgres `uuid` type generated application-side. No sequence dependency.

### Timestamps

```prisma
createdAt  DateTime  @default(now()) @map("created_at")
updatedAt  DateTime  @updatedAt @map("updated_at")
```

`@updatedAt` auto-updates on every `update()` call.

### Snake_case DB Mapping

Prisma uses camelCase in code, snake_case in DB:
```prisma
model SimulationSession {
  userId     String?   @map("user_id")
  jobTitleId String    @map("job_title_id")
  @@map("simulation_sessions")
}
```

### JSON Field

```prisma
script  Json  @default("{}")
```

TypeScript usage:
```ts
import type { Prisma } from '@prisma/client';

type ScenarioScript = {
  customerPersona: string;
  customerObjective: string;
  difficulty: 'easy' | 'medium' | 'hard';
};

// Reading:
const script = scenario.script as ScenarioScript;

// Writing:
const data: Prisma.ScenarioUpdateInput = {
  script: { customerPersona: '...', customerObjective: '...', difficulty: 'medium' }
};
```

---

## Neon-Specific Notes

### Connection String

Two endpoints:
- **Pooled** (PgBouncer): `ep-*-pooler.region.aws.neon.tech:5432` — use for all app queries
- **Direct**: `ep-*.region.aws.neon.tech:5432` — use for `prisma migrate deploy` only

```
# .env
DATABASE_URL="postgresql://neondb_owner:pwd@ep-xyz-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require"
```

### Cold Starts

Neon free tier suspends after ~5 minutes of inactivity. The first connection attempt will take 2-5 seconds. This is normal — subsequent queries are fast. In the app, handle this with appropriate loading states.

### Branching for Schema Changes

```bash
# 1. Create branch in Neon console or via API
# 2. Get branch connection string
# 3. Set DATABASE_URL to branch string
DATABASE_URL="postgresql://neondb_owner:pwd@ep-BRANCH-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require"

# 4. Push schema changes to branch
npx prisma db push

# 5. Test
# 6. Apply to main branch
DATABASE_URL="..."  # main connection string
npx prisma db push
```

### Direct SQL Access (via Neon MCP)

```
Project ID: aged-butterfly-52244878
Database: neondb
```

Use `mcp_neon_run_sql` for ad-hoc queries during development.

---

## Migrations vs. DB Push

| Command | Use When |
|---------|----------|
| `prisma db push` | Development / prototyping (no migration files) |
| `prisma migrate dev` | When you want tracked migration history |
| `prisma migrate deploy` | Production deployment |
| `prisma db pull` | Reverse-engineer existing DB into schema.prisma |

**Current state**: Using `db push` (no migration history). Switch to `migrate dev` when approaching production.

---

## Prisma Client Tips

### Type Safety for Relations

```ts
import type { Prisma } from '@prisma/client';

// Get the fully-typed result of a query with includes
type SessionWithMessages = Prisma.SimulationSessionGetPayload<{
  include: { messages: true; scores: { include: { criteria: true } } }
}>;
```

### Select vs. Include

```ts
// include: adds related models (JOIN)
prisma.criteria.findMany({ include: { scores: true } });

// select: picks specific fields (reduces payload)
prisma.criteria.findMany({ select: { id: true, name: true, weight: true } });
```

### Transaction

```ts
// Atomic: create messages + close session in one transaction
const [message, session] = await prisma.$transaction([
  prisma.chatMessage.create({ data: { sessionId, role: 'AGENT', content } }),
  prisma.simulationSession.update({ where: { id: sessionId }, data: { status: 'COMPLETED' } }),
]);
```
