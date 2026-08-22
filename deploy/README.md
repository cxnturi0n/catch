# Deploy

One-host Docker Compose stack: Caddy edge (TLS) → frontend (static) + api; worker; PostgreSQL.

```bash
cp .env.example .env && chmod 600 .env   # fill in values
docker compose up -d --build
docker compose ps
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
ssh admin@HOST 'bash -s catch-labs.com' < deploy/server-env.sh   # once: secrets → /opt/catch/deploy/.env
deploy/deploy.sh admin@HOST path/to/key.pem                  # every release (or use the GitHub Action)
```

GitHub Actions: `CI` runs typecheck, tests (real Postgres), lint and image
builds on every push/PR. `Deploy` is manual (Actions → Deploy → Run workflow,
pick a ref); it needs repository secrets `DEPLOY_SSH_KEY` (private key of a
dedicated ed25519 key whose public half is in `~admin/.ssh/authorized_keys`
on the server) and `DEPLOY_HOST`, and optionally the variable `SITE_URL`.
Rollback = run Deploy with the previous commit SHA.

## Monitoring

- `deploy/watchdog.sh` (installed by `install-watchdog.sh`, cron every 5 min,
  root): checks `https://$SITE_ADDRESS/api/readyz`, disk ≥85 %, memory
  <150 MB, stopped containers; restarts api/worker or `compose up -d` when
  needed; e-mails `ALERT_TO` (fallback `DISCOVERY_NOTIFY_TO`) through Resend,
  once per condition and again when it clears. Logs to syslog
  (`journalctl -t catch-watchdog`).
- Error tracking: set `SENTRY_DSN` (api + worker) and build the frontend with
  `VITE_SENTRY_DSN`; both are no-ops when unset.
- Recommended external check: a free uptime monitor (e.g. UptimeRobot) on
  `https://catch-labs.com/api/readyz` every minute — catches the host itself
  being down, which the watchdog cannot.
