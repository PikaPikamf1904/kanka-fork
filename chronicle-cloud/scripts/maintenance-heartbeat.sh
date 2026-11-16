#!/usr/bin/env bash
# Report work in progress to Chronicle's /api/status so the website can show its maintenance notice.
#   CHRONICLE_STATUS_URL    e.g. https://chronicle.example/api/status
#   CHRONICLE_STATUS_TOKEN  the MAINTENANCE_TOKEN secret (never commit it; never print it)
# Usage: maintenance-heartbeat.sh <deploy|development> <start|heartbeat|end> [ttl-seconds]
# Quietly does nothing when the two variables are not set, so it is safe in any session.
set -euo pipefail
kind="${1:-development}"; state="${2:-heartbeat}"; ttl="${3:-900}"
[ -n "${CHRONICLE_STATUS_URL:-}" ] && [ -n "${CHRONICLE_STATUS_TOKEN:-}" ] || exit 0
case "$kind" in deploy|development) ;; *) echo "kind must be deploy or development" >&2; exit 2;; esac
case "$state" in start|heartbeat|end) ;; *) echo "state must be start, heartbeat or end" >&2; exit 2;; esac
curl -fsS --max-time 10 -X POST "$CHRONICLE_STATUS_URL" \
  -H "authorization: Bearer ${CHRONICLE_STATUS_TOKEN}" -H 'content-type: application/json' \
  --data "{\"kind\":\"${kind}\",\"state\":\"${state}\",\"ttlSeconds\":${ttl}}" > /dev/null || true
