#!/bin/bash
# install.sh: sets up the board's Mac as the studio's dispatcher host (docs/specs/mac-host.md), or
# checks and repairs it. Run from the repository root of the board's checkout of reviewed main, as the
# board's own user, never with sudo:
#   platform/ops/mac/install.sh            # everything but starting the dispatcher
#   platform/ops/mac/install.sh --start    # the cutover: also starts the dispatcher and waits for its probe
#   platform/ops/mac/install.sh --jobs-only
#                                          # before the cutover: only the jobs (docs/specs/jobs-only-install.md)
#
# First write the dispatcher's env file with
#   platform/ops/make-dispatcher-env.sh ~/peanutgallery-host/env/dispatcher.env
# (after `mkdir -m 700 -p ~/peanutgallery-host/env`), and the jobs' with
#   JOBS_ENV_DIR=~/peanutgallery-host/env platform/ops/make-jobs-env.sh backup-mac controller quota
#
# Every step checks before it acts, so a second run reports 0 changes. It prints key names and paths,
# never a value. In order:
# 1. Checks the Mac: macOS, not root, node 22 or later, the pnpm the repository pins, git, curl,
#    caffeinate, launchctl and plutil.
# 2. Creates ~/peanutgallery-host and its folders, 0700.
# 3. Checks env/dispatcher.env with provision.sh's own rules (AGENT_MODE=unattended, every key the
#    dispatcher needs, two different fine-grained GitHub tokens, none of the forbidden keys, and each
#    Discord webhook that is set a Discord webhook address), and writes env/ntfy.url from its
#    NTFY_TOPIC_URL.
# 4. Clones code/ from main with the env file's token when it is missing, or refuses one that is dirty
#    or holds git state a clone does not have. It never moves an existing code clone: deploy.sh does.
# 5. Installs node_modules when the clone's commit has none installed yet, copies env/dispatcher.env
#    to code/.env, checks the dispatcher's dotenv reads every line back as written, then makes the
#    whole clone read-only (chmod -R a-w) and runs the dispatcher's read-only check on it.
# 6. Clones work/ when it is missing, and creates work-worktrees/.
# 7. Writes the four LaunchAgents from the code clone's commit into ~/Library/LaunchAgents and loads
#    the three jobs. The dispatcher's is left disabled, so a login does not start it before the
#    cutover. With --start, once /board shows the agent mode unattended, it enables and starts the
#    dispatcher and waits for this start's `code root is read-only` and `startup probe passed` lines.
#
# --jobs-only installs the nightly jobs before the dispatcher's env file can exist (it needs the managed
# agent's ids, which need Console credit). It needs no env/dispatcher.env, no .env in the code clone,
# no node_modules and no work clone. After step 1 and 2 it:
# a. Checks each job's env file (env/backup-mac.env, env/controller.env, env/quota.env) that exists:
#    the board's, not a symlink, mode 0600, and passing platform/ops/jobs/check-env.mjs. The backup's
#    must exist; a job whose file is missing is left out and named.
# b. Writes env/ntfy.url from the exported NTFY_TOPIC_URL, or keeps the one already there.
# c. Clones code/ from main when it is missing, with the exported GITHUB_READ_TOKEN (Contents read
#    only), or VPS_GITHUB_TOKEN when that is not exported, both from .env.vps, and records the commit in
#    state/code-jobs-only. The same refusals as step 4.
# d. Makes the clone read-only, checks nothing in it is writable and the jobs' folders refuse a new
#    file, and loads the LaunchAgents of the jobs from (a). The dispatcher's is not written.
# A plain install.sh then refuses the clone --jobs-only made, which holds main as it was then, until
# the board moves it aside (platform/ops/README.md, The Mac host), so the cutover clones main afresh.
set -euo pipefail

# shellcheck source=/dev/null
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

USAGE="usage: platform/ops/mac/install.sh [--start | --jobs-only]"
CHANGES=0
WORK=""

say() { printf 'install: %s\n' "$*"; }
changed() {
  CHANGES=$((CHANGES + 1))
  printf 'install: changed: %s\n' "$*"
}
die() {
  printf 'install: stopped: %s\n' "$*" >&2
  exit 1
}

# node_major: node's major version.
node_major() { node -p 'process.versions.node.split(".")[0]'; }

