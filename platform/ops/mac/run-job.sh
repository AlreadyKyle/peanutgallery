#!/bin/bash
# run-job.sh: the daily jobs on the board's Mac (docs/specs/mac-host.md), run by the LaunchAgents
# studio.peanutgallery.backup, .controller and .quota:
#   run-job.sh backup|controller|quota [--now]
#
# launchd's calendar runs in the Mac's local time, which moves with daylight saving and travel, so
# each LaunchAgent wakes this script once an hour, at its job's minute, and the script decides: a job
# runs once per UTC day, at the first wake at or after its time, the same UTC times as the server's
# timers (backup 06:17, the Controller 07:07, the quota check 07:37). When the Mac was asleep, launchd
# runs one missed wake as soon as it wakes, so a day the Mac slept through its time is made up then,
# as the timers' Persistent= makes it up at boot. A run is recorded when it starts, so a failed run is
# not retried until the next UTC day, as on a server; --now runs it at once whatever the day.
#
# - controller and quota: `node --env-file=env/<job>.env platform/ops/jobs/main.mjs <job>` from the
#   code clone, after the file passes platform/ops/jobs/check-env.mjs. Each env file is 0600 and holds
#   only its own job's keys (make-jobs-env.sh).
# - backup: platform/ops/mac/backup-mac.sh with env/backup-mac.env.
#
# A job that fails posts "Mob Machine job <job> failed on <host>" to ntfy, as
# peanutgallery-job-alert@.service does. Output goes to ~/peanutgallery-host/logs/<job>.log, rotated at
# 5 MB. PEANUTGALLERY_HOST names another host folder (the ops tests use it).
set -euo pipefail

HOST_ROOT=${PEANUTGALLERY_HOST:-$HOME/peanutgallery-host}
ENV_DIR=$HOST_ROOT/env
STATE_DIR=$HOST_ROOT/state
LOG_DIR=$HOST_ROOT/logs
NTFY_FILE=$ENV_DIR/ntfy.url
LOG_MAX_BYTES=5242880
USAGE="usage: run-job.sh backup|controller|quota [--now]"
LOCK=""

# job_time <job>: the job's UTC time, HH:MM, the same as its systemd timer's OnCalendar.
job_time() {
  case "$1" in
    backup) echo 06:17 ;;
    controller) echo 07:07 ;;
    quota) echo 07:37 ;;
    *) return 1 ;;
  esac
}

