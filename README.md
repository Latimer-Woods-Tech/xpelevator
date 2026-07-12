# XPElevator

Virtual-customer training simulator. Trainees pick a job title and a scenario,
run a simulated customer conversation (chat, browser voice, or a real phone
call), and get scored out of 10 against weighted, per-role criteria. The buyer
is the training **operator** — a consultancy or L&D shop that resells practice
seats to its own clients. See [`docs/VISION.md`](./docs/VISION.md).

## Tech Stack

- **Frontend**: Next.js 15 (App Router, TypeScript, React 19, Tailwind CSS v4)
- **Database**: Neon Postgres (queried over the serverless HTTP driver);
  Prisma owns the schema and migrations
- **Simulated customers & scoring**: Groq (Llama 3.1 / 3.3)
- **Voice / phone**: browser Web Speech API, and Telnyx Call Control for real
  phone calls
- **Hosting**: Cloudflare Workers via `@opennextjs/cloudflare` (Pages project
  `xpelevator-sim`)
- **Auth**: Auth.js (NextAuth v5), JWT sessions
- **Domain**: xpelevator.com

## Getting Started

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Set up environment variables** — copy `.env.example` to `.env` and fill in
   at least the required three (`DATABASE_URL`, `AUTH_SECRET`, `GROQ_API_KEY`).
   The file documents the optional voice/phone and auth variables.

3. **Generate the Prisma client**:
   ```bash
   npx prisma generate
   ```

4. **Run the dev server**:
   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000)

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (must be zero errors) |
| `npm run test:unit` | Deterministic unit tests (mocked) |
| `npm run test:ui` | React component render tests |
| `npm run test:coverage:ci` | Coverage gate over `src/lib` |
| `npm run deploy` | Build with OpenNext + deploy to Cloudflare |

## Project Structure

```
src/
├── app/
│   ├── page.tsx                    # Landing page
│   ├── simulate/                   # Job/scenario picker + active session UI
│   ├── sessions/                   # Past sessions + detail w/ score breakdown
│   ├── analytics/                  # Score trends + scoring-health dashboard
│   ├── admin/                      # Criteria / jobs / scenarios / links CRUD
│   ├── pricing/                    # Operator-facing seat catalog
│   └── api/                        # Route handlers (raw SQL over Neon HTTP)
├── lib/                            # Pure, unit-tested helpers (ai, scoring,
│                                   #   tenant guards, limits, csv/pdf, telnyx…)
prisma/
└── schema.prisma                   # 9 models, 5 enums
docs/
├── VISION.md                       # North star (buyer, monetization, kill-signals)
├── ARCHITECTURE.md                 # C4 diagrams, schema, key flows
└── IMPROVEMENT_PLAN.md             # Phased engineering roadmap
```

## Database

9 models / 5 enums (`prisma/schema.prisma`). Core tables: `organizations`,
`users`, `job_titles`, `scenarios`, `criteria`, `job_criteria`,
`simulation_sessions`, `chat_messages`, `scores`.

Prisma owns the schema and migrations; the application code queries Neon
directly with parameterized raw SQL (the Prisma client is not used on the
Cloudflare Workers runtime — see `docs/LESSONS_LEARNED.md`).

## Deployment

Built with `@opennextjs/cloudflare` and deployed to the Cloudflare Pages
project `xpelevator-sim`, served at [xpelevator.com](https://xpelevator.com).
CI (`.github/workflows/ci.yml`) gates typecheck, lint, tests, and coverage;
the deploy workflow re-runs those checks, migrates the Neon DB, then deploys
and self-verifies (`/api/health`, auth gates, tenant isolation, security
headers).

## License

Private project.
