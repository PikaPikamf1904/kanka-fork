#!/usr/bin/env bash
# Upload a release archive to the server and make it live with kanka-release. Uses the
# "kanka" deploy account (key login set up through provision.sh's DEPLOY_PUBKEY).
#
#   deploy/local/push-release.sh                        newest archive in deploy/local/out
#   deploy/local/push-release.sh <archive.tar.gz>
#   deploy/local/push-release.sh <archive> --first-install    the very first deploy only
#
# Server address: KANKA_SSH (default kanka@192.168.1.239).
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
target=${KANKA_SSH:-kanka@192.168.1.239}

archive=${1:-}
if [ -z "$archive" ] || [ "${archive:0:2}" = "--" ]; then
    archive=$(ls -1t "$ROOT"/deploy/local/out/kanka-*.tar.gz 2>/dev/null | head -n 1)
    [ -n "$archive" ] || { echo "no archive in deploy/local/out; run deploy/local/build-release.sh"; exit 1; }
else
    shift
fi
flag=""
[ "${1:-}" = "--first-install" ] && flag="--first-install"

name=$(basename "$archive")
label=$(sed -E 's/^kanka-[0-9]+-[0-9]+-([0-9a-f]+)\.tar\.gz$/\1/' <<<"$name")
remote="/srv/kanka/uploads/$name"

echo "uploading $name to $target"
scp -q "$archive" "$target:$remote"
ssh "$target" "kanka-release '$remote' '$label' $flag && rm -f '$remote'"
