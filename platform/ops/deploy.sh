#!/usr/bin/env bash
# deploy.sh: updates the VPS dispatcher to origin/main, or rolls it back to an older commit of main
# with --ref <sha> (docs/specs/vps.md, docs/specs/ops-separation.md). Run as root on the VPS:
#   ssh root@<vps-ip> 'bash /srv/peanutgallery-code/platform/ops/deploy.sh'
#   ssh root@<vps-ip> 'bash /srv/peanutgallery-code/platform/ops/deploy.sh --ref <sha>'
#
# Pause from /board first and let any building card finish: the script refuses unless
# studio_state.paused is true and no card is building or gated.
#
# It works in the code clone only, /srv/peanutgallery-code, which root owns and the container mounts
# read-only. It refuses when that clone has any uncommitted or untracked file, fetches main, and
# fast-forwards to it (or checks out --ref, which must be on main). Everything root acts on comes
# from the commit, never from the working tree: the image is built from `git archive` and the units
# from `git show`. node_modules are installed in a throwaway container with no secret, and the clone
# is then made root-owned and not writable by uid 10001. It restarts the service, waits for
# `startup probe passed`, and reminds you to resume.
#
# It never runs git or anything else in the work clone, /srv/peanutgallery: uid 10001 and
# agent-written code can write there, and the dispatcher fetches in it itself.
# NODE_IMAGE=node:22-bookworm-slim@sha256:<digest> pins the base image when it rebuilds.
set -euo pipefail

CODE_DIR=/srv/peanutgallery-code
CODE_MOUNT=/opt/peanutgallery
WORK_DIR=/srv/peanutgallery
WORKTREE_DIR=/srv/peanutgallery-worktrees
ENV_FILE=/etc/peanutgallery/dispatcher.env
IMAGE=peanutgallery/dispatcher
NODE_IMAGE=${NODE_IMAGE:-node:22-bookworm-slim}
UNITS="dispatcher.service dispatcher-alert.service"
PROBE_WAIT_SECONDS=${PROBE_WAIT_SECONDS:-600}
USAGE="usage: deploy.sh [--ref <commit sha>]"
WORK=""

say() { printf 'deploy: %s\n' "$*"; }
die() {
  printf 'deploy: stopped: %s\n' "$*" >&2
  exit 1
}

# env_value <key>: the value of KEY in the env file, or nothing.
env_value() {
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1
}

# check_quiet <studio_state rows> <building and gated cards>: both PostgREST JSON arrays. Prints why
# a deploy must wait and returns 1, or returns 0 when the studio is paused with no card in flight.
check_quiet() {
  local paused busy
  if ! paused=$(printf '%s' "$1" | jq -r 'if type == "array" and length == 1 then (.[0].paused | tostring) else "unreadable" end' 2> /dev/null); then
    paused=unreadable
  fi
  case "$paused" in
    true) ;;
    false)
      echo "the studio is not paused; pause from /board first"
      return 1
      ;;
    *)
      echo "could not read studio_state.paused"
      return 1
      ;;
  esac
  if ! busy=$(printf '%s' "$2" | jq -r 'if type == "array" then (map("\(.id) (\(.stage))") | join(", ")) else error("not a list") end' 2> /dev/null); then
    echo "could not read the building and gated cards"
    return 1
  fi
  if [ -n "$busy" ]; then
    echo "cards are still building or gated: $busy; wait for them to finish"
    return 1
  fi
  return 0
}

# supabase_get <path and query>: a PostgREST read with the service key. The key goes to curl in a
# header file, never on a command line. A new-format secret key (sb_secret_) is not a JWT and goes in
# apikey only; a legacy service role JWT also goes as the bearer, as supabase-js sends it.
supabase_get() {
  local url key
  url=$(env_value SUPABASE_URL)
  key=$(env_value SUPABASE_SERVICE_ROLE_KEY)
  if [ -z "$url" ] || [ -z "$key" ]; then
    die "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing from $ENV_FILE"
  fi
  printf 'apikey: %s\n' "$key" > "$WORK/supabase-headers"
  case "$key" in
    sb_secret_* | sb_publishable_*) ;;
    *) printf 'Authorization: Bearer %s\n' "$key" >> "$WORK/supabase-headers" ;;
  esac
  curl -fsS -g --max-time 20 -H @"$WORK/supabase-headers" "${url%/}/rest/v1/$1"
}

