#!/bin/bash
# run-dispatcher.sh: the dispatcher on GitHub Actions, run by .github/workflows/dispatcher.yml
# (docs/specs/actions-host.md). It does for one Actions run what run-dispatcher.sh does on the Mac and
# dispatcher-entrypoint.sh on a server:
#
# - The code clone is the workflow's checkout of main at the run's sha ($GITHUB_WORKSPACE), with
#   node_modules already installed by an earlier step that holds no secret. This script writes the
#   dispatcher's env file from DISPATCHER_ENV (the environment secret holding the text
#   make-dispatcher-env.sh writes), checks it with provision.sh's check_env_lines, copies it to the
#   code clone's .env, checks that the dispatcher's dotenv reads it as written, and then makes the whole
#   checkout read-only (chmod -R a-w), so DISPATCHER_CODE_READONLY=required passes.
# - The work clone is a fresh https clone of main under $RUNNER_TEMP/host/work, made with the env
#   file's GITHUB_TOKEN through a one-off header, never on a command line or in .git/config; card
#   worktrees go in $RUNNER_TEMP/host/work-worktrees.
# - It runs node --import tsx src/main.ts from the code clone with only PATH, HOME, USER, TMPDIR and
#   LANG from its environment, the three roots, DISPATCHER_CODE_READONLY=required, TSX_DISABLE_CACHE=1
#   and DISPATCHER_DRAIN_AT: the run's start plus DRAIN_AFTER_MINUTES (300). From then the dispatcher
#   claims nothing and exits 0 once nothing it started is running. At the run's start plus
#   HARD_STOP_AFTER_MINUTES (350) it gets SIGTERM, which interrupts, meters and archives a running
#   session (recovery pauses that card at the next start), and SIGKILL 90 seconds later.
# - Actions logs are public, so the dispatcher's output goes to $RUNNER_TEMP/host/logs/dispatcher.log
#   only, which the workflow encrypts with age before it uploads it. The public log gets this script's
#   own lines and a fixed line per lifecycle message (lifecycle_lines), never a field of the log.
# - It writes to $GITHUB_OUTPUT: status (the dispatcher's exit), fatal, drained, hard_stopped, ran
#   (seconds), redispatch (whether the workflow starts the next run now) and alerted. Exit 78, or a
#   failed check here, is fatal: ntfy hears "fatal startup error" and nothing starts the next run until
#   the board does. A drained run, a hard stop, or any run of HEALTHY_SECONDS or more starts the next
#   one now; a shorter failed run is left to the workflow's 30-minute schedule, which is the restart
#   delay, and ntfy hears of it.
#
# usage: run-dispatcher.sh run | run-dispatcher.sh notify <message>
# ACTIONS_HOST_SOURCE_ONLY=1 loads the functions without running anything (the ops tests use it).
set -euo pipefail

OPS_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
EXIT_FATAL=78
DRAIN_AFTER_MINUTES=${DRAIN_AFTER_MINUTES:-300}
HARD_STOP_AFTER_MINUTES=${HARD_STOP_AFTER_MINUTES:-350}
KILL_AFTER_SECONDS=90
HEALTHY_SECONDS=600
WATCH_SECONDS=5
HOST_DIR=${ACTIONS_HOST_DIR:-${RUNNER_TEMP:-/tmp}/host}
ENV_FILE=$HOST_DIR/env/dispatcher.env
LOG=$HOST_DIR/logs/dispatcher.log
# Only these messages reach the public log, each as a fixed line naming the message and nothing else.
LIFECYCLE='dispatcher lease held|code root is read-only|containment verified|startup probe passed|dispatcher started|dispatcher drains at|dispatcher draining|dispatcher drained|dispatcher stopped|dispatcher exited with an error|SIGTERM received; stopping|SIGINT received; stopping|another dispatcher holds the lease; waiting for it'

note() { printf 'actions-host: %s\n' "$*"; }

# output <key> <value>: one step output, when the script runs in a workflow step.
output() { [ -n "${GITHUB_OUTPUT:-}" ] && printf '%s=%s\n' "$1" "$2" >> "$GITHUB_OUTPUT"; return 0; }

