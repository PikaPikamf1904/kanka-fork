#!/usr/bin/env bash
# One-time setup of a Debian 13 (trixie) VM for Kanka. Run as root from a copy of
# the repository's deploy/ directory:
#
#   sudo DEPLOY_PUBKEY="ssh-ed25519 AAAA... github-deploy" bash deploy/server/provision.sh
#
# Safe to re-run: existing users, databases, passwords and .env are kept.
# Installs: nginx, PHP 8.4-FPM, MariaDB 11.8, a 2 GB swap file, a queue worker
# and a scheduler timer. It does not install or configure Tailscale (see README).
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
BASE=/srv/kanka
APP_USER=kanka
SWAP_SIZE=${SWAP_SIZE:-2G}

log() { printf '[provision] %s\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "run as root"; exit 1; }

log "installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends \
    nginx mariadb-server mariadb-client curl ca-certificates unzip \
    php8.4-fpm php8.4-cli php8.4-bcmath php8.4-intl php8.4-gd php8.4-zip \
    php8.4-mbstring php8.4-xml php8.4-curl php8.4-mysql php8.4-gmp php8.4-igbinary \
    unattended-upgrades
if [ "${INSTALL_VIPS:-1}" = "1" ]; then
    # Only needed to tile very large map images; harmless otherwise.
    apt-get install -y -qq --no-install-recommends libvips-tools
fi

if [ "$SWAP_SIZE" != "0" ] && ! swapon --show | grep -q /swapfile; then
    log "adding ${SWAP_SIZE} swap file"
    fallocate -l "$SWAP_SIZE" /swapfile
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    sysctl -q vm.swappiness=10
    echo 'vm.swappiness=10' > /etc/sysctl.d/90-kanka.conf
fi

log "creating ${APP_USER} user and ${BASE}"
id "$APP_USER" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$APP_USER"
usermod -aG www-data "$APP_USER"
mkdir -p "$BASE/releases" "$BASE/shared/storage" "$BASE/uploads"
chown -R "$APP_USER:$APP_USER" "$BASE"
chmod 750 "$BASE"
# nginx (www-data) only needs to read public files.
chgrp www-data "$BASE"

if [ -n "${DEPLOY_PUBKEY:-}" ]; then
    install -d -m 700 -o "$APP_USER" -g "$APP_USER" "/home/$APP_USER/.ssh"
    touch "/home/$APP_USER/.ssh/authorized_keys"
    grep -qxF "$DEPLOY_PUBKEY" "/home/$APP_USER/.ssh/authorized_keys" || echo "$DEPLOY_PUBKEY" >> "/home/$APP_USER/.ssh/authorized_keys"
    chown "$APP_USER:$APP_USER" "/home/$APP_USER/.ssh/authorized_keys"
    chmod 600 "/home/$APP_USER/.ssh/authorized_keys"
fi

# The deploy user may only reload PHP and restart the worker.
cat > /etc/sudoers.d/kanka <<EOF
$APP_USER ALL=(root) NOPASSWD: /usr/bin/systemctl reload php8.4-fpm, /usr/bin/systemctl restart kanka-queue
EOF
chmod 440 /etc/sudoers.d/kanka
visudo -cq

log "configuring MariaDB"
install -m 644 "$HERE/mariadb-lowmem.cnf" /etc/mysql/mariadb.conf.d/90-kanka.cnf
systemctl restart mariadb

ENV_FILE="$BASE/shared/.env"
if [ ! -f "$ENV_FILE" ]; then
    log "creating $ENV_FILE with generated secrets"
    db_password=$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)
    backup_password=$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)
    app_key="base64:$(head -c 32 /dev/urandom | base64)"
    sed -e "s#^APP_KEY=.*#APP_KEY=${app_key}#" \
        -e "s#^DB_PASSWORD=.*#DB_PASSWORD=${db_password}#" \
        -e "s#^BACKUP_ARCHIVE_PASSWORD=.*#BACKUP_ARCHIVE_PASSWORD=${backup_password}#" \
        "$HERE/../env.production.example" > "$ENV_FILE"
    chown "$APP_USER:$APP_USER" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    log "edit APP_URL, APP_EMAIL and MAIL_FROM_ADDRESS in $ENV_FILE before the first deploy"
fi
db_password=$(grep '^DB_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)
mariadb <<SQL
CREATE DATABASE IF NOT EXISTS kanka CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'kanka'@'localhost' IDENTIFIED BY '${db_password}';
ALTER USER 'kanka'@'localhost' IDENTIFIED BY '${db_password}';
GRANT ALL PRIVILEGES ON kanka.* TO 'kanka'@'localhost';
FLUSH PRIVILEGES;
SQL

log "configuring PHP-FPM"
install -m 644 "$HERE/php-fpm-kanka.conf" /etc/php/8.4/fpm/pool.d/kanka.conf
# Drop the default pool so only Kanka's on-demand pool uses memory.
[ -f /etc/php/8.4/fpm/pool.d/www.conf ] && mv /etc/php/8.4/fpm/pool.d/www.conf /etc/php/8.4/fpm/pool.d/www.conf.disabled
systemctl restart php8.4-fpm

log "configuring nginx"
install -m 644 "$HERE/nginx-kanka.conf" /etc/nginx/sites-available/kanka
ln -sfn /etc/nginx/sites-available/kanka /etc/nginx/sites-enabled/kanka
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

log "installing queue worker and scheduler"
install -m 644 "$HERE/kanka-queue.service" /etc/systemd/system/kanka-queue.service
install -m 644 "$HERE/kanka-scheduler.service" /etc/systemd/system/kanka-scheduler.service
install -m 644 "$HERE/kanka-scheduler.timer" /etc/systemd/system/kanka-scheduler.timer
systemctl daemon-reload
# Both start working once the first release exists (release.sh restarts the worker).
systemctl enable kanka-queue kanka-scheduler.timer >/dev/null
systemctl start kanka-scheduler.timer

log "done. Next: install Tailscale and run the first deploy (deploy/README.md)."