check_mac() {
  local tool pinned
  [ "$(uname -s)" = Darwin ] || die "this is the Mac host's installer; a server uses provision.sh"
  [ "$(id -u)" -ne 0 ] || die "run as your own user, not root: the LaunchAgents run as you"
  for tool in git curl node pnpm caffeinate launchctl plutil base64; do
    command -v "$tool" > /dev/null 2>&1 || die "$tool is not on PATH"
  done
  [ "$(node_major)" -ge 22 ] || die "node $(node -v) is older than 22, the version the repository requires"
  pinned=$(sed -n 's/.*"packageManager": "pnpm@\([^"]*\)".*/\1/p' "$OPS_DIR/../../package.json")
  [ "$(pnpm --version)" = "$pinned" ] || die "pnpm $(pnpm --version) is not $pinned, the version package.json pins"
  refuse_inside_host "${BASH_SOURCE[0]}" || die "run this from your own checkout, never from $HOST_ROOT"
}

# owner_only <path>: 0 when no group or other permission bit is set.
owner_only() {
  [ -z "$(find "$1" -maxdepth 0 \( -perm -0001 -o -perm -0002 -o -perm -0004 -o -perm -0010 -o -perm -0020 -o -perm -0040 \) -print)" ]
}

# ensure_dir <folder>: creates it 0700, or fixes an existing one's mode.
ensure_dir() {
  if [ -L "$1" ]; then die "$1 is a symlink"; fi
  if [ ! -d "$1" ]; then
    mkdir -p "$1"
    chmod 0700 "$1"
    changed "created $1"
  elif ! owner_only "$1"; then
    chmod 0700 "$1"
    changed "$1 made 0700"
  fi
}

# check_host_env: the dispatcher's env file, with provision.sh's rules.
check_host_env() {
  local problems
  [ -f "$HOST_ENV_FILE" ] || die "$HOST_ENV_FILE is missing; write it with platform/ops/make-dispatcher-env.sh $HOST_ENV_FILE (platform/ops/README.md, The Mac host)"
  [ -O "$HOST_ENV_FILE" ] || die "$HOST_ENV_FILE is not yours"
  owner_only "$HOST_ENV_FILE" || die "$HOST_ENV_FILE must be 0600"
  if ! problems=$(PROVISION_SOURCE_ONLY=1 bash -c '. "$1"; check_env_lines "$2"' install "$OPS_DIR/provision.sh" "$HOST_ENV_FILE"); then
    die "$HOST_ENV_FILE:
$problems"
  fi
  say "$HOST_ENV_FILE: valid"
}

# write_ntfy_url: env/ntfy.url, which run-dispatcher.sh and run-job.sh post alerts to.
write_ntfy_url() {
  put_ntfy_url "$(sed -n 's/^NTFY_TOPIC_URL=//p' "$HOST_ENV_FILE" | tail -n 1)"
}

put_ntfy_url() {
  local url=$1 file=$ENV_DIR/ntfy.url
  if [ "$(cat "$file" 2> /dev/null || true)" != "$url" ]; then
    (umask 077 && printf '%s\n' "$url" > "$file")
    changed "wrote $file"
  fi
}

# ensure_code_clone <env file>: a fresh clone, with the file's GITHUB_TOKEN, when there is none; else
# the checks deploy.sh runs.
ensure_code_clone() {
  local reason exclude
  if [ ! -d "$CODE_DIR/.git" ]; then
    [ ! -e "$CODE_DIR" ] || die "$CODE_DIR exists and is not a clone; move it aside"
    clone_main "$1" "$CODE_DIR" || die "could not clone main into $CODE_DIR with the GITHUB_TOKEN in $1"
    changed "cloned main into $CODE_DIR at $(code_git rev-parse --short HEAD)"
  fi
  exclude=$CODE_DIR/.git/info/exclude
  if ! grep -qxF .pnpm-store "$exclude" 2> /dev/null; then
    unlock_code
    mkdir -p "$(dirname "$exclude")"
    echo .pnpm-store >> "$exclude"
    changed ".pnpm-store added to $exclude"
  fi
  if ! reason=$(check_clean); then die "refused: $reason"; fi
  if ! reason=$(check_code_clone); then die "refused: $reason"; fi
  [ "$(code_git config --local --get remote.origin.url)" = "$REPO_URL" ] || die "$CODE_DIR's origin is not $REPO_URL"
}

