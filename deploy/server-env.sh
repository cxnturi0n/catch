#!/usr/bin/env bash
# Creates deploy/.env on the server with fresh secrets (runs ON the server).
#   production: ssh admin@HOST 'bash -s catch-labs.com' < deploy/server-env.sh
#   staging:    ssh admin@HOST 'bash -s staging.catch-labs.com staging' < deploy/server-env.sh
set -euo pipefail
DOMAIN="${1:?usage: server-env.sh DOMAIN [production|staging]}"
APP_ENV="${2:-production}"
case "$APP_ENV" in
  production) DIR=/opt/catch/deploy; STACK=catch; DB_PORT=5432 ;;
  staging)    DIR=/opt/catch-staging/deploy; STACK=catch-staging; DB_PORT=5433 ;;
  *) echo "APP_ENV must be production or staging"; exit 1 ;;
esac
mkdir -p "$DIR"
if [ -f "$DIR/.env" ]; then echo "$DIR/.env already exists — not overwriting"; exit 0; fi
umask 077
cat > "$DIR/.env" <<ENV
# $APP_ENV stack
STACK=$STACK
APP_ENV=$APP_ENV
DB_PORT=$DB_PORT
SITE_ADDRESS=$DOMAIN
# Read by the shared edge (docker-compose.edge.yml, production checkout only).
STAGING_ADDRESS=
IMAGE_TAG=local

POSTGRES_USER=catch
POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d '=+/' | cut -c1-32)
POSTGRES_DB=catch

LOG_LEVEL=info
APP_URL=https://$DOMAIN
API_URL=https://$DOMAIN/api
AUTH_SECRET=$(openssl rand -base64 48 | tr -d '\n')
CREDENTIALS_ENCRYPTION_KEYS=k1:$(openssl rand -base64 32)
TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 32)

# Fill in when available
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
FACEBOOK_CLIENT_ID=
FACEBOOK_CLIENT_SECRET=
TWITTER_CLIENT_ID=
TWITTER_CLIENT_SECRET=
RESEND_API_KEY=
EMAIL_FROM="Catch <no-reply@$DOMAIN>"
DISCOVERY_NOTIFY_TO=
ANTHROPIC_API_KEY=
LLM_MODEL=claude-opus-5
ENV
chmod 600 "$DIR/.env"
echo "wrote $DIR/.env (back up AUTH_SECRET and CREDENTIALS_ENCRYPTION_KEYS in your vault)"
