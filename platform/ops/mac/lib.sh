#!/bin/bash
# lib.sh: what install.sh, deploy.sh and uninstall.sh share on the board's Mac
# (docs/specs/mac-host.md). Sourced from the board's checkout, never run, never run from the host's
# own code clone.
#
# It loads the server's deploy.sh functions (DEPLOY_SOURCE_ONLY=1): code_git, check_clean,
# check_code_clone, check_quiet, supabase_get, github_get, check_gate, review_target, confirm_target
# and probe_passed, the same checks the server runs, and points them at the Mac's folders.
#
# The host folder, ~/peanutgallery-host unless PEANUTGALLERY_HOST names another, outside the board's
# own checkout:
#   code/            the code clone: the dispatcher's code, node_modules, the pnpm store and the .env
#                    the dispatcher reads. Made read-only (chmod -R a-w) after every install; only
#                    install.sh and deploy.sh change it.
#   work/            the work clone (DISPATCHER_REPO_ROOT): the git state the dispatcher fetches and
#                    pushes. Nothing runs from it.
#   work-worktrees/  card worktrees (DISPATCHER_WORKTREE_ROOT).
#   env/             0700: dispatcher.env (make-dispatcher-env.sh), controller.env, quota.env and
#                    backup-mac.env (make-jobs-env.sh), ntfy.url.
#   state/           restart counts, job run dates, the backup's run folder.
#   logs/            dispatcher.log and one log per job.
# shellcheck disable=SC2034 # the variables here are read by the scripts that source this file

MAC_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
OPS_DIR=$(dirname "$MAC_DIR")
# shellcheck source=/dev/null
DEPLOY_SOURCE_ONLY=1 . "$OPS_DIR/deploy.sh"

HOST_ROOT=${PEANUTGALLERY_HOST:-$HOME/peanutgallery-host}
CODE_DIR=$HOST_ROOT/code
WORK_DIR=$HOST_ROOT/work
WORKTREE_DIR=$HOST_ROOT/work-worktrees
ENV_DIR=$HOST_ROOT/env
STATE_DIR=$HOST_ROOT/state
LOG_DIR=$HOST_ROOT/logs
DISPATCHER_LOG=$LOG_DIR/dispatcher.log
# What deploy.sh's env_value, supabase_get and github_get read: the dispatcher's own .env.
ENV_FILE=$CODE_DIR/.env
# Where the board writes it: platform/ops/make-dispatcher-env.sh ~/peanutgallery-host/env/dispatcher.env
HOST_ENV_FILE=$ENV_DIR/dispatcher.env
AGENTS_DIR=${LAUNCH_AGENTS_DIR:-$HOME/Library/LaunchAgents}
DISPATCHER_LABEL=studio.peanutgallery.dispatcher
MAC_JOBS="backup controller quota"
PROBE_WAIT_SECONDS=${PROBE_WAIT_SECONDS:-600}
# The folders the dispatcher's read-only check looks at (CODE_PATHS in platform/dispatcher/src/startup.ts).
CODE_PATHS=". node_modules node_modules/.pnpm platform/dispatcher platform/dispatcher/src platform/dispatcher/node_modules"
# The system folders a LaunchAgent's PATH ends with, after node's own folder.
BASE_PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
# git status and the like must never write the index of the read-only code clone.
export GIT_OPTIONAL_LOCKS=0

# job_minute <job>: the minute past each hour at which launchd wakes the job: the minute of its UTC time
# in run-job.sh and in its systemd timer.
job_minute() {
  case "$1" in
    backup) echo 17 ;;
    controller) echo 7 ;;
    quota) echo 37 ;;
    *) return 1 ;;
  esac
}

job_label() { echo "studio.peanutgallery.$1"; }

# launch_path: the PATH the LaunchAgents run with: node's folder first, so they run the node this
# install checked, then Homebrew's and the system's.
launch_path() {
  local node_dir
  node_dir=$(dirname "$(command -v node)")
  case ":$BASE_PATH:" in
    *":$node_dir:"*) echo "$BASE_PATH" ;;
    *) echo "$node_dir:$BASE_PATH" ;;
  esac
}

