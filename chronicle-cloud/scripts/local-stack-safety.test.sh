#!/usr/bin/env bash
# Run against a temporary copy and a fake Docker executable; no real resources are touched.
set -euo pipefail
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/project/scripts" "$work/bin" "$work/project/.local"
cp "$(dirname "$0")/local-stack.sh" "$work/project/scripts/local-stack.sh"
cat > "$work/bin/docker" <<'DOCKER'
#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >> "$CALL_LOG"
shift # explicitly pinned --host
case "${1:-} ${2:-}" in
  'info ') exit 0 ;;
  'container inspect')
    if [ "${3:-}" = '-f' ]; then echo "$(printf '%064d' 2) foreign-owner"; exit 0; fi
    [ "${3:-}" = chronicle-gotrue ] ;;
  *) exit 42 ;;
esac
DOCKER
chmod +x "$work/bin/docker"
export CALL_LOG="$work/calls"
export PATH="$work/bin:$PATH"
printf 'leave me alone\n' > "$work/project/.local/unrelated"
if bash "$work/project/scripts/local-stack.sh" down >"$work/out" 2>&1; then echo 'unowned directory accepted' >&2; exit 1; fi
[ -f "$work/project/.local/unrelated" ] && [ ! -e "$CALL_LOG" ]
printf '%064d\n' 1 > "$work/project/.local/stack-owner"
if bash "$work/project/scripts/local-stack.sh" down >"$work/out" 2>&1; then echo 'unowned container accepted' >&2; exit 1; fi
grep -q 'Refusing unowned container' "$work/out"
[ -f "$work/project/.local/unrelated" ]
! grep -q 'rm -f' "$CALL_LOG"
echo 'Local stack ownership checks passed.'
