#!/usr/bin/env bash
# Rehearse a Big Bertha install in a disposable Debian 13 + systemd container.
#
#   deploy/dev/staging.sh up                       build and start the "kanka-staging" machine
#   deploy/dev/staging.sh provision                copy the kit in and run provision.sh
#   deploy/dev/staging.sh deploy <tar.gz> [--first-install]
#   deploy/dev/staging.sh verify                   run kanka-verify
#   deploy/dev/staging.sh sh <command...>          run a command as root inside
#   deploy/dev/staging.sh down                     delete the machine and its data
#
# The wiki is then on http://127.0.0.1:8088 (this computer only).
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
NAME=${KANKA_STAGING_NAME:-kanka-staging}
IMAGE=${KANKA_STAGING_IMAGE:-kanka-staging}
PORT=${KANKA_STAGING_PORT:-8088}
export MSYS_NO_PATHCONV=1
# Docker on Windows needs Windows-style paths (MSYS path conversion is off below).
host_path() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi; }

in_box() { docker exec -i "$NAME" bash -c "$1"; }

cmd=${1:-}
shift || true
case "$cmd" in
    up)
        docker build -t "$IMAGE" -f "$(host_path "$ROOT/deploy/dev/Dockerfile.staging")" "$(host_path "$ROOT/deploy/dev")"
        docker run -d --name "$NAME" --hostname bigbertha-staging --privileged --cgroupns=private \
            --tmpfs /run --tmpfs /run/lock -p "127.0.0.1:$PORT:80" "$IMAGE" >/dev/null
        in_box 'for i in $(seq 1 30); do systemctl is-system-running 2>/dev/null | grep -qE "running|degraded" && exit 0; sleep 1; done; exit 1'
        echo "staging machine is up"
        ;;
    provision)
        tar -C "$ROOT/deploy" -cf - server env.production.example \
            | docker exec -i "$NAME" bash -c 'rm -rf /home/pika/kanka-kit && mkdir -p /home/pika/kanka-kit && tar -xf - -C /home/pika/kanka-kit'
        in_box "SWAP_SIZE=0 KANKA_APP_URL=http://127.0.0.1:$PORT bash /home/pika/kanka-kit/server/provision.sh"
        ;;
    deploy)
        archive=${1:?usage: staging.sh deploy <archive.tar.gz> [--first-install]}
        name=$(basename "$archive")
        docker cp "$(host_path "$archive")" "$NAME:/srv/kanka/uploads/$name"
        in_box "chown kanka:kanka /srv/kanka/uploads/$name && runuser -u kanka -- kanka-release /srv/kanka/uploads/$name staging ${2:-} && rm -f /srv/kanka/uploads/$name"
        ;;
    verify)
        in_box kanka-verify
        ;;
    sh)
        in_box "$*"
        ;;
    down)
        docker rm -f "$NAME" >/dev/null && echo "staging machine deleted"
        ;;
    *)
        sed -n '2,11p' "$0"
        exit 1
        ;;
esac
