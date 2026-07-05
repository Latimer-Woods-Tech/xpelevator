# XPElevator - Copilot Instructions

## Project Overview
XPElevator is a virtual customer simulator for training employees on customer interactions.

## Tech Stack
- Next.js 16 (App Router, TypeScript, Tailwind CSS)
- Prisma ORM with Neon Postgres
- Cloudflare Pages + Workers for deployment
- Telnyx for voice simulations
- Groq/Grok for AI-powered virtual customers

## Key Conventions
- Use App Router patterns (server components by default, `'use client'` only when needed)
- API routes in `src/app/api/` with Next.js route handlers
- Prisma client singleton in `src/lib/prisma.ts`
- Database schema in `prisma/schema.prisma`
- Environment variables in `.env` (never commit secrets)

## Database
- Neon project ID: `aged-butterfly-52244878`
- 7 tables: job_titles, scenarios, criteria, job_criteria, simulation_sessions, chat_messages, scores
- 3 enums: SimulationType, SessionStatus, MessageRole

## Architecture
- See `docs/ARCHITECTURE.md` for C4 diagrams and detailed flows