# value_of <key> <file>: the last value of KEY in an env file.
value_of() { sed -n "s/^$1=//p" "$2" | tail -n 1; }

# write_env_file <file>: DISPATCHER_ENV to the file, 0600, ending in a newline. Nothing is printed.
write_env_file() {
  [ -n "${DISPATCHER_ENV:-}" ] || return 1
  mkdir -p "$(dirname "$1")"
  chmod 700 "$(dirname "$1")"
  (umask 077 && printf '%s\n' "$DISPATCHER_ENV" > "$1")
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

# check_env <file>: provision.sh's own check_env_lines, plus the drain time, which this script sets.
check_env() {
  local problems status=0
  # shellcheck disable=SC2016 # the program is in single quotes on purpose
  problems=$(PROVISION_SOURCE_ONLY=1 bash -c '. "$1"; check_env_lines "$2"' check "$OPS_DIR/provision.sh" "$1") || status=1
  if grep -q '^DISPATCHER_DRAIN_AT=' "$1"; then
    problems="${problems:+$problems
}DISPATCHER_DRAIN_AT is set by the workflow; remove it from the env file"
    status=1
  fi
  [ -n "$problems" ] && printf '%s\n' "$problems"
  return "$status"
}

# alert <message>: one post to NTFY_TOPIC_URL from the env file (or from DISPATCHER_ENV when the file
# is not written yet). The URL reaches curl in a config file, never on its command line.
alert() {
  local url="" config
  if [ -f "$ENV_FILE" ]; then
    url=$(value_of NTFY_TOPIC_URL "$ENV_FILE")
  elif [ -n "${DISPATCHER_ENV:-}" ]; then
    url=$(printf '%s\n' "$DISPATCHER_ENV" | sed -n 's/^NTFY_TOPIC_URL=//p' | tail -n 1)
  fi
  [ -n "$url" ] || { note "no NTFY_TOPIC_URL; the alert was not sent"; return 0; }
  config=$(mktemp "${RUNNER_TEMP:-/tmp}/ntfy.XXXXXX")
  printf 'url = "%s"\nheader = "Title: Mob Machine dispatcher"\ndata-binary = "%s"\noutput = "/dev/null"\n' "$url" "$1" > "$config"
  curl -fsS --max-time 20 -K "$config" || note "could not post to ntfy"
  rm -f "$config"
  output alerted true
}

# check_code <code clone>: the entrypoint's checks on the checkout.
check_code() {
  [ -f "$1/platform/dispatcher/src/main.ts" ] || { echo "$1 has no dispatcher"; return 1; }
  [ -d "$1/node_modules" ] || { echo "$1 has no node_modules; the install step makes them"; return 1; }
}

# check_dotenv <code clone>: the dispatcher's own dotenv reads every line of .env back as written,
# PRICE_TABLE_JSON as JSON with a row for MODEL_BUILDER (lib.sh's check_dotenv on the Mac). Prints key
# names only.
# shellcheck disable=SC2016 # the node program is in single quotes on purpose
check_dotenv() {
  env -i PATH="$PATH" node --input-type=module -e '
    import { createRequire } from "node:module";
    import { readFileSync } from "node:fs";
    const [code] = process.argv.slice(1);
    const require = createRequire(`${code}/platform/dispatcher/package.json`);
    const text = readFileSync(`${code}/.env`, "utf8");
    const parsed = require("dotenv").parse(text);
    const problems = [];
    let count = 0;
    for (const line of text.split("\n")) {
      if (!line || line.startsWith("#")) continue;
      const at = line.indexOf("=");
      const key = line.slice(0, at);
      count += 1;
      if (parsed[key] !== line.slice(at + 1)) problems.push(`${key} does not read back as written`);
    }
    let table = null;
    try { table = JSON.parse(parsed.PRICE_TABLE_JSON ?? ""); } catch { problems.push("PRICE_TABLE_JSON is not JSON as dotenv reads it"); }
    if (table && !Object.hasOwn(table, parsed.MODEL_BUILDER ?? "")) problems.push("MODEL_BUILDER has no row in PRICE_TABLE_JSON");
    if (problems.length > 0) { console.log(problems.join("\n")); process.exit(1); }
    console.log(`the dispatcher reads all ${count} keys of .env as written`);
  ' "$1"
}

