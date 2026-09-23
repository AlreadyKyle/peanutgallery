#!/usr/bin/env bash
# make-jobs-env.sh: writes the VPS jobs' docker env files on the Mac (docs/specs/money-safety.md):
# backup.env, controller.env and quota.env, each with only its own job's keys, at mode 0600. It prints
# key names, never values. A job whose keys are not all set yet is refused and named; the others are
# still written.
#
# usage, at the repository root, with the values from .env.vps exported:
#   export NTFY_TOPIC_URL=...           # the ntfy topic URL
#   export BACKUP_HEALTHCHECK_URL=...   # the healthchecks.io ping URL of the backup check
#   export VPS_GITHUB_TOKEN=...         # the dispatcher's token; its Plan read feeds the quota check
#   platform/ops/make-jobs-env.sh [backup|controller|quota ...]
# CONTROLLER_HEALTHCHECK_URL and QUOTA_HEALTHCHECK_URL are copied when exported. The files go to a new
# temporary folder; DOTENV names another .env to read (default: .env at the repository root). The
# transform is jobs-env.mjs.
set -euo pipefail

OPS_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$OPS_DIR/../.." && pwd)
DOTENV=${DOTENV:-$REPO_ROOT/.env}

for job in "$@"; do
  case "$job" in backup | controller | quota) ;; *)
    echo "usage: platform/ops/make-jobs-env.sh [backup|controller|quota ...]" >&2
    exit 2
    ;;
  esac
done
[ -f "$DOTENV" ] || { echo "make-jobs-env: $DOTENV not found" >&2; exit 1; }
command -v node > /dev/null 2>&1 || { echo "make-jobs-env: node is not on PATH" >&2; exit 1; }

umask 077
OUT=$(mktemp -d "${TMPDIR:-/tmp}/peanutgallery-jobs-env.XXXXXX")
status=0
node "$OPS_DIR/jobs-env.mjs" "$DOTENV" "$OUT" "$@" || status=$?
if [ -z "$(find "$OUT" -mindepth 1 -print -quit)" ]; then
  rmdir "$OUT"
  exit "$status"
fi
echo "next: scp each file to root@<vps-ip>:/etc/peanutgallery/, then delete $OUT (platform/ops/README.md, Backups and the Controller)"
exit "$status"
