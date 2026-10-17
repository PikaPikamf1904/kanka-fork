#!/usr/bin/env bash
# Copy the server kit (deploy/server and the .env template) to the server, ready for
# provision.sh. Changes nothing else there. Your public SSH key (~/.ssh/id_ed25519.pub, or
# KANKA_DEPLOY_PUBKEY_FILE) goes along as deploy.pub, so provision.sh lets you deploy as
# "kanka" without pasting it. Only the public half is sent.
#
#   deploy/local/push-kit.sh [user@host]      default: pika@192.168.1.239
#
# Then, on the server:   su -        (or sudo -i)
#                        bash /home/pika/kanka-kit/server/provision.sh
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
target=${1:-${KANKA_ADMIN_SSH:-pika@192.168.1.239}}

pubkey=${KANKA_DEPLOY_PUBKEY_FILE:-$HOME/.ssh/id_ed25519.pub}

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
cp -R "$ROOT/deploy/server" "$ROOT/deploy/env.production.example" "$stage/"
if [ -f "$pubkey" ]; then
    case "$pubkey" in
        *.pub) ;;
        *) echo "$pubkey is not a .pub file; refusing to send it"; exit 1 ;;
    esac
    # A private key wrongly named .pub must never leave this computer.
    if [ "$(grep -c . "$pubkey")" -ne 1 ] || ! grep -qE '^(ssh-|ecdsa-|sk-)[A-Za-z0-9@.-]+ [A-Za-z0-9+/=]+' "$pubkey"; then
        echo "$pubkey does not hold a single public key line; refusing to send it"
        exit 1
    fi
    cp "$pubkey" "$stage/deploy.pub"
    echo "including your public key $pubkey"
else
    echo "no $pubkey: create one with ssh-keygen -t ed25519 (deploy/README.md, step 2), then run this again"
fi

tar -C "$stage" -cf - . \
    | ssh "$target" 'rm -rf kanka-kit && mkdir -p kanka-kit && tar -xf - -C kanka-kit && echo "kit copied to $HOME/kanka-kit"'
