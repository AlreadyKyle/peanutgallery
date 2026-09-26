#!/bin/bash
# install.sh: sets up the board's Mac as the studio's dispatcher host (docs/specs/mac-host.md), or
# checks and repairs it. Run from the repository root of the board's checkout of reviewed main, as the
# board's own user, never with sudo:
#   platform/ops/mac/install.sh            # everything but starting the dispatcher
#   platform/ops/mac/install.sh --start    # the cutover: also starts the dispatcher and waits for its probe
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
set -euo pipefail

# shellcheck source=/dev/null
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

USAGE="usage: platform/ops/mac/install.sh [--start]"
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
  local url file=$ENV_DIR/ntfy.url
  url=$(sed -n 's/^NTFY_TOPIC_URL=//p' "$HOST_ENV_FILE" | tail -n 1)
  if [ "$(cat "$file" 2> /dev/null || true)" != "$url" ]; then
    (umask 077 && printf '%s\n' "$url" > "$file")
    changed "wrote $file"
  fi
}

# ensure_code_clone: a fresh clone when there is none; else the checks deploy.sh runs.
ensure_code_clone() {
  local reason exclude
  if [ ! -d "$CODE_DIR/.git" ]; then
    [ ! -e "$CODE_DIR" ] || die "$CODE_DIR exists and is not a clone; move it aside"
    clone_main "$HOST_ENV_FILE" "$CODE_DIR" || die "could not clone main into $CODE_DIR with the env file's GITHUB_TOKEN"
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

# ensure_locked: the whole code clone read-only to its owner too, then the read-only check.
ensure_locked() {
  local reason
  if code_writable; then
    lock_code
    changed "made $CODE_DIR read-only (chmod -R a-w)"
  fi
  if ! reason=$(check_readonly); then die "the code clone is not read-only: $reason"; fi
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

install_jobs() {
  local job label
  for job in $MAC_JOBS; do
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
    *) die "studio_state.agent_mode is not unattended; set it at /board first (the cutover, docs/BOARD-SETUP.md step 8)" ;;
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
  local start=0
  case "${1:-}" in
    --start) start=1 ;;
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

  check_host_env
  write_ntfy_url
  ensure_code_clone
  ensure_install
  ensure_dotenv
  ensure_locked
  ensure_work_clone
  install_jobs
  install_dispatcher "$start"
  say "done: $CHANGES change(s)"
}

# INSTALL_SOURCE_ONLY=1 loads the functions without running anything (the ops tests use it).
if [ "${INSTALL_SOURCE_ONLY:-}" != 1 ]; then
  main "$@"
fi
