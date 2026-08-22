#!/usr/bin/env bash
# Deploy from this machine to the server: sync the repo (no secrets, no
# node_modules), build images on the host, run migrations, restart services.
#   deploy/deploy.sh admin@HOST path/to/key.pem
set -euo pipefail
TARGET="${1:?usage: deploy.sh user@host key.pem}"
KEY="${2:?usage: deploy.sh user@host key.pem}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE_DIR=/opt/catch
SSH="ssh -i $KEY -o StrictHostKeyChecking=accept-new $TARGET"

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
  docker compose build --pull api worker frontend 2>&1 | tail -3
  docker compose up -d --remove-orphans
  docker compose ps --format 'table {{.Service}}\t{{.Status}}'
  docker image prune -f >/dev/null"

echo "== smoke"
sleep 5
$SSH "curl -s -m 10 http://127.0.0.1/api/readyz || true"
echo
