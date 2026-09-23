#!/bin/bash
# run-dispatcher.sh: the dispatcher on the board's Mac, run by launchd as the LaunchAgent
# studio.peanutgallery.dispatcher (docs/specs/mac-host.md). It does for the Mac what
# dispatcher-entrypoint.sh and dispatcher.service do on a server:
#
# - It checks the code clone and the work clone's https origin, then runs the dispatcher from the code
#   clone the way the entrypoint does (node --import tsx src/main.ts, with the tsx cache off), with
#   DISPATCHER_CODE_READONLY=required and the three roots under ~/peanutgallery-host. The dispatcher
#   reads its .env from the code clone, and refuses to start (exit 78) when it can write to its code.
# - It holds `caffeinate -i -s` for as long as it runs, so the Mac does not idle-sleep, or sleep at all
#   while it is on power. Closing the lid still sleeps it.
# - It maps exit codes as systemd would. Exit 78, or a failed check here, is a startup failure no
#   restart can fix: it posts "Peanut Gallery dispatcher stopped on <host>: fatal startup error" to
#   ntfy and exits 0, which launchd's KeepAlive {SuccessfulExit=false} does not restart. Any other exit
#   waits 30 seconds, doubling at each failure in a row to 30 minutes at the seventh, then exits 1 so
#   launchd starts it again. A run of 10 minutes or more resets the count. The ninth start within 6
#   hours is refused with an ntfy post and exit 0, as StartLimitBurst=8 in 6 hours refuses it there.
# - launchd stops it with SIGTERM (ExitTimeOut 90 seconds); the dispatcher gets the signal and has its
#   50 seconds to stop running cards, and the wrapper exits 0.
# - Its own lines and the dispatcher's go to ~/peanutgallery-host/logs/dispatcher.log, which is rotated
#   at 10 MB, keeping three old files.
#
# State lives in ~/peanutgallery-host/state: dispatcher-starts (the start times in the last 6 hours)
# and dispatcher-failures (failures in a row). install.sh and deploy.sh clear both before a start they
# ask for. PEANUTGALLERY_HOST names another host folder (the ops tests use it).
set -euo pipefail

HOST_ROOT=${PEANUTGALLERY_HOST:-$HOME/peanutgallery-host}
STATE_DIR=$HOST_ROOT/state
LOG_DIR=$HOST_ROOT/logs
LOG=$LOG_DIR/dispatcher.log
NTFY_FILE=$HOST_ROOT/env/ntfy.url
STARTS_FILE=$STATE_DIR/dispatcher-starts
FAILURES_FILE=$STATE_DIR/dispatcher-failures
EXIT_FATAL=78
# The restart rules of dispatcher.service: RestartSec=30s growing over RestartSteps=6 to
# RestartMaxDelaySec=30min, and StartLimitBurst=8 in StartLimitIntervalSec=6h.
RESTART_BASE_SECONDS=30
RESTART_MAX_SECONDS=1800
START_LIMIT_BURST=8
START_LIMIT_INTERVAL_SECONDS=21600
HEALTHY_SECONDS=600
LOG_MAX_BYTES=10485760
LOG_KEEP=3
LOG_CHECK_SECONDS=5
STOPPING=0
CHILD=""
SLEEPER=""

# note <message>: one line of the wrapper's own in the log.
note() { printf 'run-dispatcher: %s\n' "$*"; }

# alert <message>: one post to the ntfy topic in env/ntfy.url, which install.sh writes. The URL goes to
# curl in a config file, never on its command line. Does nothing when the file is absent.
alert() {
  local url config
  [ -s "$NTFY_FILE" ] || return 0
  url=$(head -n 1 "$NTFY_FILE" | tr -d '[:space:]')
  config=$(mktemp "$STATE_DIR/ntfy.XXXXXX")
  printf 'url = "%s"\nheader = "Title: Peanut Gallery dispatcher"\ndata-binary = "%s"\noutput = "/dev/null"\n' "$url" "$1" > "$config"
  curl -fsS --max-time 20 -K "$config" || note "could not post to ntfy"
  rm -f "$config"
}

