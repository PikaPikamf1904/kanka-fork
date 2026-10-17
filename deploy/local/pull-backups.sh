#!/usr/bin/env bash
# Copy backup archives from the server that this computer does not have yet. Archives
# stay encrypted (BACKUP_ARCHIVE_PASSWORD); keep the copy somewhere private, never in a
# shared or synced public folder.
#
#   deploy/local/pull-backups.sh [destination folder]   default: deploy/local/backups
#
# Server address: KANKA_SSH (default kanka@192.168.1.239).
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
target=${KANKA_SSH:-kanka@192.168.1.239}
dest=${1:-$ROOT/deploy/local/backups}
mkdir -p "$dest"

copied=0
while IFS= read -r remote; do
    [ -n "$remote" ] || continue
    local_name="$dest/$(basename "$(dirname "$remote")")-$(basename "$remote")"
    [ -f "$local_name" ] && continue
    echo "copying $remote"
    scp -q "$target:$remote" "$local_name.part"
    mv "$local_name.part" "$local_name"
    copied=$((copied + 1))
done < <(ssh "$target" "find /srv/kanka/backups -mindepth 2 -name '*.zip' | sort")
echo "$copied new archive(s) in $dest"
