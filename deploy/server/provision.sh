#!/usr/bin/env bash
# Set up (or bring up to date) a Debian 13 "trixie" machine to host Kanka. Built for Big
# Bertha: 4 GB RAM, dual-core CPU, HDD, home LAN. Run as root from a copy of the repository:
#
#   sudo bash deploy/server/provision.sh
#   sudo DEPLOY_PUBKEY="ssh-ed25519 AAAA... kanka-deploy" bash deploy/server/provision.sh
#
# Safe to re-run at any time. It keeps existing users, databases, passwords and .env, only
# rewrites a config file when its content changed, and only restarts what it changed.
#
# It never touches: disk partitions, the bootloader, user passwords, the firewall, SSH
# server settings, or your router. Nothing is exposed beyond the home network.
#
# Optional settings (environment variables):
#   KANKA_APP_URL   URL people type to open the wiki; default http://<this machine's LAN IP>
#   DEPLOY_PUBKEY   public key allowed to log in as "kanka" to deploy releases (default:
#                   the deploy.pub that deploy/local/push-kit.sh puts next to this folder)
#   DEPLOY_FROM     networks that key may log in from (default: home LAN, Tailscale and
#                   this machine, the same ranges nginx allows)
#   SWAP_SIZE       swap file to add when the machine has no swap at all (default 2G, 0 = none)
#   KANKA_ALLOW_OTHER_SITES  1 lets provisioning continue when nginx or PHP-FPM already
#                   serve something else (by default it stops and says what it found)
#   INSTALL_VIPS    1 (default) installs libvips-tools for tiling large map images
#   UNATTENDED_UPGRADES  1 (default) installs automatic Debian security updates
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
BASE=/srv/kanka
APP_USER=kanka
SWAP_SIZE=${SWAP_SIZE:-2G}
ENV_FILE="$BASE/shared/.env"