# code_writable <code clone>: 0 when anything in it is still writable by its owner.
code_writable() { [ -n "$(find "$1" ! -type l -perm -0200 -print -quit)" ]; }

# token_header <env file>: git's https header for the file's GITHUB_TOKEN.
token_header() {
  local token
  token=$(value_of GITHUB_TOKEN "$1")
  [ -n "$token" ] || return 1
  printf 'AUTHORIZATION: basic %s' "$(printf 'x-access-token:%s' "$token" | base64 | tr -d '\n')"
}

# clone_work <env file> <folder>: a fresh clone of main from the repository's own URL, with hooks and
# fsmonitor off and the token in git's environment for this one command.
# shellcheck disable=SC2030,SC2031 # the token header is exported to one subshell's git only
clone_work() {
  local header repo
  header=$(token_header "$1") || return 1
  repo=$(value_of GITHUB_REPO "$1")
  (
    export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.https://github.com/.extraheader GIT_CONFIG_VALUE_0="$header"
    git -c core.hooksPath=/dev/null -c core.fsmonitor=false clone --quiet --branch main "https://github.com/$repo.git" "$2"
  )
  if git -C "$2" -c core.hooksPath=/dev/null -c core.fsmonitor=false config --local --get-regexp extraheader > /dev/null; then
    echo "$2/.git/config stores an extraheader"
    return 1
  fi
}

# iso_time <epoch seconds>: the UTC time as DISPATCHER_DRAIN_AT takes it (GNU date, then BSD date).
iso_time() { date -u -d "@$1" +%Y-%m-%dT%H:%M:%SZ 2> /dev/null || date -u -r "$1" +%Y-%m-%dT%H:%M:%SZ; }

# lifecycle_lines: reads dispatcher log lines on stdin and prints "dispatcher: <message>" for each one
# whose message is a lifecycle message. Only the message is printed, never another field, so nothing
# from the log's values reaches the public log.
lifecycle_lines() {
  sed -nE "s/.*\"msg\":\"($LIFECYCLE)\".*/dispatcher: \\1/p"
}

# redispatch_now <fatal> <drained> <hard stopped> <ran seconds>: whether the workflow starts the next
# run at once. Never after a fatal exit; after a drain or a hard stop, or a run of HEALTHY_SECONDS or
# more; a shorter failed run waits for the 30-minute schedule.
redispatch_now() {
  [ "$1" = true ] && { echo false; return; }
  if [ "$2" = true ] || [ "$3" = true ] || [ "$4" -ge "$HEALTHY_SECONDS" ]; then echo true; else echo false; fi
}

stop_fatal() {
  note "stopped: fatal startup error: $1"
  output fatal true
  output redispatch false
  alert "Mob Machine dispatcher stopped on GitHub Actions: fatal startup error"
  exit "$EXIT_FATAL"
}