# minutes_of <HH:MM>: minutes since midnight.
minutes_of() {
  local hours=${1%%:*} minutes=${1##*:}
  echo $((10#$hours * 60 + 10#$minutes))
}

# is_due <job> <UTC date> <UTC HH:MM> <date of the last run, or empty>: 0 when the job has not run on
# that UTC day and its time has come.
is_due() {
  local time
  time=$(job_time "$1") || return 1
  [ "$4" != "$2" ] && [ "$(minutes_of "$3")" -ge "$(minutes_of "$time")" ]
}

# file_mode <file>: the permission bits in octal, on macOS and on Linux.
file_mode() {
  if [ "$(uname -s)" = Darwin ]; then stat -f '%Lp' "$1"; else stat -c '%a' "$1"; fi
}

host_name() { hostname -s 2> /dev/null || hostname; }

# alert <message>: one post to the ntfy topic in env/ntfy.url, through a curl config file.
alert() {
  local url config
  [ -s "$NTFY_FILE" ] || return 0
  url=$(head -n 1 "$NTFY_FILE" | tr -d '[:space:]')
  config=$(mktemp "$STATE_DIR/ntfy.XXXXXX")
  printf 'url = "%s"\nheader = "Title: Mob Machine job"\ndata-binary = "%s"\noutput = "/dev/null"\n' "$url" "$1" > "$config"
  curl -fsS --max-time 20 -K "$config" || echo "run-job: could not post to ntfy"
  rm -f "$config"
}

# check_env_file <file>: exists, is the owner's, and is 0600.
check_env_file() {
  if [ ! -f "$1" ]; then
    echo "$1 is missing; write it with make-jobs-env.sh (platform/ops/README.md, The Mac host)"
    return 1
  fi
  if [ ! -O "$1" ] || [ "$(file_mode "$1")" != 600 ]; then
    echo "$1 must be yours with mode 0600"
    return 1
  fi
}

# run_job <job> <code clone>: runs one job with only PATH and HOME from this environment.
run_job() {
  local job=$1 code=$2 file problems
  case "$job" in
    backup)
      file=$ENV_DIR/backup-mac.env
      check_env_file "$file" || return 1
      env -i PATH="$PATH" HOME="$HOME" BACKUP_ENV_FILE="$file" BACKUP_STATE_DIR="$STATE_DIR/backup" \
        bash "$code/platform/ops/mac/backup-mac.sh"
      ;;
    controller | quota)
      file=$ENV_DIR/$job.env
      check_env_file "$file" || return 1
      if ! problems=$(env -i PATH="$PATH" HOME="$HOME" node "$code/platform/ops/jobs/check-env.mjs" "$job" "$file"); then
        echo "$file:"
        echo "$problems"
        return 1
      fi
      env -i PATH="$PATH" HOME="$HOME" node --env-file="$file" "$code/platform/ops/jobs/main.mjs" "$job"
      ;;
  esac
}

main() {
  local job=${1:-} force=0 log today now last code status=0 holder
  job_time "$job" > /dev/null 2>&1 || { echo "$USAGE" >&2; exit 2; }
  case "${2:-}" in
    --now) force=1 ;;
    '') ;;
    *) echo "$USAGE" >&2; exit 2 ;;
  esac
  [ "$#" -le 2 ] || { echo "$USAGE" >&2; exit 2; }
  mkdir -p "$STATE_DIR" "$LOG_DIR"
  chmod 700 "$STATE_DIR" "$LOG_DIR"

  today=$(date -u +%Y-%m-%d)
  now=$(date -u +%H:%M)
  last=$(head -n 1 "$STATE_DIR/job-$job.last" 2> /dev/null || true)
  if [ "$force" = 0 ] && ! is_due "$job" "$today" "$now" "$last"; then
    exit 0
  fi
  # One run of a job at a time: a wake that finds the last run still going leaves it alone. A lock
  # whose process is gone (the Mac lost power mid-run) is taken over.
  if ! mkdir "$STATE_DIR/job-$job.lock" 2> /dev/null; then
    holder=$(head -n 1 "$STATE_DIR/job-$job.lock/pid" 2> /dev/null || true)
    if [ -n "$holder" ] && kill -0 "$holder" 2> /dev/null; then exit 0; fi
    rm -rf "$STATE_DIR/job-$job.lock"
    mkdir "$STATE_DIR/job-$job.lock" 2> /dev/null || exit 0
  fi
  LOCK=$STATE_DIR/job-$job.lock
  echo "$$" > "$LOCK/pid"
  trap 'rm -rf "$LOCK"' EXIT

  log=$LOG_DIR/$job.log
  if [ -f "$log" ] && [ "$(wc -c < "$log" | tr -d ' ')" -gt "$LOG_MAX_BYTES" ]; then
    mv -f "$log" "$log.1"
  fi
  exec >> "$log" 2>&1
  echo "$today" > "$STATE_DIR/job-$job.last"
  echo "run-job: $job at $today $now UTC"

  if ! code=$(cd "$HOST_ROOT/code" 2> /dev/null && pwd -P); then
    echo "run-job: $HOST_ROOT/code is missing; run install.sh"
    status=1
  else
    run_job "$job" "$code" || status=$?
  fi
  if [ "$status" -ne 0 ]; then
    echo "run-job: $job failed with exit $status"
    alert "Mob Machine job $job failed on $(host_name); see $log"
    exit "$status"
  fi
  echo "run-job: $job done"
}

# RUN_JOB_SOURCE_ONLY=1 loads the functions without running anything (the ops tests use it).
if [ "${RUN_JOB_SOURCE_ONLY:-}" != 1 ]; then
  main "$@"
fi