# code_git <args>: git in the code clone, the only git deploy.sh runs. core.fsmonitor and hooks are
# off on the command line, which overrides any value in the clone's own configuration, so no
# program a planted .git/config names runs as root.
code_git() {
  git -c safe.directory="$CODE_DIR" -c core.fsmonitor=false -c core.hooksPath=/dev/null -C "$CODE_DIR" "$@"
}

# check_clean: returns 0 when the code clone has no uncommitted change and no untracked file, else
# prints what differs and how to inspect it and returns 1. Ignored and excluded files (node_modules,
# .pnpm-store) do not count. Only deploy.sh and provision.sh change this clone, so a difference is
# treated as tampering.
check_clean() {
  local status
  if ! status=$(code_git status --porcelain --untracked-files=all); then
    echo "could not read the status of $CODE_DIR"
    return 1
  fi
  [ -z "$status" ] && return 0
  echo "$CODE_DIR has uncommitted or untracked files, and only deploy.sh and provision.sh change it. Treat it as tampering: find out who changed it before anything runs from it. The first entries:"
  head -n 20 <<< "$status"
  echo "Inspect, as root, with fsmonitor and hooks off:
  git -c safe.directory=$CODE_DIR -c core.fsmonitor=false -c core.hooksPath=/dev/null -C $CODE_DIR status --untracked-files=all
  git -c safe.directory=$CODE_DIR -c core.fsmonitor=false -c core.hooksPath=/dev/null -C $CODE_DIR diff
Then restore the clone (README.md, Roll back) or provision it again."
  return 1
}

# exclude_store: pnpm's store sits in the code clone so it hard-links into node_modules; git ignores
# it through .git/info/exclude.
exclude_store() {
  local exclude=$CODE_DIR/.git/info/exclude
  if ! grep -qxF .pnpm-store "$exclude" 2> /dev/null; then
    mkdir -p "$(dirname "$exclude")"
    echo .pnpm-store >> "$exclude"
    say ".pnpm-store added to $exclude"
  fi
}

# unit_text <sha> <unit>: the unit file as committed at sha.
unit_text() {
  code_git show "$1:platform/ops/$2"
}

# build_context <sha>: platform/ops as committed at sha, as a tar stream for docker build.
build_context() {
  code_git archive --format=tar "$1:platform/ops"
}

# install_dependencies: pnpm install into the code clone in a throwaway container: root inside, no
# capability, no env file, and an environment of four names. Dependency scripts it runs see no
# secret, and the running dispatcher never installs anything.
install_dependencies() {
  docker run --rm --pull never --user 0:0 --cap-drop ALL --security-opt no-new-privileges \
    --volume "$CODE_DIR:$CODE_MOUNT" --workdir "$CODE_MOUNT" --entrypoint /usr/bin/env \
    "$IMAGE:current" -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/root CI=true \
    pnpm_config_store_dir="$CODE_MOUNT/.pnpm-store" \
    pnpm install --frozen-lockfile --prefer-offline
}

# lock_code_clone: root owns everything in the code clone and nothing in it is writable by group or
# others, so uid 10001 can change none of the code it runs. chown -h and chmod skip symlinks' targets.
lock_code_clone() {
  if [ -n "$(find "$CODE_DIR" \( ! -user 0 -o ! -group 0 \) -print -quit)" ]; then
    chown -hR 0:0 "$CODE_DIR"
    say "$CODE_DIR owned by root again"
  fi
  if [ -n "$(find "$CODE_DIR" ! -type l -perm /022 -print -quit)" ]; then
    find "$CODE_DIR" ! -type l -perm /022 -exec chmod go-w {} +
    say "group and other write removed in $CODE_DIR"
  fi
}

