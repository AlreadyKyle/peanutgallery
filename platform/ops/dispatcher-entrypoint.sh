#!/bin/sh
# dispatcher-entrypoint.sh: the container's command under tini (Dockerfile.dispatcher).
# Checks the code clone and the work clone's https origin, then execs the dispatcher from the code
# clone so it receives tini's signals directly. No agent runs in this container: unattended cards
# run as Claude Managed Agents sessions (docs/specs/launch-managed.md).
#
# The dispatcher's code and node_modules come from the root-owned code clone, mounted read-only at
# /opt/peanutgallery; deploy.sh installs node_modules there in a throwaway container with no secret.
# Nothing is installed here, and nothing runs from the work clone at /srv/peanutgallery, which uid
# 10001 and agent-written code can write to (docs/specs/ops-separation.md).
#
# Exit 78 when a check fails that no restart can fix (a missing clone, a non-https origin):
# dispatcher.service does not restart exit 78. The dispatcher itself exits 78 or 1
# (src/exit-code.ts), 78 among others when its code root is writable.
set -eu

CODE=${DISPATCHER_CODE_ROOT:-/opt/peanutgallery}
REPO=${DISPATCHER_REPO_ROOT:-/srv/peanutgallery}
EXIT_FATAL=78

fatal() {
  echo "dispatcher-entrypoint: $*" >&2
  exit "$EXIT_FATAL"
}

[ -f "$CODE/platform/dispatcher/src/main.ts" ] || fatal "$CODE has no dispatcher; dispatcher.service mounts the code clone there"
[ -d "$CODE/node_modules" ] || fatal "$CODE has no node_modules; deploy.sh installs them"
[ -d "$REPO/.git" ] || fatal "$REPO has no .git; provision.sh clones the work clone there"

origin=$(git -C "$REPO" -c core.fsmonitor=false -c core.hooksPath=/dev/null remote get-url origin 2> /dev/null) || fatal "the work clone has no origin remote"
case "$origin" in
  https://github.com/*) ;;
  *) fatal "origin is not an https github.com URL; the dispatcher fetches and pushes with an https token header" ;;
esac

# tsx keeps a transform cache in the temp folder, which the code clone's read-only mount does not
# cover. With the cache off every module is compiled from the read-only code clone.
TSX_DISABLE_CACHE=1
export TSX_DISABLE_CACHE

# The package's start script is `tsx src/main.ts`; loading tsx into node directly runs the same
# entry without a second process between tini and the dispatcher.
cd "$CODE/platform/dispatcher" || fatal "$CODE/platform/dispatcher is not readable"
exec node --import tsx src/main.ts
