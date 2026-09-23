#!/bin/bash
# deploy.sh: updates the dispatcher on the board's Mac to origin/main, or rolls it back to an older
# commit of main with --ref <sha> (docs/specs/mac-host.md). The Mac's form of platform/ops/deploy.sh,
# with the same checks, run as the board's own user from the repository root of the board's checkout
# of reviewed main, never from the host's code clone:
#   platform/ops/mac/deploy.sh                          # prints the review, then asks for the sha
#   platform/ops/mac/deploy.sh --confirm <first 12 characters of the target sha>
#   platform/ops/mac/deploy.sh --ref <sha> --confirm <first 12 characters of sha>
#
# Pause from /board first and let any building card finish: it refuses unless studio_state.paused is
# true and no card is building or gated, and while the dispatcher's LaunchAgent is not loaded (before
# the cutover, a start would run a second dispatcher beside the attended one).
#
# In the code clone only (~/peanutgallery-host/code), with fsmonitor, hooks and optional locks off:
# it refuses the clone when it has an uncommitted or untracked file or git state a clone does not
# have; fetches main from the repository's own URL; checks through the GitHub API that the target's
# gate check concluded success; prints the commits it adds and removes and a diff stat, and moves only
# once the board confirms the target sha. Then it makes the clone writable (chmod -R u+w), moves it to
# the target, runs pnpm install --frozen-lockfile with no secret in its environment, makes it
# read-only again (chmod -R a-w), runs the read-only and clone checks again, rewrites any LaunchAgent
# whose template changed, restarts the dispatcher (launchctl kickstart -k) and waits for this start's
# `code root is read-only` and `startup probe passed` lines. The clone is made read-only again on
# every exit. It never touches the work clone: the dispatcher fetches there itself.
set -euo pipefail

# shellcheck source=/dev/null
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

USAGE="usage: platform/ops/mac/deploy.sh [--ref <commit sha>] [--confirm <first 12 characters of the target sha>]"
WORK=""

say() { printf 'deploy: %s\n' "$*"; }
die() {
  printf 'deploy: stopped: %s\n' "$*" >&2
  exit 1
}

# check_ref_mac <sha>: a roll back goes only to a commit on origin/main that has the Mac host's files,
# so it never returns to a commit this layout cannot run.
check_ref_mac() {
  local ref=$1 file
  if ! code_git cat-file -e "$ref^{commit}" 2> /dev/null; then
    echo "$ref is not a commit in $CODE_DIR"
    return 1
  fi
  if ! code_git merge-base --is-ancestor "$ref" refs/remotes/origin/main 2> /dev/null; then
    echo "$ref is not a commit on origin/main"
    return 1
  fi
  for file in run-dispatcher.sh run-job.sh backup-mac.sh studio.peanutgallery.dispatcher.plist studio.peanutgallery.job.plist; do
    if ! code_git cat-file -e "$ref:platform/ops/mac/$file" 2> /dev/null; then
      echo "$ref has no platform/ops/mac/$file, so it is older than the Mac host; take the change out with a revert on main instead"
      return 1
    fi
  done
}

# rewrite_agents: each LaunchAgent rendered from the new commit; a job whose file changed is loaded
# again. Prints the labels it rewrote.
rewrite_agents() {
  local job label target rendered path
  path=$(launch_path)
  for job in dispatcher $MAC_JOBS; do
    if [ "$job" = dispatcher ]; then
      label=$DISPATCHER_LABEL
      code_git show "HEAD:platform/ops/mac/studio.peanutgallery.dispatcher.plist" > "$WORK/template"
      render_plist "$WORK/template" "$WORK/$label.plist" "$path" > /dev/null || die "the dispatcher's LaunchAgent does not render"
    else
      label=$(job_label "$job")
      code_git show "HEAD:platform/ops/mac/studio.peanutgallery.job.plist" > "$WORK/template"
      render_plist "$WORK/template" "$WORK/$label.plist" "$path" "$job" > /dev/null || die "the $job LaunchAgent does not render"
    fi
    rendered=$WORK/$label.plist
    target=$AGENTS_DIR/$label.plist
    plutil -lint -s "$rendered" || die "$label does not render to a valid plist"
    cmp -s "$rendered" "$target" && continue
    install -m 0644 "$rendered" "$target"
    say "rewrote $target"
    if [ "$job" != dispatcher ]; then
      launchctl bootout "$(gui_target)/$label" 2> /dev/null || true
      launchctl bootstrap "$(gui_target)" "$target" || die "launchctl could not load $label"
    else
      # A changed dispatcher agent takes effect on a fresh load, not on a kickstart.
      launchctl bootout "$(gui_target)/$label" || die "launchctl could not stop $label"
      launchctl bootstrap "$(gui_target)" "$target" || die "launchctl could not load $label"
      echo reloaded > "$WORK/dispatcher-reloaded"
    fi
  done
}