# ensure_install: node_modules for the clone's commit, once per commit.
ensure_install() {
  local sha stamp=$STATE_DIR/code-installed
  sha=$(code_git rev-parse --verify 'HEAD^{commit}')
  if [ -d "$CODE_DIR/node_modules" ] && [ "$(cat "$stamp" 2> /dev/null || true)" = "$sha" ]; then
    return 0
  fi
  unlock_code
  run_pnpm_install || die "pnpm install failed in $CODE_DIR"
  echo "$sha" > "$stamp"
  changed "installed node_modules for $sha"
}

# ensure_dotenv: the dispatcher's .env in the code clone, a copy of env/dispatcher.env.
ensure_dotenv() {
  if ! cmp -s "$HOST_ENV_FILE" "$CODE_DIR/.env"; then
    unlock_code
    rm -f "$CODE_DIR/.env"
    (umask 077 && cp "$HOST_ENV_FILE" "$CODE_DIR/.env")
    changed "copied $HOST_ENV_FILE to $CODE_DIR/.env"
  fi
  check_dotenv || die "the dispatcher's dotenv does not read $CODE_DIR/.env as written"
}

# ensure_locked [check]: the whole code clone read-only to its owner too, then the read-only check:
# the dispatcher's (check_readonly) by default.
ensure_locked() {
  local reason check=${1:-check_readonly}
  if code_writable; then
    lock_code
    changed "made $CODE_DIR read-only (chmod -R a-w)"
  fi
  if ! reason=$("$check"); then die "the code clone is not read-only: $reason"; fi
  if ! reason=$(check_clean); then die "the install left the code clone dirty: $reason"; fi
  if ! reason=$(check_code_clone); then die "the install left the code clone unsafe: $reason"; fi
  say "$CODE_DIR is read-only"
}

ensure_work_clone() {
  local origin
  if [ ! -d "$WORK_DIR/.git" ]; then
    [ ! -e "$WORK_DIR" ] || die "$WORK_DIR exists and is not a clone; move it aside"
    clone_main "$HOST_ENV_FILE" "$WORK_DIR" || die "could not clone main into $WORK_DIR"
    changed "cloned main into $WORK_DIR"
  fi
  origin=$(host_git -C "$WORK_DIR" config --local --get remote.origin.url || true)
  [ "$origin" = "$REPO_URL" ] || die "$WORK_DIR's origin is not $REPO_URL"
  ensure_dir "$WORKTREE_DIR"
}

# install_agent <label> <template> [job]: renders the template as committed at the code clone's HEAD
# and writes it when it differs. Returns 0 when it wrote.
install_agent() {
  local label=$1 template=$2 job=${3:-} text rendered target=$AGENTS_DIR/$1.plist reason
  text=$WORK/$label.template
  rendered=$WORK/$label.plist
  code_git show "HEAD:platform/ops/mac/$template" > "$text" || die "platform/ops/mac/$template is not in the code clone's commit"
  if ! reason=$(render_plist "$text" "$rendered" "$(launch_path)" "$job"); then die "$reason"; fi
  plutil -lint -s "$rendered" || die "$template does not render to a valid plist"
  if cmp -s "$rendered" "$target"; then return 1; fi
  mkdir -p "$AGENTS_DIR"
  install -m 0644 "$rendered" "$target"
  changed "wrote $target"
  return 0
}

# install_jobs <jobs>: writes and loads each job's LaunchAgent.
install_jobs() {
  local job label
  for job in $1; do
    label=$(job_label "$job")
    if install_agent "$label" studio.peanutgallery.job.plist "$job" && agent_loaded "$label"; then
      launchctl bootout "$(gui_target)/$label" 2> /dev/null || true
    fi
    if ! agent_loaded "$label"; then
      launchctl bootstrap "$(gui_target)" "$AGENTS_DIR/$label.plist" || die "launchctl could not load $label"
      changed "loaded $label"
    fi
  done
}

# The folders the jobs run from; with the clone's root, what check_jobs_readonly probes.
JOB_PATHS="platform/ops platform/ops/mac platform/ops/jobs"
JOBS_ONLY_MARK=$STATE_DIR/code-jobs-only
# What --jobs-only installs: the jobs whose env file exists (select_jobs).
JOBS=""

# job_env_name <job>: the job's name in check-env.mjs and make-jobs-env.sh.
job_env_name() {
  case "$1" in
    backup) echo backup-mac ;;
    *) echo "$1" ;;
  esac
}

