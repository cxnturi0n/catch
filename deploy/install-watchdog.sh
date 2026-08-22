#!/usr/bin/env bash
# Installs the watchdog as a root cron job (every 5 minutes). Run on the server:
#   ssh admin@HOST 'sudo bash -s' < deploy/install-watchdog.sh
set -euo pipefail
install -m 0755 /opt/catch/deploy/watchdog.sh /usr/local/bin/catch-watchdog
echo '*/5 * * * * root /usr/local/bin/catch-watchdog' > /etc/cron.d/catch-watchdog
chmod 644 /etc/cron.d/catch-watchdog
echo "watchdog installed; alerts go to ALERT_TO (or DISCOVERY_NOTIFY_TO) via Resend when RESEND_API_KEY is set"
