#!/usr/bin/env bash
# Read-only report on a machine before (or after) installing Kanka. Changes nothing, needs
# no root, and prints no passwords, keys or file contents with secrets. From another computer:
#
#   ssh pika@192.168.1.239 'bash -s' < deploy/server/diagnose.sh
#
# On the server itself it is installed as "kanka-diagnose".
set -u

section() { printf '\n== %s\n' "$*"; }
run() { "$@" 2>/dev/null || true; }

section "Machine"
printf 'user: %s  groups: %s\n' "$(id -un)" "$(id -Gn)"
printf 'hostname: %s\n' "$(hostname)"
. /etc/os-release 2>/dev/null && printf 'os: %s\n' "${PRETTY_NAME:-unknown}"
printf 'kernel: %s (%s)\n' "$(uname -r)" "$(uname -m)"
printf 'uptime: %s\n' "$(uptime -p 2>/dev/null)"
printf 'cpu: %s, %s cores\n' "$(awk -F: '/model name/ {gsub(/^ +/, "", $2); print $2; exit}' /proc/cpuinfo)" "$(nproc)"
run systemd-detect-virt --quiet && echo "virtualised: $(systemd-detect-virt)"

section "Memory"
run free -h
run swapon --show

section "Disks"
run lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT,ROTA,MODEL
run df -h -x tmpfs -x devtmpfs -x efivarfs

section "Network"
run ip -brief address
run ip route show default
echo "listening TCP ports:"
run ss -Hltn | awk '{print "  " $4}' | sort -u

section "Power (the wiki is offline while the machine sleeps)"
ls /sys/class/power_supply/ 2>/dev/null | grep -q '^BAT' && echo "battery: present (laptop)" || echo "battery: none"
for target in sleep.target suspend.target hibernate.target hybrid-sleep.target; do
    printf '%s: %s\n' "$target" "$(systemctl is-enabled "$target" 2>/dev/null || echo unknown)"
done
grep -hE '^\s*(HandleLidSwitch|HandleLidSwitchExternalPower|IdleAction)' /etc/systemd/logind.conf /etc/systemd/logind.conf.d/*.conf 2>/dev/null \
    || echo "logind: default settings (closing a laptop lid suspends it)"

section "Administration"
if command -v sudo >/dev/null; then
    sudo -n true 2>/dev/null && echo "sudo: available without a password prompt" || echo "sudo: installed (asks for a password, or this user is not allowed)"
else
    echo "sudo: not installed (use 'su -' for root commands)"
fi
printf 'ssh server: %s\n' "$(systemctl is-active ssh 2>/dev/null)"

section "Packages"
for pkg in nginx mariadb-server php8.4-fpm php8.4-cli libvips-tools unattended-upgrades curl git rsync tailscale; do
    version=$(dpkg-query -W -f='${Status} ${Version}' "$pkg" 2>/dev/null | awk '/install ok installed/ {print $4}')
    printf '%-22s %s\n' "$pkg" "${version:-not installed}"
done
echo "apt sources:"
grep -hE '^\s*(deb |URIs:|Suites:|Components:)' /etc/apt/sources.list /etc/apt/sources.list.d/* 2>/dev/null | sed 's/^/  /'

section "Time"
run timedatectl show -p Timezone -p NTPSynchronized

section "Kanka"
if [ -d /srv/kanka ]; then
    run ls -ld /srv/kanka /srv/kanka/*
    [ -L /srv/kanka/current ] && echo "live release: $(basename "$(readlink -f /srv/kanka/current)")"
else
    echo "/srv/kanka does not exist yet (not installed)"
fi
for unit in nginx php8.4-fpm mariadb kanka-queue kanka-queue-heavy kanka-scheduler.timer; do
    printf '%-24s %s / %s\n' "$unit" "$(systemctl is-active "$unit" 2>/dev/null)" "$(systemctl is-enabled "$unit" 2>/dev/null)"
done