main() {
  local ref="" confirm="" studio cards reason old new target origin_main since
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --ref | --confirm)
        [ "$#" -ge 2 ] || die "$USAGE"
        if [ "$1" = --ref ]; then ref=$2; else confirm=$2; fi
        shift 2
        ;;
      *) die "$USAGE" ;;
    esac
  done
  if [ -n "$ref" ] && ! [[ "$ref" =~ ^[0-9a-f]{40}$ ]]; then die "--ref takes a full 40-character commit sha"; fi
  if [ -n "$confirm" ] && ! [[ "$confirm" =~ ^[0-9a-f]{12}$ ]]; then die "--confirm takes the first 12 characters of the target sha"; fi
  [ "$(uname -s)" = Darwin ] || die "this is the Mac host's deploy; a server uses platform/ops/deploy.sh"
  [ "$(id -u)" -ne 0 ] || die "run as your own user, not root"
  refuse_inside_host "${BASH_SOURCE[0]}" || die "run this from your own checkout, never from $HOST_ROOT"
  [ -f "$ENV_FILE" ] || die "$ENV_FILE is missing; run install.sh (platform/ops/README.md, The Mac host)"
  [ -d "$CODE_DIR/.git" ] || die "$CODE_DIR is not a clone; run install.sh"
  [ -d "$WORK_DIR/.git" ] || die "$WORK_DIR is not a clone; run install.sh"
  [ -d "$WORKTREE_DIR" ] || die "$WORKTREE_DIR is missing; run install.sh"
  [ "$(env_value GITHUB_REPO)" = "$REPO_SLUG" ] || die "GITHUB_REPO in $ENV_FILE is not $REPO_SLUG"
  # Not loaded is before the cutover, with the attended dispatcher possibly running on the same
  # database, or stopped on purpose by the board. Starting it is not deploy.sh's call.
  agent_loaded "$DISPATCHER_LABEL" || die "the dispatcher's LaunchAgent is not loaded; start it at the cutover (install.sh --start) before deploying"
  WORK=$(mktemp -d)
  trap 'rm -rf "$WORK"; if code_writable; then lock_code; fi' EXIT

  studio=$(supabase_get 'studio_state?id=eq.1&select=paused') || die "could not read studio_state"
  cards=$(supabase_get 'cards?stage=in.(building,gated)&select=id,stage') || die "could not read cards"
  if ! reason=$(check_quiet "$studio" "$cards"); then die "refused: $reason"; fi
  say "the studio is paused and no card is building or gated"

  if ! reason=$(check_clean); then die "refused: $reason"; fi
  if ! reason=$(check_code_clone); then die "refused: $reason"; fi
  [ "$(code_git config --local --get remote.origin.url)" = "$REPO_URL" ] || die "$CODE_DIR's origin is not $REPO_URL"
  old=$(code_git rev-parse --verify 'HEAD^{commit}')

  unlock_code
  fetch_main "$ENV_FILE" || die "could not fetch main from $REPO_URL into $CODE_DIR"
  origin_main=$(code_git rev-parse --verify 'refs/remotes/origin/main^{commit}')
  if [ -z "$ref" ]; then
    target=$origin_main
    code_git merge-base --is-ancestor refs/heads/main "$target" || die "main in $CODE_DIR does not fast-forward to origin/main; treat it as tampering and inspect the clone"
  else
    if ! reason=$(check_ref_mac "$ref"); then die "refused: $reason"; fi
    target=$ref
  fi

  # A person confirms every move of the code clone, after GitHub confirms the gate passed on it.
  if [ "$target" != "$old" ]; then
    if ! reason=$(check_gate "$target"); then die "refused: $reason"; fi
    say "the gate check on $target concluded success"
    review_target "$old" "$target"
    if ! reason=$(confirm_target "$target" "$confirm"); then die "$reason"; fi
  fi

  if [ -z "$ref" ]; then
    if [ "$(code_git symbolic-ref -q HEAD || true)" != refs/heads/main ]; then
      code_git checkout --quiet main
    fi
    code_git merge --ff-only --quiet "$target" || die "main in $CODE_DIR does not fast-forward to $target"
  else
    code_git checkout --quiet --detach "$target"
  fi
  new=$(code_git rev-parse --verify 'HEAD^{commit}')
  [ "$new" = "$target" ] || die "HEAD in $CODE_DIR is $new, not $target"
  if [ "$old" = "$new" ]; then say "the code clone is already at $new"; else say "the code clone moved from $old to $new"; fi

  if [ "$old" != "$new" ] || [ ! -d "$CODE_DIR/node_modules" ]; then
    run_pnpm_install || die "pnpm install failed. The code clone is at $new; fix main and run deploy.sh again, or roll back (platform/ops/README.md, The Mac host)"
    echo "$new" > "$STATE_DIR/code-installed"
  fi
  lock_code
  if ! reason=$(check_readonly); then die "the code clone is not read-only: $reason"; fi
  if ! reason=$(check_clean); then die "the install left the code clone dirty: $reason"; fi
  if ! reason=$(check_code_clone); then die "the install left the code clone unsafe: $reason"; fi
  check_dotenv || die "the dispatcher's dotenv does not read $ENV_FILE as written"

  reset_dispatcher_state
  since=$(date +%s)
  rewrite_agents
  if [ "$old" = "$new" ] && [ ! -f "$WORK/dispatcher-reloaded" ]; then
    say "nothing to deploy: the dispatcher runs $new. Resume from /board."
    return 0
  fi
  if [ ! -f "$WORK/dispatcher-reloaded" ]; then
    launchctl kickstart -k "$(gui_target)/$DISPATCHER_LABEL" || die "launchctl could not restart the dispatcher"
  fi
  say "restarted; waiting up to $PROBE_WAIT_SECONDS seconds for the startup probe"
  wait_for_start "$since" || die "the dispatcher did not pass its startup probe; see platform/ops/README.md (The Mac host, Roll back)"
  say "deployed $new. Resume from /board."
}

# MAC_DEPLOY_SOURCE_ONLY=1 loads the functions without running anything (the ops tests use it).
if [ "${MAC_DEPLOY_SOURCE_ONLY:-}" != 1 ]; then
  main "$@"
fi