# job_env_file <job>: the env file run-job.sh reads for the job.
job_env_file() { echo "$ENV_DIR/$(job_env_name "$1").env"; }

# check_job_env <job>: the job's env file is the board's, not a symlink, 0600, and passes
# check-env.mjs from this checkout, as run-job.sh checks it before every run.
check_job_env() {
  local file problems
  file=$(job_env_file "$1")
  [ ! -L "$file" ] || die "$file is a symlink"
  [ -f "$file" ] || die "$file is not a file"
  [ -O "$file" ] || die "$file is not yours"
  [ -n "$(find "$file" -maxdepth 0 -perm 0600 -print)" ] || die "$file must be 0600"
  if ! problems=$(env -i PATH="$PATH" node "$OPS_DIR/jobs/check-env.mjs" "$(job_env_name "$1")" "$file"); then
    die "$file:
$problems"
  fi
  say "$file: valid"
}

# select_jobs: JOBS, the jobs whose env file exists, each checked. The backup's must exist.
select_jobs() {
  local job file
  JOBS=""
  for job in $MAC_JOBS; do
    file=$(job_env_file "$job")
    if [ -e "$file" ] || [ -L "$file" ]; then
      check_job_env "$job"
      JOBS="${JOBS:+$JOBS }$job"
    elif [ "$job" = backup ]; then
      die "$file is missing; write it with JOBS_ENV_DIR=$ENV_DIR platform/ops/make-jobs-env.sh backup-mac (platform/ops/README.md, The Mac host)"
    else
      say "$file is missing: the $job job is left out"
    fi
  done
}

