#!/bin/sh
# dispatcher-entrypoint.sh: the container's command under tini (Dockerfile.dispatcher).
# Checks the pinned claude CLI and the https origin, installs the workspace's dependencies into the
# bind-mounted clone, then execs the dispatcher so it receives tini's signals directly.
#
# Exit 78 when a check fails that no restart can fix (the wrong CLI, no clone, a non-https origin):
# dispatcher.service does not restart exit 78. A failed install exits non-zero otherwise, and systemd
# backs off and retries (a network blip). The dispatcher itself exits 78 or 1 (src/exit-code.ts).
set -eu

REPO=/srv/peanutgallery
EXIT_FATAL=78

fatal() {
  echo "dispatcher-entrypoint: $*" >&2
  exit "$EXIT_FATAL"
}

cd "$REPO" 2> /dev/null || fatal "$REPO is not mounted"
[ -d .git ] || fatal "$REPO has no .git; provision.sh clones the repository there"

wanted=${CLAUDE_CODE_VERSION:?CLAUDE_CODE_VERSION is set by the image}
reported=$(claude --version 2> /dev/null) || fatal "claude --version failed"
version=$(printf '%s\n' "$reported" | head -n 1)
case "$version" in
  "$wanted" | "$wanted "*) ;;
  *) fatal "claude --version reports '$version'; this image pins $wanted" ;;
esac

origin=$(git -c core.hooksPath=/dev/null remote get-url origin 2> /dev/null) || fatal "the clone has no origin remote"
case "$origin" in
  https://github.com/*) ;;
  *) fatal "origin is not an https github.com URL; the dispatcher fetches and pushes with an https token header" ;;
esac

# The install needs no secret, so it runs with none: the dependency scripts it runs never see the
# dispatcher's environment.
env -i PATH="$PATH" HOME="$HOME" CI=true pnpm_config_store_dir="${pnpm_config_store_dir:?set by the image}" \
  pnpm install --frozen-lockfile --prefer-offline

# The package's start script is `tsx src/main.ts`; loading tsx into node directly runs the same
# entry without a second process between tini and the dispatcher.
cd platform/dispatcher
exec node --import tsx src/main.ts