# render_plist <template file> <output file> <PATH value> [job]: fills a LaunchAgent template. Refuses
# a host folder or PATH with a character a plist or sed would need escaped.
render_plist() {
  local template=$1 out=$2 path=$3 job=${4:-} minute=""
  if ! [[ "$HOST_ROOT" =~ ^/[A-Za-z0-9._/-]+$ ]]; then
    echo "the host folder $HOST_ROOT has a character a LaunchAgent cannot carry; use letters, digits, . _ - and /"
    return 1
  fi
  if ! [[ "$path" =~ ^/[A-Za-z0-9._/:@-]+$ ]]; then
    echo "the PATH $path has a character a LaunchAgent cannot carry"
    return 1
  fi
  if [ -n "$job" ]; then
    minute=$(job_minute "$job") || {
      echo "no job named $job"
      return 1
    }
  fi
  sed -e "s|@HOST_ROOT@|$HOST_ROOT|g" -e "s|@PATH@|$path|g" -e "s|@JOB@|$job|g" -e "s|@MINUTE@|$minute|g" "$template" > "$out"
  if grep -q '@[A-Z_]*@' "$out"; then
    echo "$template has a placeholder install.sh does not fill"
    return 1
  fi
}

# gui_target: launchd's domain for this user's LaunchAgents.
gui_target() { echo "gui/$(id -u)"; }

agent_loaded() { launchctl print "$(gui_target)/$1" > /dev/null 2>&1; }

agent_disabled() { launchctl print-disabled "$(gui_target)" 2> /dev/null | grep -Eq "\"$1\" => (true|disabled)"; }

# host_git <args>: git for the clones, with no system or global configuration and hooks and fsmonitor
# off.
host_git() {
  GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_NO_REPLACE_OBJECTS=1 GIT_PAGER=cat \
    git -c core.fsmonitor=false -c core.hooksPath=/dev/null "$@"
}

# token_header <env file>: git's https header for GITHUB_TOKEN in the file. The token reaches git as
# configuration in its environment for one command, so it is on no command line and in no .git/config.
token_header() {
  local token
  token=$(sed -n 's/^GITHUB_TOKEN=//p' "$1" | tail -n 1)
  [ -n "$token" ] || return 1
  printf 'AUTHORIZATION: basic %s' "$(printf 'x-access-token:%s' "$token" | base64 | tr -d '\n')"
}

# clone_main <env file> <folder>: a fresh clone of main from the repository's own URL.
# shellcheck disable=SC2030,SC2031 # the token header is exported to one subshell's git only
clone_main() {
  local header
  header=$(token_header "$1") || return 1
  (
    export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.https://github.com/.extraheader GIT_CONFIG_VALUE_0="$header"
    host_git clone --quiet --branch main "$REPO_URL" "$2"
  )
}

# fetch_main <env file>: fetches main into the code clone's origin/main, from the repository's URL.
# shellcheck disable=SC2030,SC2031
fetch_main() {
  local header
  header=$(token_header "$1") || return 1
  (
    export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.https://github.com/.extraheader GIT_CONFIG_VALUE_0="$header"
    code_git fetch --quiet "$REPO_URL" +refs/heads/main:refs/remotes/origin/main
  )
}

unlock_code() { chmod -R u+w "$CODE_DIR"; }
lock_code() { chmod -R a-w "$CODE_DIR"; }

# code_writable: 0 when anything in the code clone is writable by its owner.
code_writable() { [ -n "$(find "$CODE_DIR" ! -type l -perm -0200 -print -quit)" ]; }

