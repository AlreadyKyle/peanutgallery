#!/usr/bin/env bash
# make-jobs-env.sh: writes the jobs' env files on the Mac (docs/specs/money-safety.md): backup.env,
# controller.env and quota.env for a server, each with only its own job's keys, at mode 0600, and
# backup-mac.env for the Mac host when asked for by name (docs/specs/mac-host.md). It prints key names,
# never values. A job whose keys are not all set yet is refused and named; the others are still
# written.
#
# usage, at the repository root, with the values from .env.vps exported:
#   export NTFY_TOPIC_URL=...           # the ntfy topic URL
#   export BACKUP_HEALTHCHECK_URL=...   # the healthchecks.io ping URL of the backup check
#   export VPS_GITHUB_TOKEN=...         # the dispatcher's token; its Plan read feeds the quota check
#   platform/ops/make-jobs-env.sh [backup|backup-mac|controller|quota ...]
# With no job named it writes the server's three. CONTROLLER_HEALTHCHECK_URL and QUOTA_HEALTHCHECK_URL
# are copied when exported. The files go to a new temporary folder, or to JOBS_ENV_DIR when it names an
# existing folder only its owner can open (the Mac host's ~/peanutgallery-host/env). DOTENV names
# another .env to read (default: .env at the repository root). The transform is jobs-env.mjs.
set -euo pipefail

OPS_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$OPS_DIR/../.." && pwd)
DOTENV=${DOTENV:-$REPO_ROOT/.env}

for job in "$@"; do
  case "$job" in backup | backup-mac | controller | quota) ;; *)
    echo "usage: platform/ops/make-jobs-env.sh [backup|backup-mac|controller|quota ...]" >&2
    exit 2
    ;;
  esac
done
[ -f "$DOTENV" ] || { echo "make-jobs-env: $DOTENV not found" >&2; exit 1; }
command -v node > /dev/null 2>&1 || { echo "make-jobs-env: node is not on PATH" >&2; exit 1; }

umask 077
if [ -n "${JOBS_ENV_DIR:-}" ]; then
  OUT=$JOBS_ENV_DIR
  if [ ! -d "$OUT" ] || [ -L "$OUT" ] || [ ! -O "$OUT" ]; then
    echo "make-jobs-env: JOBS_ENV_DIR must be an existing folder you own, not a symlink" >&2
    exit 1
  fi
  for bit in 001 002 004 010 020 040; do
    if [ -n "$(find "$OUT" -maxdepth 0 -perm "-$bit" -print)" ]; then
      echo "make-jobs-env: JOBS_ENV_DIR must be open to its owner only (chmod 700)" >&2
      exit 1
    fi
  done
  status=0
  node "$OPS_DIR/jobs-env.mjs" "$DOTENV" "$OUT" "$@" || status=$?
  exit "$status"
fi
OUT=$(mktemp -d "${TMPDIR:-/tmp}/peanutgallery-jobs-env.XXXXXX")
status=0
node "$OPS_DIR/jobs-env.mjs" "$DOTENV" "$OUT" "$@" || status=$?
if [ -z "$(find "$OUT" -mindepth 1 -print -quit)" ]; then
  rmdir "$OUT"
  exit "$status"
fi
echo "next: scp each file to root@<vps-ip>:/etc/peanutgallery/, then delete $OUT (platform/ops/README.md, Backups and the Controller)"
exit "$status"