log() { printf '[provision] %s\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo bash $0, or 'su -' first)."; exit 1; }

. /etc/os-release
if [ "${VERSION_CODENAME:-}" != "trixie" ] && [ -z "${KANKA_ALLOW_OTHER_OS:-}" ]; then
    echo "This script targets Debian 13 (trixie); found '${PRETTY_NAME:-unknown}'."
    echo "Set KANKA_ALLOW_OTHER_OS=1 to try anyway."
    exit 1
fi

# install_if_changed <source> <destination> <mode>: prints "changed" when it wrote the file.
install_if_changed() {
    if [ -f "$2" ] && cmp -s "$1" "$2"; then
        return 0
    fi
    install -D -m "$3" "$1" "$2"
    echo changed
}

# ensure_env KEY VALUE: add a setting to an existing .env without touching other lines.
ensure_env() {
    grep -q "^$1=" "$ENV_FILE" || { printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"; log "added $1 to .env"; }
}

log "installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
packages=(
    nginx mariadb-server mariadb-client curl ca-certificates unzip sudo
    php8.4-fpm php8.4-cli php8.4-bcmath php8.4-intl php8.4-gd php8.4-zip
    php8.4-mbstring php8.4-xml php8.4-curl php8.4-mysql php8.4-gmp php8.4-igbinary
)
[ "${INSTALL_VIPS:-1}" = "1" ] && packages+=(libvips-tools)
[ "${UNATTENDED_UPGRADES:-1}" = "1" ] && packages+=(unattended-upgrades)
apt-get install -y -qq --no-install-recommends "${packages[@]}"

if [ "$SWAP_SIZE" != "0" ] && [ -z "$(swapon --noheadings --show)" ] && [ -e /swapfile ]; then
    log "no active swap, but /swapfile already exists: leaving it alone (no swap added)"
elif [ "$SWAP_SIZE" != "0" ] && [ -z "$(swapon --noheadings --show)" ]; then
    log "no swap found: adding a ${SWAP_SIZE} swap file"
    fallocate -l "$SWAP_SIZE" /swapfile
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
if [ ! -f /etc/sysctl.d/90-kanka.conf ]; then
    # Prefer dropping file cache over swapping PHP/MariaDB out to the slow HDD.
    echo 'vm.swappiness=10' > /etc/sysctl.d/90-kanka.conf
    sysctl -q -p /etc/sysctl.d/90-kanka.conf || true
fi

log "creating the ${APP_USER} user and ${BASE}"
id "$APP_USER" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$APP_USER"
usermod -aG www-data "$APP_USER"
for dir in "$BASE" "$BASE/releases" "$BASE/shared" "$BASE/shared/storage" "$BASE/uploads" "$BASE/backups"; do
    install -d -o "$APP_USER" -g "$APP_USER" "$dir"
done
# nginx (www-data) may enter the tree to read public files; nobody else may.
chgrp www-data "$BASE" "$BASE/shared" "$BASE/shared/storage"
chmod 750 "$BASE" "$BASE/shared" "$BASE/shared/storage"
# Backups and uploaded release archives are for the kanka user only.
chmod 700 "$BASE/backups" "$BASE/uploads"

if [ -z "${DEPLOY_PUBKEY:-}" ] && [ -f "$HERE/../deploy.pub" ]; then
    DEPLOY_PUBKEY=$(head -n 1 "$HERE/../deploy.pub" | tr -d '\r')
fi
if [ -n "${DEPLOY_PUBKEY:-}" ]; then
    if ! [[ "$DEPLOY_PUBKEY" =~ ^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp[0-9]+|sk-ssh-ed25519@openssh.com|sk-ecdsa-sha2-nistp256@openssh.com)\ [A-Za-z0-9+/=]+(\ [^[:cntrl:]]*)?$ ]]; then
        echo "DEPLOY_PUBKEY does not look like one public SSH key line; not adding it."
        exit 1
    fi
    # The key only works from the home network or Tailscale, and cannot forward ports or
    # agents. This is the kanka user's own key file; the SSH server settings are not changed.
    deploy_from=${DEPLOY_FROM:-127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,100.64.0.0/10,fe80::/10,fc00::/7}
    [[ "$deploy_from" =~ ^[0-9A-Fa-f.:/,*]+$ ]] || { echo "DEPLOY_FROM must be a comma-separated list of addresses or networks."; exit 1; }
    key_body=$(awk '{print $1" "$2}' <<<"$DEPLOY_PUBKEY")
    install -d -m 700 -o "$APP_USER" -g "$APP_USER" "/home/$APP_USER/.ssh"
    touch "/home/$APP_USER/.ssh/authorized_keys"
    # Replace any earlier line for this key: an older kit added it without restrictions.
    keys="/home/$APP_USER/.ssh/authorized_keys"
    { grep -vF "$key_body" "$keys" || true; echo "from=\"$deploy_from\",restrict,pty $DEPLOY_PUBKEY"; } > "$keys.new"
    mv "$keys.new" "$keys"
    chown "$APP_USER:$APP_USER" "/home/$APP_USER/.ssh/authorized_keys"
    chmod 600 "/home/$APP_USER/.ssh/authorized_keys"
    log "deploy key added for ${APP_USER}"
fi

# The deploy user may only reload PHP-FPM and start the workers after the first deploy
# (running workers restart themselves through "artisan queue:restart").
sudoers_tmp=$(mktemp)
cat > "$sudoers_tmp" <<EOF
$APP_USER ALL=(root) NOPASSWD: /usr/bin/systemctl reload php8.4-fpm
$APP_USER ALL=(root) NOPASSWD: /usr/bin/systemctl start kanka-queue kanka-queue-heavy
EOF
visudo -cqf "$sudoers_tmp"
install_if_changed "$sudoers_tmp" /etc/sudoers.d/kanka 440 >/dev/null
rm -f "$sudoers_tmp"

log "configuring MariaDB"
if [ -n "$(install_if_changed "$HERE/mariadb-kanka.cnf" /etc/mysql/mariadb.conf.d/90-kanka.cnf 644)" ]; then
    systemctl restart mariadb
fi
systemctl enable --now mariadb >/dev/null

if [ ! -f "$ENV_FILE" ]; then
    log "creating $ENV_FILE with generated secrets"
    lan_ip=$(hostname -I 2>/dev/null | awk '{print $1}')
    app_url=${KANKA_APP_URL:-http://${lan_ip:-localhost}}
    db_password=$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)
    backup_password=$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)
    app_key="base64:$(head -c 32 /dev/urandom | base64)"
    umask 077
    sed -e "s#^APP_KEY=.*#APP_KEY=${app_key}#" \
        -e "s#^APP_URL=.*#APP_URL=${app_url}#" \
        -e "s#^DB_PASSWORD=.*#DB_PASSWORD=${db_password}#" \
        -e "s#^BACKUP_ARCHIVE_PASSWORD=.*#BACKUP_ARCHIVE_PASSWORD=${backup_password}#" \
        "$HERE/../env.production.example" > "$ENV_FILE"
    umask 022
    log "APP_URL is ${app_url}. Set APP_EMAIL and MAIL_FROM_ADDRESS in $ENV_FILE when convenient."
fi
# Settings added after the first install of this kit.
ensure_env QUEUE_HEAVY_DRIVER database
ensure_env BACKUP_ROOT "$BASE/backups"
chown "$APP_USER:$APP_USER" "$ENV_FILE"
chmod 600 "$ENV_FILE"

db_password=$({ grep '^DB_PASSWORD=' "$ENV_FILE" || true; } | cut -d= -f2-)
# It goes into SQL below, so only letters and digits; and never the template's placeholder.
if [[ "$db_password" == CHANGE_ME* ]] || ! [[ "$db_password" =~ ^[A-Za-z0-9]{16,}$ ]]; then
    echo "DB_PASSWORD in $ENV_FILE must be at least 16 letters and digits (and not CHANGE_ME)."
    exit 1
