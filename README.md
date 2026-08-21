# Catch

Command centre for Web3 community managers: analytics across connected
platforms, moderator scheduling and payouts, operations and client reporting.

> **Status:** migrating off Supabase/Vercel to a self-hosted stack on AWS EC2.
> Roadmap and audit: [`AUDIT_AND_MIGRATION_PLAN.md`](./AUDIT_AND_MIGRATION_PLAN.md).
> Baseline of the previous architecture: tag `v0-supabase-baseline`.

## Layout

| Folder | What | Deployable as |
|---|---|---|
| [`frontend/`](./frontend) | React 19 / Vite SPA | static files behind Caddy (`frontend/Dockerfile`) |
| [`backend/`](./backend) | Fastify API + background worker (one codebase, two entrypoints) | `catch-backend` image, run as `api` and `worker` |
| [`deploy/`](./deploy) | Docker Compose (Caddy edge + TLS, frontend, api, worker, PostgreSQL) | one EC2 host; services can be split across hosts |
| [`legacy/`](./legacy) | Supabase migrations/edge functions and Vercel endpoints, kept as reference while porting | not deployed |

Frontend and backend are independent: separate `package.json`, separate
images, no shared build step. The frontend talks to the backend only over HTTP
(`VITE_API_URL`, default `/api`).

## Quick start

```bash
# full stack in containers
cd deploy && cp .env.example .env && docker compose up -d --build
curl -k https://localhost/api/readyz

# or: database in a container, apps on the host
cd deploy && docker compose up -d db
cd ../backend  && cp .env.example .env && npm install && npm run db:migrate && npm run dev:api
cd ../frontend && npm install && npm run dev
```

See each folder's README for details.