host_name() { hostname -s 2> /dev/null || hostname; }

# restart_delay <failures in a row>: the seconds to wait before the next start, 30 doubling to 1800.
restart_delay() {
  local delay=$RESTART_BASE_SECONDS step=1
  while [ "$step" -lt "$1" ] && [ "$delay" -lt "$RESTART_MAX_SECONDS" ]; do
    delay=$((delay * 2))
    step=$((step + 1))
  done
  [ "$delay" -gt "$RESTART_MAX_SECONDS" ] && delay=$RESTART_MAX_SECONDS
  echo "$delay"
}

# record_start <now>: keeps the start times of the last 6 hours and adds this one. Returns 1, adding
# nothing, when 8 starts are already in the window.
record_start() {
  local now=$1 kept count=0 line
  kept=$(mktemp "$STATE_DIR/starts.XXXXXX")
  if [ -f "$STARTS_FILE" ]; then
    while IFS= read -r line; do
      case "$line" in '' | *[!0-9]*) continue ;; esac
      if [ "$line" -gt $((now - START_LIMIT_INTERVAL_SECONDS)) ]; then
        echo "$line" >> "$kept"
        count=$((count + 1))
      fi
    done < "$STARTS_FILE"
  fi
  if [ "$count" -ge "$START_LIMIT_BURST" ]; then
    mv "$kept" "$STARTS_FILE"
    return 1
  fi
  echo "$now" >> "$kept"
  mv "$kept" "$STARTS_FILE"
}

# failures_after <seconds the run lasted>: the failures in a row, counting this one. A run of
# HEALTHY_SECONDS or more starts the count again.
failures_after() {
  local previous=0
  if [ "$1" -lt "$HEALTHY_SECONDS" ] && [ -f "$FAILURES_FILE" ]; then
    previous=$(head -n 1 "$FAILURES_FILE")
    case "$previous" in '' | *[!0-9]*) previous=0 ;; esac
  fi
  echo $((previous + 1))
}

# rotate_log: when the log is over LOG_MAX_BYTES, copies it to .1 (shifting older copies up to
# LOG_KEEP) and empties it in place. The dispatcher's output is opened for appending, so it carries on
# at the start of the emptied file.
rotate_log() {
  local size index
  [ -f "$LOG" ] || return 0
  size=$(wc -c < "$LOG" | tr -d ' ')
  [ "$size" -gt "$LOG_MAX_BYTES" ] || return 0
  index=$LOG_KEEP
  while [ "$index" -gt 1 ]; do
    [ -f "$LOG.$((index - 1))" ] && mv -f "$LOG.$((index - 1))" "$LOG.$index"
    index=$((index - 1))
  done
  cp "$LOG" "$LOG.1"
  : > "$LOG"
}

# check_layout: the entrypoint's checks. Prints the problem and returns 1 when one fails: none of them
# changes on a restart.
check_layout() {
  local code=$1 repo=$2 origin
  [ -f "$code/platform/dispatcher/src/main.ts" ] || { echo "$code has no dispatcher; install.sh clones the code clone there"; return 1; }
  [ -d "$code/node_modules" ] || { echo "$code has no node_modules; install.sh and deploy.sh install them"; return 1; }
  [ -f "$code/.env" ] || { echo "$code has no .env; install.sh copies env/dispatcher.env there"; return 1; }
  [ -d "$repo/.git" ] || { echo "$repo has no .git; install.sh clones the work clone there"; return 1; }
  origin=$(git -C "$repo" -c core.fsmonitor=false -c core.hooksPath=/dev/null remote get-url origin 2> /dev/null) || { echo "the work clone has no origin remote"; return 1; }
  case "$origin" in
    https://github.com/*) ;;
    *)
      echo "origin is not an https github.com URL; the dispatcher fetches and pushes with an https token header"
      return 1
      ;;
  esac
  command -v caffeinate > /dev/null 2>&1 || { echo "caffeinate is not on PATH; without it the Mac sleeps"; return 1; }
  command -v node > /dev/null 2>&1 || { echo "node is not on PATH; install.sh writes the PATH into the LaunchAgent"; return 1; }
}