fi
mariadb <<SQL
CREATE DATABASE IF NOT EXISTS kanka CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'kanka'@'localhost' IDENTIFIED BY '${db_password}';
ALTER USER 'kanka'@'localhost' IDENTIFIED BY '${db_password}';
GRANT ALL PRIVILEGES ON kanka.* TO 'kanka'@'localhost';
FLUSH PRIVILEGES;
SQL
unset db_password

# This kit makes Kanka the machine's only website. Stop before switching off anything
# else that nginx or PHP-FPM already serves.
other_sites=$(find /etc/nginx/sites-enabled /etc/nginx/conf.d -mindepth 1 -maxdepth 1 \
    ! -name default ! -name kanka 2>/dev/null || true)
other_pools=$(find /etc/php/8.4/fpm/pool.d -mindepth 1 -maxdepth 1 -name '*.conf' \
    ! -name www.conf ! -name kanka.conf 2>/dev/null || true)
if [ -n "$other_sites$other_pools" ] && [ "${KANKA_ALLOW_OTHER_SITES:-}" != "1" ]; then
    echo "nginx or PHP-FPM already serve something else on this machine:"
    printf '  %s\n' $other_sites $other_pools
    echo "Kanka's site answers every address on port 80. Check these, then run again with"
    echo "KANKA_ALLOW_OTHER_SITES=1 to continue. Nothing has been changed in nginx or PHP-FPM."
    exit 1
fi

log "configuring PHP-FPM"
fpm_changed=$(install_if_changed "$HERE/php-fpm-kanka.conf" /etc/php/8.4/fpm/pool.d/kanka.conf 644)
fpm_changed+=$(install_if_changed "$HERE/php-kanka.ini" /etc/php/8.4/fpm/conf.d/90-kanka.ini 644)
# Drop the default pool so only Kanka's on-demand pool uses memory. Renamed, not deleted.
if [ -f /etc/php/8.4/fpm/pool.d/www.conf ]; then
    mv /etc/php/8.4/fpm/pool.d/www.conf /etc/php/8.4/fpm/pool.d/www.conf.disabled
    fpm_changed+=changed
fi
php-fpm8.4 -t >/dev/null 2>&1 || { php-fpm8.4 -t; exit 1; }
systemctl enable --now php8.4-fpm >/dev/null
[ -n "$fpm_changed" ] && systemctl restart php8.4-fpm

log "configuring nginx"
nginx_changed=$(install_if_changed "$HERE/nginx-kanka.conf" /etc/nginx/sites-available/kanka 644)
ln -sfn /etc/nginx/sites-available/kanka /etc/nginx/sites-enabled/kanka
# Only the link is removed; /etc/nginx/sites-available/default stays.
if [ -e /etc/nginx/sites-enabled/default ]; then
    rm -f /etc/nginx/sites-enabled/default
    nginx_changed+=changed
fi
nginx -t -q
systemctl enable --now nginx >/dev/null
[ -n "$nginx_changed" ] && systemctl reload nginx

log "installing queue workers and the scheduler"
units_changed=""
for unit in kanka-queue.service kanka-queue-heavy.service kanka-scheduler.service kanka-scheduler.timer; do
    units_changed+=$(install_if_changed "$HERE/$unit" "/etc/systemd/system/$unit" 644)
done
# Bring the web stack back after a crash, like the workers.
for unit in nginx php8.4-fpm mariadb; do
    units_changed+=$(install_if_changed "$HERE/restart-on-failure.conf" "/etc/systemd/system/$unit.service.d/90-kanka-restart.conf" 644)
done
[ -n "$units_changed" ] && systemctl daemon-reload
systemctl enable kanka-queue kanka-queue-heavy kanka-scheduler.timer >/dev/null
systemctl start kanka-scheduler.timer
if [ -e "$BASE/current" ]; then
    # Already deployed: make sure workers run and use any new unit settings.
    if [ -n "$units_changed" ]; then
        systemctl restart kanka-queue kanka-queue-heavy
    else
        systemctl start kanka-queue kanka-queue-heavy
    fi
else
    log "no release yet: the workers start after the first deploy"
fi

log "installing the kanka-release, kanka-backup, kanka-restore, kanka-verify and kanka-diagnose commands"
for pair in release.sh:kanka-release backup-now.sh:kanka-backup restore.sh:kanka-restore \
    verify.sh:kanka-verify diagnose.sh:kanka-diagnose; do
    install_if_changed "$HERE/${pair%%:*}" "/usr/local/bin/${pair##*:}" 755 >/dev/null
done

if [ -e "$BASE/current" ]; then
    log "done. Check the machine with: sudo kanka-verify"
else
    log "done. Next step: deploy a release (deploy/README.md, 'First deploy')."
fi
