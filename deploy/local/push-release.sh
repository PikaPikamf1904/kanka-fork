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
# Only names build-release.sh makes: they go into a remote command line below.
[[ "$name" =~ ^kanka-[0-9]+-[0-9]+-([0-9a-f]+)\.tar\.gz$ ]] || { echo "$name is not a build-release.sh archive name"; exit 1; }
label=${BASH_REMATCH[1]}
remote="/srv/kanka/uploads/$name"

# build-release.sh writes a checksum next to the archive; kanka-release checks it again
# after the upload.
files=("$archive")
if [ -f "$archive.sha256" ]; then
    (cd "$(dirname "$archive")" && sha256sum -c --quiet "$name.sha256") || { echo "$name does not match its checksum"; exit 1; }
    files+=("$archive.sha256")
else
    echo "note: no $name.sha256; the upload is not checksummed"
fi

echo "uploading $name to $target"
scp -q "${files[@]}" "$target:/srv/kanka/uploads/"
ssh "$target" "kanka-release '$remote' '$label' $flag && rm -f '$remote' '$remote.sha256'"