# check_readonly: the dispatcher's own startup check, run here first: each folder it looks at exists,
# denies write access, and refuses a new file. Prints one line per problem and returns 1 when there is
# any.
check_readonly() {
  local relative folder probe problems=0
  for relative in $CODE_PATHS; do
    folder=$CODE_DIR/$relative
    if [ ! -d "$folder" ]; then
      echo "$relative is missing from the code clone"
      problems=1
      continue
    fi
    if [ -w "$folder" ]; then
      echo "$relative is writable"
      problems=1
      continue
    fi
    probe="$folder/.install-readonly-check-$$"
    if (: > "$probe") 2> /dev/null; then
      rm -f "$probe"
      echo "$relative accepts a new file"
      problems=1
    fi
  done
  [ "$problems" = 0 ]
}

# run_pnpm_install: pnpm install --frozen-lockfile into the code clone, with no secret in its
# environment and a HOME of its own, so no .npmrc token of the board's is read. The pnpm store sits in
# the code clone, as on a server, so node_modules' hard links stay inside what lock_code makes
# read-only.
run_pnpm_install() {
  mkdir -p "$STATE_DIR/pnpm-home"
  (
    cd "$CODE_DIR" || exit 1
    env -i PATH="$(launch_path)" HOME="$STATE_DIR/pnpm-home" CI=true TMPDIR="${TMPDIR:-/tmp}" \
      pnpm_config_store_dir="$CODE_DIR/.pnpm-store" \
      pnpm install --frozen-lockfile --prefer-offline
  )
}

# check_dotenv: reads the code clone's .env with the dispatcher's own dotenv, as main.ts does, and
# checks that every line reads back as written (PRICE_TABLE_JSON included, as one line of JSON with a
# row for MODEL_BUILDER). Prints key names only.
# shellcheck disable=SC2016 # the node program is in single quotes on purpose
check_dotenv() {
  env -i PATH="$(launch_path)" node --input-type=module -e '
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
  ' "$CODE_DIR"
}

reset_dispatcher_state() { rm -f "$STATE_DIR/dispatcher-starts" "$STATE_DIR/dispatcher-failures"; }

# lines_since_start <log file> <epoch>: the log lines after the last "run-dispatcher: start <time>" line
# whose time is at or after the epoch, including it; nothing when there is none yet.
lines_since_start() {
  [ -f "$1" ] || return 0
  awk -v since="$2" '
    /^run-dispatcher: start [0-9]+$/ { if ($3 + 0 >= since + 0) { buffer = $0 "\n"; started = 1; next } }
    started { buffer = buffer $0 "\n" }
    END { printf "%s", buffer }
  ' "$1"
}

# wait_for_start <epoch before the start>: waits for this start's `code root is read-only` line
# followed by its `startup probe passed` line, as deploy.sh does on a server. Lines from before the
# start never count. Stops at once when the wrapper stopped the dispatcher for good.
wait_for_start() {
  local since=$1 deadline lines
  deadline=$(($(date +%s) + PROBE_WAIT_SECONDS))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    lines=$(lines_since_start "$DISPATCHER_LOG" "$since")
    if [ -n "$lines" ]; then
      if probe_passed "$lines"; then
        grep -F -e '"msg":"code root is read-only"' -e '"msg":"startup probe passed"' <<< "$lines"
        return 0
      fi
      if grep -q '^run-dispatcher: stopped' <<< "$lines"; then
        tail -n 20 <<< "$lines"
        echo "the dispatcher stopped at startup and will not restart; see the lines above and $DISPATCHER_LOG"
        return 1
      fi
    fi
    sleep 5
  done
  tail -n 50 "$DISPATCHER_LOG" 2> /dev/null || true
  echo "no 'code root is read-only' then 'startup probe passed' within $PROBE_WAIT_SECONDS seconds; see $DISPATCHER_LOG"
  return 1
}

# refuse_inside_host <script path>: the scripts run from the board's checkout, never from the host's
# code clone, which they change.
refuse_inside_host() {
  local here root
  here=$(cd "$(dirname "$1")" && pwd -P)
  root=$(cd "$HOST_ROOT" 2> /dev/null && pwd -P) || return 0
  case "$here/" in
    "$root/"*) return 1 ;;
  esac
}
