#!/usr/bin/env bash
# Copy the server kit (deploy/server and the .env template) to the server, ready for
# provision.sh. Changes nothing else there.
#
#   deploy/local/push-kit.sh [user@host]      default: pika@192.168.1.239
#
# Then, on the server:   su -        (or sudo -i)
#                        bash /home/pika/kanka-kit/server/provision.sh
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
target=${1:-${KANKA_ADMIN_SSH:-pika@192.168.1.239}}

tar -C "$ROOT/deploy" -cf - server env.production.example \
    | ssh "$target" 'mkdir -p kanka-kit && tar -xf - -C kanka-kit && echo "kit copied to $HOME/kanka-kit"'
