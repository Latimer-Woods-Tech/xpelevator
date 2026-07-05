# XPElevator

Virtual customer simulator for training employees on customer interactions. Employees select a job title, triggering phone or chat simulations with AI-powered virtual customers, then receive scoring on updatable criteria.

## Tech Stack

- **Frontend**: Next.js 16 (App Router, TypeScript, Tailwind CSS)
- **Database**: Neon Postgres with Prisma ORM
- **AI**: Groq / Grok for virtual customer responses
- **Voice**: Telnyx for phone simulations
- **Hosting**: Cloudflare Pages + Workers
- **Domain**: xpelevator.com

## Getting Started

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Set up environment variables** — copy `.env.example` to `.env` and fill in:
   - `DATABASE_URL` — Neon Postgres connection string
   - `CLOUDFLARE_API_TOKEN`
   - `TELNYX_API_KEY`
   - `GROQ_API_KEY` / `GROK_API_KEY`

3. **Generate Prisma client**:
   ```bash
   npx prisma generate
   ```

4. **Run the dev server**:
   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000)

## Project Structure

```
src/
├── app/
│   ├── page.tsx              # Landing page
│   ├── simulate/page.tsx     # Job title selector + scenario cards
│   ├── admin/page.tsx        # CRUD admin for scoring criteria
│   ├── sessions/page.tsx     # Past simulation sessions
│   └── api/
│       ├── jobs/             # Job titles API
│       ├── criteria/         # Scoring criteria API
│       ├── simulations/      # Simulation sessions API
│       └── scoring/          # Score submission API
├── lib/
│   └── prisma.ts             # Prisma client singleton
prisma/
└── schema.prisma             # Database schema (7 models, 3 enums)
docs/
└── ARCHITECTURE.md           # C4 diagrams, schema docs, key flows
```

## Database

7 tables: `job_titles`, `scenarios`, `criteria`, `job_criteria`, `simulation_sessions`, `chat_messages`, `scores`

Managed via Prisma ORM pointing to Neon Postgres (project: `aged-butterfly-52244878`).

## Deployment

Deployed to Cloudflare Pages at [xpelevator.com](https://xpelevator.com).

## License

Private project.

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
