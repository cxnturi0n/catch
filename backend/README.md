# Catch backend

Fastify API + background worker sharing one codebase and one Docker image.

```
src/
  api.ts        HTTP entrypoint (npm run start:api)
  worker.ts     background jobs entrypoint (npm run start:worker)
  app.ts        Fastify instance: plugins, error envelope, routes
  config.ts     env validation (Zod) — the only place process.env is read
  logger.ts     pino, redacts secrets
  db/           Drizzle client, schema, migration runner
  routes/       HTTP routes
drizzle/        generated SQL migrations (npm run db:generate)
```

## Local development

```bash
cp .env.example .env
docker compose -f ../deploy/docker-compose.yml up -d db   # Postgres only
npm install
npm run db:migrate
npm run dev:api       # http://localhost:3000/healthz
npm run dev:worker
```

## Build / run in containers

See `../deploy/docker-compose.yml`. Migrations run in a one-shot `migrate`
service before `api` and `worker` start.
