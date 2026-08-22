#!/usr/bin/env bash
# Deploy from this machine to the server: sync the repo (no secrets, no
# node_modules), build images on the host, run migrations, restart services.
#   deploy/deploy.sh admin@HOST path/to/key.pem                       # production
#   DEPLOY_DIR=/opt/catch-staging deploy/deploy.sh admin@HOST key.pem   # staging
# DEPLOY_EDGE=1 (default for /opt/catch) also (re)starts the shared edge Caddy.
set -euo pipefail
TARGET="${1:?usage: deploy.sh user@host key.pem}"
KEY="${2:?usage: deploy.sh user@host key.pem}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE_DIR="${DEPLOY_DIR:-/opt/catch}"
if [ "$REMOTE_DIR" = /opt/catch ]; then DEPLOY_EDGE="${DEPLOY_EDGE:-1}"; else DEPLOY_EDGE="${DEPLOY_EDGE:-0}"; fi
SSH="ssh -i $KEY -o StrictHostKeyChecking=accept-new $TARGET"

# Record what is running (written by CI, harmless when absent).
echo "== sync sources"
rsync -az --delete \
  --exclude '.git' --exclude 'node_modules' --exclude 'dist' --exclude '.env' --exclude '.env.*' \
  --exclude '*.pem' --exclude '*.key' --exclude 'legacy' --exclude 'docs' --exclude '*.pdf' \
  --exclude 'backend/storage' --exclude 'HANDOVER.md' \
  --include '.env.example' \
  -e "ssh -i $KEY -o StrictHostKeyChecking=accept-new" \
  "$ROOT/" "$TARGET:$REMOTE_DIR/"

echo "== build + migrate + up"
$SSH "cd $REMOTE_DIR/deploy && test -f .env || { echo 'deploy/.env missing on server — run deploy/server-env.sh first'; exit 1; }
  cd $REMOTE_DIR/deploy
  if [ '$DEPLOY_EDGE' = 1 ]; then docker compose -f docker-compose.edge.yml up -d --remove-orphans; docker compose -f docker-compose.edge.yml exec -T edge caddy reload --config /etc/caddy/Caddyfile 2>/dev/null || true; fi
  docker network inspect catch-edge >/dev/null 2>&1 || { echo 'catch-edge network missing — deploy production (edge) first'; exit 1; }
  docker compose build --pull api worker frontend 2>&1 | tail -3
  docker compose up -d --remove-orphans
  docker compose ps --format 'table {{.Service}}\t{{.Status}}'
  docker image prune -f >/dev/null"

echo "== smoke"
sleep 5
$SSH "cd $REMOTE_DIR/deploy && docker compose exec -T api wget -qO- http://127.0.0.1:3000/readyz || true"
echo
