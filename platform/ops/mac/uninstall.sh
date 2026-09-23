#!/bin/bash
# uninstall.sh: stops the Mac host (docs/specs/mac-host.md): unloads the dispatcher's and the three
# jobs' LaunchAgents and removes their files from ~/Library/LaunchAgents, so nothing starts at the
# next login. Run from the board's checkout, as the board's own user. Pause from /board first:
# stopping sends each running card session an interrupt and meters it, as a server's stop does, but a
# card mid-merge is better left to finish.
#   platform/ops/mac/uninstall.sh
#
# It leaves ~/peanutgallery-host as it is, env files and backups' run folder included, and prints how
# to remove it. It is the step before moving the dispatcher to a server, where only one dispatcher may
# run: the lease keeps a second one from ticking, and this keeps it from starting.
set -euo pipefail

# shellcheck source=/dev/null
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

say() { printf 'uninstall: %s\n' "$*"; }
die() {
  printf 'uninstall: stopped: %s\n' "$*" >&2
  exit 1
}

main() {
  local job label changes=0
  [ "$#" -eq 0 ] || die "usage: platform/ops/mac/uninstall.sh"
  [ "$(uname -s)" = Darwin ] || die "this is the Mac host's uninstaller"
  [ "$(id -u)" -ne 0 ] || die "run as your own user, not root"
  refuse_inside_host "${BASH_SOURCE[0]}" || die "run this from your own checkout, never from $HOST_ROOT"
  for job in dispatcher $MAC_JOBS; do
    if [ "$job" = dispatcher ]; then label=$DISPATCHER_LABEL; else label=$(job_label "$job"); fi
    if agent_loaded "$label"; then
      launchctl bootout "$(gui_target)/$label" || die "launchctl could not stop $label"
      say "stopped $label"
      changes=$((changes + 1))
    fi
    if [ -f "$AGENTS_DIR/$label.plist" ]; then
      rm -f "$AGENTS_DIR/$label.plist"
      say "removed $AGENTS_DIR/$label.plist"
      changes=$((changes + 1))
    fi
  done
  say "done: $changes change(s). $HOST_ROOT is left as it is; it holds the env files with the host's secrets."
  say "to remove it: chmod -R u+w $HOST_ROOT/code && rm -rf $HOST_ROOT (then revoke the host's GitHub token if no server takes it over)"
}

main "$@"
