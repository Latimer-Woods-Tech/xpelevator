# Next.js Reference — XPElevator

Version: **Next.js 16** with App Router, TypeScript, Turbopack.

---

## App Router Fundamentals

### Server vs. Client Components

| Feature | Server Component | Client Component |
|---------|-----------------|-----------------|
| Default | ✅ Yes | ❌ No |
| `'use client'` directive | Not needed | Required at top |
| Browser APIs (window, localStorage) | ❌ | ✅ |
| React hooks (useState, useEffect) | ❌ | ✅ |
| Direct DB/Prisma access | ✅ | ❌ |
| Fetch at render time | ✅ (no roundtrip) | Via API routes |
| Bundle size contribution | 0 JS to client | Adds to bundle |

**Rule**: Default to server components. Add `'use client'` only when you need hooks or browser APIs.

```tsx
// ✅ Server Component — can call Prisma directly
import prisma from '@/lib/prisma';

export default async function JobsPage() {
  const jobs = await prisma.jobTitle.findMany();
  return <ul>{jobs.map(j => <li key={j.id}>{j.name}</li>)}</ul>;
}
```

```tsx
// ✅ Client Component — needs useState
'use client';
import { useState } from 'react';

export default function SearchBox() {
  const [query, setQuery] = useState('');
  return <input value={query} onChange={e => setQuery(e.target.value)} />;
}
```

---

## File-based Routing

```
src/app/
├── page.tsx                  → /
├── layout.tsx                → Root layout (wraps all pages)
├── loading.tsx               → Automatic loading UI
├── error.tsx                 → Error boundary UI ('use client' required)
├── not-found.tsx             → 404 page
├── simulate/
│   ├── page.tsx              → /simulate
│   └── [sessionId]/
│       └── page.tsx          → /simulate/abc-123
└── api/
    ├── jobs/
    │   └── route.ts          → GET/POST /api/jobs
    └── criteria/
        ├── route.ts          → GET/POST /api/criteria
        └── [id]/
            └── route.ts      → PUT/DELETE /api/criteria/[id]
```

### Adding a Loading UI

Create `loading.tsx` next to `page.tsx` — Next.js shows it automatically via React Suspense:
```tsx
// src/app/simulate/loading.tsx
export default function Loading() {
  return <div className="animate-pulse text-slate-400 p-12">Loading...</div>;
}
```

### Adding an Error Boundary

```tsx
// src/app/error.tsx
'use client';
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div>
      <p>Something went wrong: {error.message}</p>
      <button onClick={reset}>Try again</button>
    </div>
  );
}
```

---

## API Route Handlers

### Basic Pattern

```ts
// src/app/api/resource/route.ts
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  return NextResponse.json({ data: [] });
}

export async function POST(request: Request) {
  const body = await request.json();
  return NextResponse.json({ created: true }, { status: 201 });
}
```

### Dynamic Route with Params

```ts
// src/app/api/resource/[id]/route.ts
// IMPORTANT: params is a Promise in Next.js 15+
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;   // ← must await
  const body = await request.json();
  // ...
}
```

### Streaming Response (SSE for AI chat)

```ts
export async function GET(request: Request) {
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  const encoder = new TextEncoder();

  // Write SSE events
  const send = (data: string) =>
    writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

  // Start async work
  (async () => {
    for await (const chunk of aiStream) {
      await send(chunk);
    }
    await writer.close();
  })();

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
```

> **Cloudflare Workers**: For SSE/streaming to work on Cloudflare, the route must use the Edge runtime:
> ```ts
> export const runtime = 'edge';
> ```

---

## Navigation

```tsx
// Programmatic navigation in client components
'use client';
import { useRouter } from 'next/navigation';

const router = useRouter();
router.push('/simulate/abc-123');
router.replace('/');    // no back-stack entry
```

```tsx
// Link component (server or client)
import Link from 'next/link';
<Link href="/simulate">Start</Link>
```

---

## Data Fetching Patterns in This Project

### Pattern 1: Server Component (best for static/admin data)

```tsx
// No fetch() needed — Prisma runs server-side
import prisma from '@/lib/prisma';

export default async function AdminPage() {
  const criteria = await prisma.criteria.findMany({ orderBy: { name: 'asc' } });
  return <CriteriaTable data={criteria} />;
}
```

### Pattern 2: Client Component + useEffect (current pattern in admin/sessions)

```tsx
'use client';
const [data, setData] = useState([]);
const [loading, setLoading] = useState(true);
const [error, setError] = useState<string | null>(null);

useEffect(() => {
  fetch('/api/criteria')
    .then(res => {
      if (!res.ok) throw new Error('Failed to load');
      return res.json();
    })
    .then(setData)
    .catch(err => setError(err.message))
    .finally(() => setLoading(false));
}, []);
```

### Pattern 3: Server Actions (future refactor)

```tsx
// src/app/admin/actions.ts
'use server';
import prisma from '@/lib/prisma';

export async function createCriteria(data: { name: string; weight: number }) {
  return prisma.criteria.create({ data });
}
```

---

## next.config.ts

```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  turbopack: {
    root: '.',    // Prevents "multiple lockfiles" warning
  },
  // For Cloudflare Edge deployment (Phase 5):
  // output: 'export',   // only for static export
};

export default nextConfig;
```

---

## TypeScript Path Aliases

Configured in `tsconfig.json`:
```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

Usage:
```ts
import prisma from '@/lib/prisma';      // → src/lib/prisma.ts
import type { Criteria } from '@/types'; // → src/types/index.ts
```

---

## Key Next.js 16 / App Router Tips

1. **No `getServerSideProps`** — use `async` server components or server actions
2. **`cookies()` and `headers()`** are async in Next.js 15+: `await cookies()`
3. **`params` in route handlers** are `Promise` — always `await params`
4. **Middleware** lives at `src/middleware.ts` — runs on every request, use for auth checks
5. **`use cache`** directive (experimental in Next 15+) for fine-grained caching
6. **Images**: use `next/image` for automatic optimization
