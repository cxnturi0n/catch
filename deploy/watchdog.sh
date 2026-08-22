#!/usr/bin/env bash
# Host-side watchdog, run by cron every 5 minutes (see install-watchdog.sh).
# Checks the public readiness endpoint, disk and memory pressure, and
# restarts unhealthy containers. Alerts by e-mail through Resend using the
# key in deploy/.env (no extra services required). Deduplicates: one alert
# per condition until it clears.
set -u
ENV_FILE=/opt/catch/deploy/.env
STATE_DIR=/var/tmp/catch-watchdog
mkdir -p "$STATE_DIR"
[ -f "$ENV_FILE" ] && set -a && . "$ENV_FILE" && set +a
SITE="${SITE_ADDRESS:-localhost}"
ALERT_TO="${ALERT_TO:-${DISCOVERY_NOTIFY_TO:-}}"

alert() { # <key> <subject> <body>
  local key="$1" subject="$2" body="$3"
  [ -f "$STATE_DIR/$key" ] && return   # already alerted
  touch "$STATE_DIR/$key"
  logger -t catch-watchdog "ALERT $key: $subject"
  [ -z "${RESEND_API_KEY:-}" ] || [ -z "$ALERT_TO" ] && return
  curl -s -m 15 https://api.resend.com/emails -H "Authorization: Bearer $RESEND_API_KEY" -H 'Content-Type: application/json' \
    -d "$(jq -n --arg f "${EMAIL_FROM:-Catch <onboarding@resend.dev>}" --arg t "$ALERT_TO" --arg s "[catch-labs] $subject" --arg b "$body" '{from:$f,to:[$t],subject:$s,text:$b}')" >/dev/null
}
clear_alert() { # <key> <subject>
  [ -f "$STATE_DIR/$1" ] || return
  rm -f "$STATE_DIR/$1"
  logger -t catch-watchdog "RESOLVED $1"
  [ -z "${RESEND_API_KEY:-}" ] || [ -z "$ALERT_TO" ] && return
  curl -s -m 15 https://api.resend.com/emails -H "Authorization: Bearer $RESEND_API_KEY" -H 'Content-Type: application/json' \
    -d "$(jq -n --arg f "${EMAIL_FROM:-Catch <onboarding@resend.dev>}" --arg t "$ALERT_TO" --arg s "[catch-labs] resolved: $2" '{from:$f,to:[$t],subject:$s,text:"Condition cleared."}')" >/dev/null
}

# 1. API readiness (through the public edge, so TLS and proxy are covered).
if curl -fsS -m 15 "https://$SITE/api/readyz" >/dev/null 2>&1; then
  clear_alert api_down "API is reachable again"
else
  alert api_down "API not ready" "https://$SITE/api/readyz failed at $(date -u +%FT%TZ). Attempting container restart."
  (cd /opt/catch/deploy && docker compose restart api worker >/dev/null 2>&1)
fi

# 2. Disk usage on /.
USE=$(df -P / | awk 'NR==2{gsub("%","",$5); print $5}')
if [ "${USE:-0}" -ge 85 ]; then alert disk "Disk usage ${USE}%" "Root filesystem at ${USE}%. Run 'docker system prune' or grow the volume."; else clear_alert disk "Disk usage back under 85%"; fi

# 3. Memory (available < 150 MB).
AVAIL=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)
if [ "${AVAIL:-999}" -lt 150 ]; then alert mem "Low memory (${AVAIL} MB available)" "Consider a bigger instance."; else clear_alert mem "Memory pressure cleared"; fi

# 4. Containers not running.
DOWN=$(cd /opt/catch/deploy && docker compose ps --format '{{.Service}} {{.State}}' 2>/dev/null | awk '$2!="running" && $1!="migrate"{print $1}' | tr '\n' ' ')
if [ -n "$DOWN" ]; then alert containers "Containers down: $DOWN" "docker compose reports: $DOWN"; (cd /opt/catch/deploy && docker compose up -d >/dev/null 2>&1); else clear_alert containers "All containers running"; fi
