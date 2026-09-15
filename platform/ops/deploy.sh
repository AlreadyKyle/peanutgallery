#!/usr/bin/env bash
# deploy.sh: updates the VPS dispatcher to origin/main (docs/specs/vps.md). Run as root on the VPS:
#   ssh root@<vps-ip> 'bash /srv/peanutgallery/platform/ops/deploy.sh'
#
# Pause from /board first and let any building card finish: the script refuses unless
# studio_state.paused is true and no card is building or gated. It then fast-forwards the clone
# inside the image as uid 10001, rebuilds the image only when platform/ops changed, reinstalls
# changed units, restarts the service, waits for `startup probe passed`, and reminds you to resume.
# NODE_IMAGE=node:22-bookworm-slim@sha256:<digest> pins the base image when it rebuilds.
set -euo pipefail

REPO_DIR=/srv/peanutgallery
ENV_FILE=/etc/peanutgallery/dispatcher.env
IMAGE=peanutgallery/dispatcher
AGENT_UID=10001
NODE_IMAGE=${NODE_IMAGE:-node:22-bookworm-slim}
UNITS="dispatcher.service dispatcher-alert.service"
PROBE_WAIT_SECONDS=${PROBE_WAIT_SECONDS:-600}
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
# header file, never on a command line.
supabase_get() {
  local url key
  url=$(env_value SUPABASE_URL)
  key=$(env_value SUPABASE_SERVICE_ROLE_KEY)
  if [ -z "$url" ] || [ -z "$key" ]; then
    die "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing from $ENV_FILE"
  fi
  printf 'apikey: %s\nAuthorization: Bearer %s\n' "$key" "$key" > "$WORK/supabase-headers"
  curl -fsS -g --max-time 20 -H @"$WORK/supabase-headers" "${url%/}/rest/v1/$1"
}

host_git() {
  git -c safe.directory="$REPO_DIR" -c core.hooksPath=/dev/null -C "$REPO_DIR" "$@"
}

# image_git <args>: git as uid 10001 inside the dispatcher image, so the clone keeps its owner, with
# hooks off. When GITHUB_AUTH_HEADER is exported, it becomes git's one-off extraheader for
# github.com; docker passes it by name, so its value is on no command line and never in .git/config.
image_git() {
  local config=(-e GIT_CONFIG_COUNT=1)
  if [ -n "${GITHUB_AUTH_HEADER:-}" ]; then
    config=(-e GIT_CONFIG_COUNT=2 -e GIT_CONFIG_KEY_1=http.https://github.com/.extraheader -e GIT_CONFIG_VALUE_1)
  fi
  GIT_CONFIG_VALUE_1=${GITHUB_AUTH_HEADER:-} docker run --rm --pull never --user "$AGENT_UID:$AGENT_UID" \
    --cap-drop ALL --security-opt no-new-privileges \
    --volume "$REPO_DIR:$REPO_DIR" --workdir "$REPO_DIR" --entrypoint git \
    -e GIT_CONFIG_KEY_0=core.hooksPath -e GIT_CONFIG_VALUE_0=/dev/null "${config[@]}" \
    "$IMAGE:current" "$@"
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
    if grep -qF 'dispatcher exited with an error' <<< "$logs"; then
      tail -n 20 <<< "$logs"
      die "the dispatcher stopped at startup; see the lines above, systemctl status dispatcher, and README.md (Roll back)"
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
  local studio cards reason old new token unit reload=0 since before
  [ "$(id -u)" -eq 0 ] || die "run as root"
  [ -f "$ENV_FILE" ] || die "$ENV_FILE is missing; this VPS is not provisioned"
  [ -d "$REPO_DIR/.git" ] || die "$REPO_DIR is not a clone; this VPS is not provisioned"
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

  [ "$(host_git symbolic-ref -q HEAD || true)" = refs/heads/main ] || die "$REPO_DIR is not on main (after a rollback, check out main first: README.md, Roll back)"
  old=$(host_git rev-parse HEAD)
  token=$(env_value GITHUB_TOKEN)
  [ -n "$token" ] || die "GITHUB_TOKEN is missing from $ENV_FILE"
  GITHUB_AUTH_HEADER="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$token" | base64 -w0)"
  export GITHUB_AUTH_HEADER
  image_git fetch --quiet origin main
  unset GITHUB_AUTH_HEADER
  image_git merge --ff-only --quiet origin/main
  new=$(host_git rev-parse HEAD)
  if [ "$old" = "$new" ]; then
    say "the clone is already at $new"
  else
    say "fast-forwarded $old to $new"
  fi

  # The image for the new commit: one already tagged with it (a rerun), the current image when
  # platform/ops did not change, or a new build. A rerun after a failed build builds again.
  before=$(image_id "$IMAGE:current")
  if [ -n "$(image_id "$IMAGE:$new")" ]; then
    docker tag "$IMAGE:$new" "$IMAGE:current"
  elif [ "$old" != "$new" ] && host_git diff --quiet "$old" "$new" -- platform/ops; then
    docker tag "$IMAGE:current" "$IMAGE:$new"
    say "platform/ops unchanged; $IMAGE:current also tagged $new"
  else
    if ! docker build --build-arg NODE_IMAGE="$NODE_IMAGE" \
      -f "$REPO_DIR/platform/ops/Dockerfile.dispatcher" \
      -t "$IMAGE:$new" -t "$IMAGE:current" "$REPO_DIR/platform/ops"; then
      die "the image build failed. The clone is at $new and the running dispatcher is unchanged; fix and run deploy.sh again, or roll back the clone (README.md, Roll back)"
    fi
    say "built $IMAGE:$new and :current"
  fi

  for unit in $UNITS; do
    if ! cmp -s "$REPO_DIR/platform/ops/$unit" "/etc/systemd/system/$unit"; then
      install -m 0644 "$REPO_DIR/platform/ops/$unit" "/etc/systemd/system/$unit"
      reload=1
      say "installed /etc/systemd/system/$unit"
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
