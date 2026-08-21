# Catch backend

Fastify API + background worker sharing one codebase and one Docker image.

```
src/
  api.ts        HTTP entrypoint (npm run start:api)
  worker.ts     background jobs entrypoint (npm run start:worker)
  app.ts        Fastify instance: plugins, error envelope, routes
  config.ts     env validation (Zod) — the only place process.env is read
  logger.ts     pino, redacts secrets
  auth/         Better Auth instance (email+password, OAuth, 2FA) + security audit log
  email/        transactional email (Resend; logged to an in-memory outbox when unset)
  plugins/      Fastify plugins: session resolution + requireSession guards
  db/           Drizzle client, schema, migration runner
  routes/       HTTP routes (health, /auth/*, /me)
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

## Authentication

Better Auth mounted at `/auth/*` (public URL `API_URL + /auth`). Configured flows:

| Flow | Endpoint(s) |
|---|---|
| Sign up / sign in (email + password, verified email required) | `POST /auth/sign-up/email`, `POST /auth/sign-in/email` |
| Email verification, password reset, change email, delete account | `/auth/verify-email`, `/auth/request-password-reset`, `/auth/reset-password`, `/auth/change-email`, `/auth/delete-user` |
| OAuth (Google, Discord; Facebook and X when credentials are set) | `POST /auth/sign-in/social`, `POST /auth/link-social`, `POST /auth/unlink-account` |
| Two-factor (TOTP + 10 backup codes, lockout after repeated failures) | `/auth/two-factor/enable`, `/verify-totp`, `/verify-backup-code`, `/generate-backup-codes`, `/disable` |
| Sessions (30 days, DB-backed, revocable) | `GET /auth/get-session`, `GET /auth/list-sessions`, `POST /auth/revoke-session`, `/revoke-other-sessions`, `/sign-out` |
| Enabled providers for the SPA | `GET /auth-providers` |
| Current user | `GET /me` (requires a complete session; a pending-2FA session is rejected) |

Rules: a provider is active only when both `*_CLIENT_ID` and `*_CLIENT_SECRET`
are set; implicit linking on sign-in only for trusted providers asserting a
verified email onto a locally verified user; explicit linking from settings may
attach a provider with a different/no email (X); unlinking the last method is
refused; sensitive actions need a session fresher than 10 minutes.
`security_events` records logins, logouts, password/email/MFA changes, linking
and session revocations.

## Tests

`npm test` runs against the database in `DATABASE_URL` (start it with
`docker compose -f ../deploy/docker-compose.yml up -d db` and run
`npm run db:migrate` once). Emails are captured in memory, never sent.