run() {
  local code started drain_epoch stop_epoch seconds problem child status=0 seen=0 total ran drained=false hard=false redispatch
  code=$(cd "${GITHUB_WORKSPACE:?GITHUB_WORKSPACE is not set}" && pwd -P)
  started=${JOB_STARTED_AT:-$(date +%s)}
  case "$started" in '' | *[!0-9]*) stop_fatal "JOB_STARTED_AT is not epoch seconds" ;; esac
  drain_epoch=$((started + DRAIN_AFTER_MINUTES * 60))
  stop_epoch=$((started + HARD_STOP_AFTER_MINUTES * 60))

  write_env_file "$ENV_FILE" || stop_fatal "DISPATCHER_ENV is empty; set the environment secret (platform/ops/README.md, The GitHub Actions host)"
  mask_values "$ENV_FILE"
  if ! problem=$(check_env "$ENV_FILE"); then
    printf '%s\n' "$problem"
    stop_fatal "the env file is refused"
  fi
  note "the env file passes check_env_lines"
  problem=$(check_code "$code") || stop_fatal "$problem"
  (umask 077 && cp "$ENV_FILE" "$code/.env")
  problem=$(check_dotenv "$code") || { printf '%s\n' "$problem"; stop_fatal "the dispatcher's dotenv does not read .env as written"; }
  note "$problem"
  chmod -R a-w "$code"
  if code_writable "$code"; then stop_fatal "the code clone is still writable after chmod -R a-w"; fi
  note "the code clone is read-only"

  mkdir -p "$HOST_DIR/logs"
  problem=$(clone_work "$ENV_FILE" "$HOST_DIR/work") || stop_fatal "the work clone failed: $problem"
  mkdir -p "$HOST_DIR/work-worktrees"
  chmod 700 "$HOST_DIR/work-worktrees"
  note "the work clone is at main $(git -C "$HOST_DIR/work" -c core.hooksPath=/dev/null -c core.fsmonitor=false rev-parse --short=12 HEAD)"

  seconds=$((stop_epoch - $(date +%s)))
  [ "$seconds" -gt 60 ] || stop_fatal "the run has no time left before its hard stop"
  note "start; drains at $(iso_time "$drain_epoch"), hard stop at $(iso_time "$stop_epoch")"
  : > "$LOG"
  chmod 600 "$LOG"
  (
    cd "$code/platform/dispatcher"
    exec timeout --preserve-status --signal=TERM --kill-after="$KILL_AFTER_SECONDS" "$seconds" \
      env -i PATH="$PATH" HOME="$HOME" USER="${USER:-runner}" TMPDIR="${RUNNER_TEMP:-/tmp}" LANG=C.UTF-8 \
      DISPATCHER_CODE_ROOT="$code" DISPATCHER_REPO_ROOT="$HOST_DIR/work" DISPATCHER_WORKTREE_ROOT="$HOST_DIR/work-worktrees" \
      DISPATCHER_CODE_READONLY=required TSX_DISABLE_CACHE=1 DISPATCHER_DRAIN_AT="$(iso_time "$drain_epoch")" \
      node --import tsx src/main.ts
  ) >> "$LOG" 2>&1 &
  child=$!
  # The lifecycle lines, as they arrive.
  while kill -0 "$child" 2> /dev/null; do
    sleep "$WATCH_SECONDS"
    total=$(wc -l < "$LOG" | tr -d ' ')
    [ "$total" -gt "$seen" ] && sed -n "$((seen + 1)),${total}p" "$LOG" | lifecycle_lines
    seen=$total
  done
  wait "$child" || status=$?
  sed -n "$((seen + 1)),\$p" "$LOG" | lifecycle_lines
  ran=$(($(date +%s) - started))
  grep -q '"msg":"dispatcher drained"' "$LOG" && drained=true
  [ "$(date +%s)" -ge "$stop_epoch" ] && [ "$drained" = false ] && hard=true
  note "the dispatcher exited $status after ${ran}s of the run (drained=$drained, hard_stopped=$hard)"
  output status "$status"
  output drained "$drained"
  output hard_stopped "$hard"
  output ran "$ran"
  [ "$status" = "$EXIT_FATAL" ] && stop_fatal "the dispatcher exited $EXIT_FATAL; the encrypted log says why"
  output fatal false
  redispatch=$(redispatch_now false "$drained" "$hard" "$ran")
  output redispatch "$redispatch"
  if [ "$hard" = true ]; then
    alert "Mob Machine dispatcher reached its hard stop on GitHub Actions with work still running; recovery pauses that card at the next start"
  elif [ "$status" != 0 ]; then
    alert "Mob Machine dispatcher exited $status on GitHub Actions after ${ran}s; the next run starts it again"
    exit 1
  fi
  exit 0
}

main() {
  case "${1:-}" in
    run) run ;;
    notify) alert "${2:?notify needs a message}" ;;
    *)
      echo "usage: run-dispatcher.sh run | notify <message>" >&2
      exit 2
      ;;
  esac
}

if [ "${ACTIONS_HOST_SOURCE_ONLY:-}" != 1 ]; then
  main "$@"
fi