# write_jobs_ntfy_url: env/ntfy.url from the exported NTFY_TOPIC_URL, or the one already there. A job
# that fails alerts through it, so one of them must be there.
write_jobs_ntfy_url() {
  local url=${NTFY_TOPIC_URL:-}
  if [ -z "$url" ]; then
    [ -s "$ENV_DIR/ntfy.url" ] || die "export NTFY_TOPIC_URL from .env.vps: a job that fails alerts through it"
    return 0
  fi
  [[ "$url" =~ ^https://[^[:space:]\"\\]+$ ]] || die "NTFY_TOPIC_URL must be one https address"
  put_ntfy_url "$url"
}

# jobs_clone_env: $WORK/clone.env, 0600 in the run's private folder, holding the exported
# GITHUB_READ_TOKEN, or VPS_GITHUB_TOKEN when that is not exported, as GITHUB_TOKEN for clone_main.
jobs_clone_env() {
  local name token=""
  for name in GITHUB_READ_TOKEN VPS_GITHUB_TOKEN; do
    token=${!name:-}
    [ -z "$token" ] || break
  done
  [ -n "$token" ] || die "export GITHUB_READ_TOKEN (or VPS_GITHUB_TOKEN) from .env.vps to clone main into $CODE_DIR"
  [[ "$token" =~ ^github_pat_[A-Za-z0-9_]+$ ]] || die "$name is not a fine-grained personal access token (github_pat_...)"
  (umask 077 && printf 'GITHUB_TOKEN=%s\n' "$token" > "$WORK/clone.env")
  say "cloning main with $name"
}

# check_jobs_readonly: nothing in the code clone is writable, and its root and the jobs' folders
# refuse a new file. Prints one line per problem and returns 1 when there is any.
check_jobs_readonly() {
  local relative folder probe problems=0
  if code_writable; then
    echo "a file in $CODE_DIR is writable"
    problems=1
  fi
  for relative in . $JOB_PATHS; do
    folder=$CODE_DIR/$relative
    if [ ! -d "$folder" ]; then
      echo "$relative is missing from the code clone"
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

# refuse_jobs_only_clone: a plain install never takes over the clone --jobs-only made, which holds
# main as it was then: the dispatcher starts from main as the cutover finds it.
refuse_jobs_only_clone() {
  [ -f "$JOBS_ONLY_MARK" ] || return 0
  if [ -d "$CODE_DIR/.git" ] || [ -e "$CODE_DIR" ]; then
    die "$CODE_DIR was cloned by install.sh --jobs-only at $(head -c 12 "$JOBS_ONLY_MARK"), for the jobs only. Move it aside so this install clones main afresh:
  chmod -R u+w $CODE_DIR && mv $CODE_DIR $(dirname "$HOST_ROOT")/peanutgallery-code.jobs-only
then run install.sh again (platform/ops/README.md, The Mac host)"
  fi
  rm -f "$JOBS_ONLY_MARK"
  changed "removed $JOBS_ONLY_MARK: the jobs-only clone was moved aside"
}

install_jobs_only() {
  local fresh=0
  select_jobs
  write_jobs_ntfy_url
  if [ ! -d "$CODE_DIR/.git" ]; then
    fresh=1
    jobs_clone_env
  fi
  ensure_code_clone "$WORK/clone.env"
  rm -f "$WORK/clone.env"
  if [ "$fresh" = 1 ]; then
    code_git rev-parse --verify 'HEAD^{commit}' > "$JOBS_ONLY_MARK"
  fi
  ensure_locked check_jobs_readonly
  install_jobs "$JOBS"
  say "the dispatcher is not installed: a plain install.sh does that at the cutover (docs/BOARD-SETUP.md step 23)"
}

# studio_mode: studio_state's agent mode and pause, as the service role reads them.
# shellcheck disable=SC2016 # the node program is in single quotes on purpose
studio_mode() {
  local rows
  rows=$(supabase_get 'studio_state?id=eq.1&select=agent_mode,paused') || return 1
  printf '%s' "$rows" | node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{const r=JSON.parse(s);if(!Array.isArray(r)||r.length!==1)process.exit(1);console.log(`${r[0].agent_mode} ${r[0].paused}`)})'
}

install_dispatcher() {
  local start=$1 label=$DISPATCHER_LABEL wrote=0 mode since
  install_agent "$label" studio.peanutgallery.dispatcher.plist && wrote=1
  if [ "$start" = 0 ]; then
    if agent_loaded "$label"; then
      if [ "$wrote" = 1 ]; then
        say "the dispatcher is running with its previous LaunchAgent; pause from /board and run install.sh --start to restart it with this one"
      else
        say "the dispatcher is running"
      fi
    elif ! agent_disabled "$label"; then
      launchctl disable "$(gui_target)/$label"
      changed "disabled $label until the cutover (install.sh --start)"
    else
      say "the dispatcher is installed and not started: starting it is the cutover (platform/ops/README.md, The Mac host)"
    fi
    return 0
  fi
  mode=$(studio_mode) || die "could not read studio_state with the service key in $ENV_FILE"
  case "$mode" in
    "unattended "*) ;;
    *) die "studio_state.agent_mode is not unattended; set it at /board first (the cutover, docs/BOARD-SETUP.md step 23)" ;;
  esac
  if agent_loaded "$label"; then
    launchctl bootout "$(gui_target)/$label" || die "launchctl could not stop $label"
    changed "stopped $label"
  fi
  launchctl enable "$(gui_target)/$label"
  reset_dispatcher_state
  since=$(date +%s)
  launchctl bootstrap "$(gui_target)" "$AGENTS_DIR/$label.plist" || die "launchctl could not load $label"
  changed "started $label"
  say "waiting up to $PROBE_WAIT_SECONDS seconds for the startup probe"
  wait_for_start "$since" || die "the dispatcher did not pass its startup probe"
}

main() {
  local start=0 jobs_only=0
  case "${1:-}" in
    --start) start=1 ;;
    --jobs-only) jobs_only=1 ;;
    '') ;;
    *) die "$USAGE" ;;
  esac
  [ "$#" -le 1 ] || die "$USAGE"
  check_mac
  ensure_dir "$HOST_ROOT"
  ensure_dir "$ENV_DIR"
  ensure_dir "$STATE_DIR"
  ensure_dir "$LOG_DIR"
  WORK=$(mktemp -d)
  trap 'rm -rf "$WORK"; if [ -d "$CODE_DIR" ] && code_writable; then lock_code; fi' EXIT

  if [ "$jobs_only" = 1 ]; then
    install_jobs_only
    say "done: $CHANGES change(s)"
    return 0
  fi
  refuse_jobs_only_clone
  check_host_env
  write_ntfy_url
  ensure_code_clone "$HOST_ENV_FILE"
  ensure_install
  ensure_dotenv
  ensure_locked
  ensure_work_clone
  install_jobs "$MAC_JOBS"
  install_dispatcher "$start"
  say "done: $CHANGES change(s)"
}

# INSTALL_SOURCE_ONLY=1 loads the functions without running anything (the ops tests use it).
if [ "${INSTALL_SOURCE_ONLY:-}" != 1 ]; then
  main "$@"
fi
