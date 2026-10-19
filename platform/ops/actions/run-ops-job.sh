#!/bin/bash
# run-ops-job.sh: one of the daily jobs on GitHub Actions, run by .github/workflows/ops-jobs.yml
# (docs/specs/actions-host.md, docs/PLAN.md §10 decision 78): the backup, the Controller, the quota
# check or the ship notices, as the private ops repository's jobs.yml ran them until 18 October 2026.
#
# - JOB_ENV is the environment secret holding the text make-jobs-env.sh writes for this job
#   (backup-mac.env for the backup). This script writes it to a 0600 file under $RUNNER_TEMP/ops-job
#   and asks Actions to mask every value of eight characters or more. The backup's BACKUP_DIR is
#   replaced by the runner's folder, where the workflow picks up the .tar.age.
# - The backup runs mac/backup-mac.sh with the PostgreSQL 17 client, up to 3 times a minute apart. The
#   others run jobs/check-env.mjs, then node --env-file jobs/main.mjs <job>. Each runs with only PATH
#   and HOME from the runner's environment.
# - Actions logs are public, so the job's output goes to $RUNNER_TEMP/ops-job/job.log only, which the
#   workflow encrypts with age before it uploads it. The public log gets this script's own lines: the
#   job, its exit, and the first word of the job's result line (PASS or FAIL for the Controller, the
#   quota check and the notices; done for the backup), never a field of the log.
#
# usage: run-ops-job.sh backup|controller|quota|notices
# OPS_JOB_SOURCE_ONLY=1 loads the functions without running anything (the ops tests use it).
set -euo pipefail

OPS_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
JOB_DIR=${OPS_JOB_DIR:-${RUNNER_TEMP:-/tmp}/ops-job}
LOG=$JOB_DIR/job.log
PG_BIN=${OPS_JOB_PG_BIN:-/usr/lib/postgresql/17/bin}
BACKUP_ATTEMPTS=3
RETRY_SECONDS=${OPS_JOB_RETRY_SECONDS:-60}
USAGE="usage: run-ops-job.sh backup|controller|quota|notices"

note() { printf 'ops-job: %s\n' "$*"; }

# write_env_file <job> <file>: JOB_ENV to the file, 0600, ending in a newline; for the backup, with
# BACKUP_DIR set to the runner's backups folder. Nothing is printed.
write_env_file() {
  [ -n "${JOB_ENV:-}" ] || return 1
  mkdir -p "$(dirname "$2")"
  chmod 700 "$(dirname "$2")"
  if [ "$1" = backup ]; then
    (umask 077 && { printf '%s\n' "$JOB_ENV" | grep -v '^BACKUP_DIR=' || true; printf 'BACKUP_DIR=%s\n' "$JOB_DIR/backups"; } > "$2")
  else
    (umask 077 && printf '%s\n' "$JOB_ENV" > "$2")
  fi
}

# mask_values <file>: asks Actions to mask every value of eight characters or more, so a value that
# reaches the public log by any path shows as ***. The workflow command itself is not displayed.
mask_values() {
  local line value
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in '' | '#'*) continue ;; esac
    value=${line#*=}
    [ "${#value}" -ge 8 ] && printf '::add-mask::%s\n' "$value"
  done < "$1"
  return 0
}

# run_backup <env file>: backup-mac.sh, up to BACKUP_ATTEMPTS times, its output to the log.
run_backup() {
  local attempt
  mkdir -p "$JOB_DIR/backups" "$JOB_DIR/state"
  for attempt in $(seq 1 "$BACKUP_ATTEMPTS"); do
    if env -i PATH="$PATH" HOME="$HOME" BACKUP_ENV_FILE="$1" BACKUP_STATE_DIR="$JOB_DIR/state" \
      BACKUP_PG_BIN="$PG_BIN" bash "$OPS_DIR/mac/backup-mac.sh" >> "$LOG" 2>&1; then
      return 0
    fi
    note "backup attempt $attempt failed"
    [ "$attempt" = "$BACKUP_ATTEMPTS" ] || sleep "$RETRY_SECONDS"
  done
  return 1
}

# run_node_job <job> <env file>: the env check, then the job, their output to the log.
run_node_job() {
  env -i PATH="$PATH" HOME="$HOME" node "$OPS_DIR/jobs/check-env.mjs" "$1" "$2" >> "$LOG" 2>&1 || return 1
  env -i PATH="$PATH" HOME="$HOME" node --env-file="$2" "$OPS_DIR/jobs/main.mjs" "$1" >> "$LOG" 2>&1
}

# result_word <job>: the first word of the job's result line in the log (PASS or FAIL; done for the
# backup), or nothing when there is none.
result_word() {
  if [ "$1" = backup ]; then
    grep -q '^backup: done: ' "$LOG" && echo 'done'
  else
    sed -nE 's/^(PASS|FAIL): .*/\1/p' "$LOG" | head -n 1
  fi
  return 0
}

run() {
  local job=$1 env_file status=0 word
  env_file=$JOB_DIR/env/$job.env
  mkdir -p "$JOB_DIR"
  chmod 700 "$JOB_DIR"
  (umask 077 && : > "$LOG")
  note "job: $job"
  if ! write_env_file "$job" "$env_file"; then
    note "no env for $job: set its secret in the GitHub environment ops (platform/ops/README.md, The daily jobs on GitHub Actions)"
    exit 1
  fi
  mask_values "$env_file"
  if [ "$job" = backup ]; then run_backup "$env_file" || status=$?; else run_node_job "$job" "$env_file" || status=$?; fi
  rm -f "$env_file"
  word=$(result_word "$job")
  note "$job exited $status${word:+ ($word)}; the full output is in the encrypted log"
  exit "$status"
}

main() {
  case "${1:-}" in
    backup | controller | quota | notices) run "$1" ;;
    *)
      echo "$USAGE" >&2
      exit 2
      ;;
  esac
}

if [ "${OPS_JOB_SOURCE_ONLY:-}" != 1 ]; then
  main "$@"
fi
