#!/usr/bin/env bash
# push-secrets.sh: rebuilds the dispatcher's and the quota check's env files from .env and .env.vps on
# the Mac and sets them as the Actions secrets DISPATCHER_ENV (environment dispatcher) and QUOTA_ENV
# (environment ops), in one command a session can be allowed to run. It prints key names and secret
# names, never values, and deletes the env files it wrote.
#
# usage, at the repository root:
#   platform/ops/push-secrets.sh [--dry-run] [--restart]
# --dry-run writes and checks the files but sets nothing. --restart then starts a new dispatcher.yml
# run on main (cancel an in-progress run first: gh run list --workflow dispatcher.yml --status in_progress).
# VPS_ENV names another env file to export (default: .env.vps at the repository root); DOTENV is passed
# through to the make-* scripts.
set -euo pipefail

OPS_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$OPS_DIR/../.." && pwd)
VPS_ENV=${VPS_ENV:-$REPO_ROOT/.env.vps}
REPO=AlreadyKyle/peanutgallery

usage() {
  echo "usage: platform/ops/push-secrets.sh [--dry-run] [--restart]" >&2
  exit 2
}

DRY_RUN=0
RESTART=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --restart) RESTART=1 ;;
    *) usage ;;
  esac
done
[ -f "$VPS_ENV" ] || { echo "push-secrets: $VPS_ENV not found" >&2; exit 1; }
command -v gh > /dev/null 2>&1 || { echo "push-secrets: gh is not on PATH" >&2; exit 1; }

umask 077
WORK=$(mktemp -d "${TMPDIR:-/tmp}/peanutgallery-secrets.XXXXXX")
trap 'rm -rf "$WORK"' EXIT

set -a
# shellcheck disable=SC1090
. "$VPS_ENV"
set +a

"$OPS_DIR/make-dispatcher-env.sh" "$WORK/dispatcher.env" > /dev/null
JOBS_ENV_DIR=$WORK "$OPS_DIR/make-jobs-env.sh" quota > /dev/null
for f in dispatcher.env quota.env; do
  [ -s "$WORK/$f" ] || { echo "push-secrets: $f was not written" >&2; exit 1; }
done

if [ "$DRY_RUN" -eq 1 ]; then
  echo "push-secrets: dry run: would set DISPATCHER_ENV (dispatcher) and QUOTA_ENV (ops) on $REPO"
  exit 0
fi

gh secret set DISPATCHER_ENV --env dispatcher --repo "$REPO" < "$WORK/dispatcher.env"
gh secret set QUOTA_ENV --env ops --repo "$REPO" < "$WORK/quota.env"
echo "push-secrets: set DISPATCHER_ENV (dispatcher) and QUOTA_ENV (ops) on $REPO"

if [ "$RESTART" -eq 1 ]; then
  gh workflow run dispatcher.yml --ref main --repo "$REPO"
  echo "push-secrets: started dispatcher.yml; check its log for 'dispatcher: startup probe passed'"
fi
