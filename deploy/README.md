# Deploy

One host, two isolated stacks behind one shared edge:

| | production | staging |
|---|---|---|
| URL | `https://catch-labs.com` | `https://staging.catch-labs.com` |
| dir | `/opt/catch` | `/opt/catch-staging` |
| compose project (`STACK`) | `catch` | `catch-staging` |
| Postgres (loopback) | `:5432` | `:5433` |
| `APP_ENV` | `production` | `staging` (demo seed allowed, banner, `noindex`) |
| deploy | manual, approved | auto on push to `develop` |

`docker-compose.edge.yml` (Caddy, TLS, ports 80/443) runs once, from the
production checkout, and routes each hostname to `<STACK>-api` /
`<STACK>-frontend` over the `catch-edge` network. `docker-compose.yml` is the
application stack (frontend, api, worker, migrate, db) and is started once per
`.env`. Cloudflare proxies both hostnames: the edge trusts `CF-Connecting-IP`
only from Cloudflare ranges and forwards it as `X-Forwarded-For`.

```bash
cp .env.example .env && chmod 600 .env          # fill in values
docker compose -f docker-compose.edge.yml up -d  # creates the catch-edge network
docker compose up -d --build
curl -k https://localhost/api/readyz
```

Frontend and backend are separate images and can be moved to different hosts:
point the edge Caddy `reverse_proxy` targets at the other host and set
`APP_URL` / `VITE_API_URL` accordingly.

Local dev without containers for app code: `docker compose up -d db`, then run
`npm run dev` in `frontend/` and `npm run dev:api` in `backend/`.

## Server setup and deploys

```bash
ssh admin@HOST 'sudo bash -s' < deploy/bootstrap.sh          # once: docker, firewall, hardening
ssh admin@HOST 'bash -s catch-labs.com' < deploy/server-env.sh               # once: /opt/catch/deploy/.env
ssh admin@HOST 'bash -s staging.catch-labs.com staging' < deploy/server-env.sh # once: /opt/catch-staging/deploy/.env
# then set STAGING_ADDRESS=staging.catch-labs.com in /opt/catch/deploy/.env (edge)
deploy/deploy.sh admin@HOST key.pem                              # production (also restarts the edge)
DEPLOY_DIR=/opt/catch-staging deploy/deploy.sh admin@HOST key.pem # staging
```

Demo data on staging only: `docker compose exec api node --import tsx
scripts/seed-demo.ts` is refused when `APP_ENV=production`.

GitHub Actions: `CI` runs typecheck, tests (real Postgres), lint and image
builds on every push/PR. `Deploy` deploys to **staging** on every push to
`develop` and on manual runs; choose `environment=production` in the manual
run to ship to production (the `production` GitHub Environment can require a
reviewer). Secrets `DEPLOY_SSH_KEY` (private key of a dedicated ed25519 key
whose public half is in `~admin/.ssh/authorized_keys`) and `DEPLOY_HOST` live
at repository level; per-environment variables `DEPLOY_DIR` / `SITE_URL` are
optional (defaults above). Rollback = run Deploy with the previous commit SHA.

## Monitoring

- `deploy/watchdog.sh` (installed by `install-watchdog.sh`, cron every 5 min,
  root): checks `https://$SITE_ADDRESS/api/readyz` (and the staging host when
  `STAGING_ADDRESS` is set), disk ≥85 %, memory <150 MB, stopped containers,
  the shared edge; restarts api/worker or `compose up -d` when
  needed; e-mails `ALERT_TO` (fallback `DISCOVERY_NOTIFY_TO`) through Resend,
  once per condition and again when it clears. Logs to syslog
  (`journalctl -t catch-watchdog`).
- Error tracking: set `SENTRY_DSN` (api + worker) and build the frontend with
  `VITE_SENTRY_DSN`; both are no-ops when unset.
- Recommended external check: a free uptime monitor (e.g. UptimeRobot) on
  `https://catch-labs.com/api/readyz` every minute — catches the host itself
  being down, which the watchdog cannot.