# stop_fatal <reason>: a startup failure no restart can fix.
stop_fatal() {
  note "stopped: fatal startup error: $1"
  alert "Peanut Gallery dispatcher stopped on $(host_name): fatal startup error"
  rm -f "$FAILURES_FILE"
  exit 0
}

on_stop() {
  STOPPING=1
  [ -n "$CHILD" ] && kill -TERM "$CHILD" 2> /dev/null
  [ -n "$SLEEPER" ] && kill "$SLEEPER" 2> /dev/null
  return 0
}

# pause_for <seconds>: a sleep a stop signal cuts short.
pause_for() {
  sleep "$1" &
  SLEEPER=$!
  wait "$SLEEPER" 2> /dev/null || true
  SLEEPER=""
}

main() {
  local code repo worktrees now started status=0 ran failures delay problem
  mkdir -p "$STATE_DIR" "$LOG_DIR"
  chmod 700 "$STATE_DIR" "$LOG_DIR"
  rotate_log
  exec >> "$LOG" 2>&1
  trap on_stop TERM INT

  now=$(date +%s)
  if ! record_start "$now"; then
    note "stopped: $START_LIMIT_BURST starts in 6 hours; fix the cause, then clear $STARTS_FILE and start it again (platform/ops/README.md, The Mac host)"
    alert "Peanut Gallery dispatcher stopped on $(host_name): $START_LIMIT_BURST starts in 6 hours"
    exit 0
  fi

  code=$(cd "$HOST_ROOT/code" 2> /dev/null && pwd -P) || stop_fatal "$HOST_ROOT/code is missing; run install.sh"
  repo=$HOST_ROOT/work
  worktrees=$HOST_ROOT/work-worktrees
  if ! problem=$(check_layout "$code" "$repo"); then
    stop_fatal "$problem"
  fi

  # Held until this wrapper exits, however it exits.
  caffeinate -i -s -w "$$" &

  note "start $now"
  started=$(date +%s)
  (
    cd "$code/platform/dispatcher"
    exec env -i PATH="$PATH" HOME="$HOME" USER="${USER:-}" TMPDIR="${TMPDIR:-/tmp}" LANG=en_US.UTF-8 \
      DISPATCHER_CODE_ROOT="$code" DISPATCHER_REPO_ROOT="$repo" DISPATCHER_WORKTREE_ROOT="$worktrees" \
      DISPATCHER_CODE_READONLY=required TSX_DISABLE_CACHE=1 \
      node --import tsx src/main.ts
  ) &
  CHILD=$!
  while kill -0 "$CHILD" 2> /dev/null; do
    if [ "$STOPPING" = 1 ]; then pause_for 1; else pause_for "$LOG_CHECK_SECONDS"; fi
    rotate_log
  done
  wait "$CHILD" || status=$?
  CHILD=""
  ran=$(($(date +%s) - started))

  if [ "$STOPPING" = 1 ]; then
    note "stopped by launchd; the dispatcher exited $status"
    exit 0
  fi
  if [ "$status" = "$EXIT_FATAL" ]; then
    stop_fatal "the dispatcher exited $EXIT_FATAL; its last lines above say why"
  fi
  failures=$(failures_after "$ran")
  echo "$failures" > "$FAILURES_FILE"
  delay=$(restart_delay "$failures")
  note "the dispatcher exited $status after ${ran}s; failure $failures in a row; starting again in ${delay}s"
  pause_for "$delay"
  if [ "$STOPPING" = 1 ]; then
    note "stopped by launchd while waiting to start again"
    exit 0
  fi
  exit 1
}

# RUN_DISPATCHER_SOURCE_ONLY=1 loads the functions without running anything (the ops tests use it).
if [ "${RUN_DISPATCHER_SOURCE_ONLY:-}" != 1 ]; then
  main "$@"
fi
