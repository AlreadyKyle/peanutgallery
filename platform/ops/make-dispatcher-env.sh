#!/usr/bin/env bash
# make-dispatcher-env.sh: writes the VPS dispatcher's docker env file on the Mac (docs/specs/vps.md).
# It reads the repository .env and four variables the operator exports, and writes exactly the keys
# the dispatcher needs, with AGENT_MODE=unattended, at mode 0600. It prints key names, never values.
#
# usage, at the repository root:
#   export VPS_GITHUB_TOKEN=...   # the VPS's own fine-grained token, not the Mac's GITHUB_TOKEN
#   export GITHUB_READ_TOKEN=...  # the fine-grained token with Contents read only, for Managed Agents
#   export HEALTHCHECK_URL=...    # the healthchecks.io ping URL for the VPS
#   export NTFY_TOPIC_URL=...     # the ntfy topic URL
#   platform/ops/make-dispatcher-env.sh [output-file]
#
# output-file defaults to dispatcher.env in a new temporary folder. DOTENV names another .env to
# read (default: .env at the repository root). The transform is dispatcher-env.mjs.
set -euo pipefail

OPS_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$OPS_DIR/../.." && pwd)
DOTENV=${DOTENV:-$REPO_ROOT/.env}

usage() {
  echo "usage: VPS_GITHUB_TOKEN=... GITHUB_READ_TOKEN=... HEALTHCHECK_URL=... NTFY_TOPIC_URL=... platform/ops/make-dispatcher-env.sh [output-file]" >&2
  exit 2
}

[ $# -le 1 ] || usage
case "${1:-}" in -*) usage ;; esac
[ -f "$DOTENV" ] || { echo "make-dispatcher-env: $DOTENV not found" >&2; exit 1; }
command -v node > /dev/null 2>&1 || { echo "make-dispatcher-env: node is not on PATH" >&2; exit 1; }

umask 077
CREATED_DIR=""
if [ $# -eq 1 ]; then
  OUT=$1
else
  CREATED_DIR=$(mktemp -d "${TMPDIR:-/tmp}/peanutgallery-env.XXXXXX")
  OUT="$CREATED_DIR/dispatcher.env"
fi

if ! node "$OPS_DIR/dispatcher-env.mjs" "$DOTENV" "$OUT"; then
  if [ -n "$CREATED_DIR" ]; then rmdir "$CREATED_DIR"; fi
  exit 1
fi
chmod 600 "$OUT"
echo "next: scp \"$OUT\" root@<vps-ip>:/etc/peanutgallery/dispatcher.env, then delete the local copy (platform/ops/README.md)"