wait_for_probe() {
  local since=$1 deadline logs
  deadline=$(($(date +%s) + PROBE_WAIT_SECONDS))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    logs=$(journalctl -u dispatcher --since "@$since" --no-pager -o cat 2> /dev/null || true)
    if grep -qF 'startup probe passed' <<< "$logs"; then
      grep -F 'startup probe passed' <<< "$logs"
      return 0
    fi
    # Only an exit systemd will not restart (78, logged with "restart":false) ends the wait; a
    # retryable startup failure exits 1 and systemd tries again after its back-off.
    if grep -qE 'dispatcher exited with an error.*"restart":false' <<< "$logs"; then
      tail -n 20 <<< "$logs"
      die "the dispatcher stopped at startup and will not restart; see the lines above, systemctl status dispatcher, and README.md (Roll back)"
    fi
    sleep 5
  done
  journalctl -u dispatcher -n 50 --no-pager
  die "no 'startup probe passed' within $PROBE_WAIT_SECONDS seconds; see README.md (Roll back)"
}

image_id() {
  docker image inspect --format '{{.Id}}' "$1" 2> /dev/null || true
}

main() {
  local ref="" studio cards reason old new origin_main token header unit reload=0 since before
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --ref)
        [ "$#" -ge 2 ] || die "$USAGE"
        ref=$2
        shift 2
        ;;
      *) die "$USAGE" ;;
    esac
  done
  if [ -n "$ref" ] && ! [[ "$ref" =~ ^[0-9a-f]{40}$ ]]; then
    die "--ref takes a full 40-character commit sha"
  fi
  [ "$(id -u)" -eq 0 ] || die "run as root"
  [ -f "$ENV_FILE" ] || die "$ENV_FILE is missing; this VPS is not provisioned"
  [ -d "$CODE_DIR/.git" ] || die "$CODE_DIR is not a clone; run provision.sh (README.md, Provision)"
  [ -d "$WORK_DIR/.git" ] || die "$WORK_DIR is not a clone; run provision.sh (README.md, Provision)"
  [ -d "$WORKTREE_DIR" ] || die "$WORKTREE_DIR is missing; run provision.sh (README.md, Provision)"
  # A stopped unit is either before the cutover, with the Mac dispatcher still running on the same
  # database, or stopped on purpose by the board. Starting it is not deploy.sh's call. A running,
  # restarting or failed unit is deployed and restarted.
  if [ "$(systemctl is-active dispatcher 2> /dev/null || true)" = inactive ]; then
    die "the dispatcher unit is stopped; start it by hand (README.md, Cutover) before deploying"
  fi
  WORK=$(mktemp -d)
  trap 'rm -rf "$WORK"' EXIT

  studio=$(supabase_get 'studio_state?id=eq.1&select=paused') || die "could not read studio_state"
  cards=$(supabase_get 'cards?stage=in.(building,gated)&select=id,stage') || die "could not read cards"
  if ! reason=$(check_quiet "$studio" "$cards"); then
    die "refused: $reason"
  fi
  say "the studio is paused and no card is building or gated"

  exclude_store
  if ! reason=$(check_clean); then
    die "refused: $reason"
  fi
  old=$(code_git rev-parse HEAD)
  token=$(env_value GITHUB_TOKEN)
  [ -n "$token" ] || die "GITHUB_TOKEN is missing from $ENV_FILE"
  header="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$token" | base64 -w0)"
  # The token reaches git as configuration in its environment for this one command, so it is on no
  # command line and never in .git/config.
  (
    export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.https://github.com/.extraheader GIT_CONFIG_VALUE_0="$header"
    code_git fetch --quiet origin +refs/heads/main:refs/remotes/origin/main
  ) || die "could not fetch main into $CODE_DIR"
  origin_main=$(code_git rev-parse --verify 'refs/remotes/origin/main^{commit}')

  if [ -z "$ref" ]; then
    # After a roll back the clone is detached; a plain deploy returns it to main first.
    if [ "$(code_git symbolic-ref -q HEAD || true)" != refs/heads/main ]; then
      code_git checkout --quiet main
    fi
    code_git merge --ff-only --quiet refs/remotes/origin/main || die "main in $CODE_DIR does not fast-forward to origin/main; treat it as tampering and inspect the clone"
    new=$(code_git rev-parse HEAD)
    [ "$new" = "$origin_main" ] || die "HEAD in $CODE_DIR is $new, not origin/main at $origin_main"
  else
    code_git merge-base --is-ancestor "$ref" refs/remotes/origin/main 2> /dev/null || die "$ref is not a commit on origin/main"
    code_git checkout --quiet --detach "$ref"
    new=$(code_git rev-parse HEAD)
    [ "$new" = "$ref" ] || die "HEAD in $CODE_DIR is $new, not $ref"
  fi
  if [ "$old" = "$new" ]; then
    say "the code clone is already at $new"
  else
    say "the code clone moved from $old to $new"
  fi

  # The image for the new commit: one already tagged with it (a rerun or a roll back), the current
  # image when platform/ops did not change, or a new build from the commit.
  before=$(image_id "$IMAGE:current")
  if [ -n "$(image_id "$IMAGE:$new")" ]; then
    docker tag "$IMAGE:$new" "$IMAGE:current"
  elif [ "$old" != "$new" ] && [ -n "$before" ] && code_git diff --quiet "$old" "$new" -- platform/ops; then
    docker tag "$IMAGE:current" "$IMAGE:$new"
    say "platform/ops unchanged; $IMAGE:current also tagged $new"
  else
    if ! build_context "$new" | docker build --build-arg NODE_IMAGE="$NODE_IMAGE" -f Dockerfile.dispatcher -t "$IMAGE:$new" -t "$IMAGE:current" -; then
      die "the image build failed. The code clone is at $new and the running dispatcher is unchanged; fix main and run deploy.sh again, or roll back (README.md, Roll back)"
    fi
    say "built $IMAGE:$new and :current from $new"
  fi

  install_dependencies || die "pnpm install failed in the throwaway container. The code clone is at $new; fix and run deploy.sh again, or roll back (README.md, Roll back)"
  lock_code_clone
  if ! reason=$(check_clean); then
    die "pnpm install left the code clone dirty: $reason"
  fi

  for unit in $UNITS; do
    unit_text "$new" "$unit" > "$WORK/$unit" || die "platform/ops/$unit is not in $new"
    if ! cmp -s "$WORK/$unit" "/etc/systemd/system/$unit"; then
      install -m 0644 "$WORK/$unit" "/etc/systemd/system/$unit"
      reload=1
      say "installed /etc/systemd/system/$unit from $new"
    fi
  done
  if [ "$reload" = 1 ]; then
    systemctl daemon-reload
    systemd-analyze verify /etc/systemd/system/dispatcher.service /etc/systemd/system/dispatcher-alert.service || die "systemd-analyze verify failed on the new units"
  fi

  if [ "$old" = "$new" ] && [ "$before" = "$(image_id "$IMAGE:current")" ] && [ "$reload" = 0 ] && systemctl is-active --quiet dispatcher; then
    say "nothing to deploy: the running dispatcher is at $new. Resume from /board."
    return 0
  fi

  since=$(date +%s)
  systemctl reset-failed dispatcher 2> /dev/null || true
  systemctl restart dispatcher
  say "restarted; waiting up to $PROBE_WAIT_SECONDS seconds for the startup probe"
  wait_for_probe "$since"
  say "deployed $new. Resume from /board."
}

# DEPLOY_SOURCE_ONLY=1 loads the functions without running anything (the ops tests use it). The body
# is one function, so bash has read all of it before the fast-forward rewrites this file.
if [ "${DEPLOY_SOURCE_ONLY:-}" != 1 ]; then
  main "$@" < /dev/null
  exit
fi
