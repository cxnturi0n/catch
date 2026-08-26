# Catch backend

Fastify API + background worker sharing one codebase and one Docker image.

```
src/
  api.ts        HTTP entrypoint (npm run start:api)
  worker.ts     background jobs entrypoint (npm run start:worker), pg-boss scheduler
  app.ts        Fastify instance: plugins, error envelope, routes
  config.ts     env validation (Zod), the only place process.env is read
  logger.ts     pino, redacts secrets
  auth/         Better Auth instance (email+password, OAuth, 2FA) + security audit log
  email/        transactional email (Resend; logged to an in-memory outbox when unset)
  plugins/      Fastify plugins: session resolution + requireSession guards
  db/           Drizzle client, schema (auth + app), migration runner
  lib/          crypto (secrets at rest), quota (plan limits), typed errors
  modules/      one folder per domain: routes.ts (Zod schemas) · service.ts · repo.ts
  routes/       cross-cutting routes (health, /auth/*, /me, /files, /webhooks)
  integrations/ platform clients (Discord, Telegram, Galxe, Zealy) shared by API and worker
  jobs/         scheduler + job functions (sync tick, Discord activity/members, Telegram updates, retention)
scripts/        seed-demo.ts (never part of migrations)
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

## Authorization model

- `requireSession` / `requireVerifiedEmail`, authenticated user.
- `requireWorkspace`, loads `/workspaces/:workspaceId` **and** the caller's
  membership in one query; non-members receive 404 so ids cannot be probed.
  `requireWorkspaceRole(['owner','admin'])` adds a role check.
- `requireAdmin`, `user.role = 'admin'` (database column; no hard-coded emails).
- Plan quotas (`lib/quota.ts`) are enforced in services inside a transaction
  with an advisory lock; the SPA only displays them.
- Third-party secrets (`integrations.credentials_enc`, report webhook/token)
  are AES-256-GCM encrypted with `CREDENTIALS_ENCRYPTION_KEYS`; repositories
  expose them only through server-side functions and never through a route
  response schema.
- Tables that carry a `moderator_id` use a composite FK `(workspace_id,
  moderator_id)` so a moderator can only be attached to its own workspace.

## Background worker

`npm run dev:worker` / `node dist/worker.js`. pg-boss (schema `pgboss`) on the same
PostgreSQL, no Redis.

| Queue | When | What |
|---|---|---|
| `sync-tick` | every minute | enqueues due `(workspace, platform)` jobs: Discord/Telegram floor 60 s, Galxe/Zealy 300 s, throttled on last *attempt*, deterministic jitter ≤45 s per workspace, singleton key per pair |
| `sync-platform` | on demand | member counts etc. → `platform_metrics` daily rollup + snapshot on change (30-min heartbeat) |
| `discord-activity` | every minute, only while the gateway is not live | REST fallback: per-channel cursor message reading through the shared ingest |
| `discord-members` | every 20 h | full member list → tenure + membership snapshot; missing intent recorded in `integration_sync_state` |
| `discord-backfill` | after connect, or `POST /integrations/discord/backfill` | 30 day history of text channels and threads (50k cap) + audit log → messages, counters, moderator actions; progress in `integrations.metadata.backfill` |
| `telegram-backfill` | after connect (public groups, MTProto configured) | 30 day history through the MTProto client → same ingest |
| `shift-events` | 00:10 UTC | punctuality per scheduled moderator |
| `response-metrics` | 00:20 UTC | first moderator answer within 60 min per channel → `moderator_response_metrics` |
| `retention` | 03:00 UTC | snapshots > 30 d, stored message text > 30 d, security events > 365 d, Telegram dedup > 7 d, AI chats > 30 d |

Discord gateway (not a queue): `integrations/discord/gatewayManager.ts` runs
inside the worker process, one websocket per connected Discord workspace,
guarded by a Postgres advisory lock per workspace so a second worker owns
nothing. Messages, channels, joins/leaves and audit log entries arrive live;
state lives in `discord_gateway_state` (also shown on the Integrations card).
Every collector writes through `jobs/ingest.ts`: a message is stored once
(`platform_messages`, text encrypted, pruned after 30 days) and the counters
only move when the row was new, so overlapping sources never double count.

Live updates: every writer calls `publish(workspaceId, topic)` (Postgres
`NOTIFY`); the API listens and fans out over `GET /workspaces/:id/events`
(Server-Sent Events, topics named after the tables that changed). The SPA
refetches on `change` and keeps polling as a floor.

Telegram is push: connect registers `POST /webhooks/telegram/<integration id>`
with a per-integration secret (only its hash is stored); the route is
idempotent on `update_id` and handles messages, join/leave transitions, admin
actions (bans, mutes) and the bot being removed or re-added. The legacy
`POST /webhooks/telegram` (global `TELEGRAM_WEBHOOK_SECRET`) still works for
bots registered by hand.
