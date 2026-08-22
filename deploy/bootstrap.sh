#!/usr/bin/env bash
# One-time server preparation for Debian 12/13 on EC2. Idempotent.
#   ssh admin@HOST 'sudo bash -s' < deploy/bootstrap.sh
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

echo "== packages"
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg ufw fail2ban unattended-upgrades apt-listchanges rsync git jq >/dev/null

echo "== docker (official repo)"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin >/dev/null
fi
usermod -aG docker "${SUDO_USER:-admin}"
# Keep container logs bounded even for services that forget to set it.
cat > /etc/docker/daemon.json <<'JSON'
{ "log-driver": "json-file", "log-opts": { "max-size": "50m", "max-file": "5" } }
JSON
systemctl enable --now docker
systemctl restart docker

echo "== swap (2 GB instance: build headroom)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
sysctl -w vm.swappiness=10 >/dev/null
echo 'vm.swappiness=10' > /etc/sysctl.d/90-catch.conf

echo "== firewall"
ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null
ufw --force enable >/dev/null
ufw status | head -8

echo "== sshd hardening"
mkdir -p /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/90-catch.conf <<'CONF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
MaxAuthTries 4
CONF
systemctl reload ssh || systemctl reload sshd || true

echo "== fail2ban + unattended upgrades"
cat > /etc/fail2ban/jail.d/sshd.local <<'CONF'
[sshd]
enabled = true
maxretry = 5
bantime = 1h
CONF
systemctl enable --now fail2ban
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CONF

echo "== app directory"
mkdir -p /opt/catch
chown "${SUDO_USER:-admin}":"${SUDO_USER:-admin}" /opt/catch

echo "== done: $(docker --version) | $(docker compose version)"
