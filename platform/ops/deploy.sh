#!/usr/bin/env bash
# deploy.sh: updates the VPS dispatcher to origin/main, or rolls it back to an older commit of main
# with --ref <sha> (docs/specs/vps.md, docs/specs/ops-separation.md). Run as root on the VPS the way
# provision.sh runs: piped over ssh from a checkout of main on the Mac that the board has reviewed,
# never from a file on the VPS.
#   ssh root@<vps-ip> 'bash -s' < platform/ops/deploy.sh
#   ssh root@<vps-ip> 'bash -s -- --confirm <first 12 characters of the target sha>' < platform/ops/deploy.sh
#   ssh root@<vps-ip> 'bash -s -- --ref <sha> --confirm <first 12 characters of sha>' < platform/ops/deploy.sh
# The script reads nothing from its own location: the copy on the VPS is in the clone it distrusts.
#
# Pause from /board first and let any building card finish: the script refuses unless
# studio_state.paused is true and no card is building or gated.
#
# It works in the code clone only, /srv/peanutgallery-code, which root owns and the container mounts
# read-only. It refuses the clone when it has an uncommitted or untracked file or git state a clone
# does not have. It fetches main from the repository's own URL, checks that the target commit's gate
# check passed on GitHub, prints what the target changes, and moves only once a person confirms the
# target sha. Everything root acts on comes from the commit: the image is built from `git archive` and
# the units from `git show`. node_modules are installed by a build uid in a throwaway container that
# can write node_modules and nothing else, and the clone is checked again and locked to root. It
# restarts the service, waits for this start's `code root is read-only` and `startup probe passed`
# lines, and reminds you to resume.
#
# It never runs git or anything else in the work clone, /srv/peanutgallery: uid 10001 and
# agent-written code can write there, and the dispatcher fetches in it itself.
# NODE_IMAGE=node:22-bookworm-slim@sha256:<digest> pins the base image when it rebuilds.
set -euo pipefail

REPO_URL=https://github.com/AlreadyKyle/peanutgallery.git
REPO_SLUG=AlreadyKyle/peanutgallery
CODE_DIR=/srv/peanutgallery-code
CODE_MOUNT=/opt/peanutgallery
WORK_DIR=/srv/peanutgallery
WORKTREE_DIR=/srv/peanutgallery-worktrees
ENV_FILE=/etc/peanutgallery/dispatcher.env
IMAGE=peanutgallery/dispatcher
BUILD_UID=10002
NODE_IMAGE=${NODE_IMAGE:-node:22-bookworm-slim}
UNITS="dispatcher.service dispatcher-alert.service"
PROBE_WAIT_SECONDS=${PROBE_WAIT_SECONDS:-600}
CONFIRM_TTY=${CONFIRM_TTY:-/dev/tty}
USAGE="usage: deploy.sh [--ref <commit sha>] [--confirm <first 12 characters of the target sha>]"
# The oldest commit --ref may roll back to: the merge of docs/specs/ops-separation.md into main.
# Older commits run the dispatcher from a clone uid 10001 can write. The board fills it with that
# merge sha when the change lands and moves it forward only; while it is empty, --ref is refused.
ROLLBACK_FLOOR=""
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

# github_get <route>: a GitHub API read with the env file's token, which goes to curl in a header
# file, never on a command line.
github_get() {
  local token
  token=$(env_value GITHUB_TOKEN)
  [ -n "$token" ] || die "GITHUB_TOKEN is missing from $ENV_FILE"
  printf 'Authorization: Bearer %s\nAccept: application/vnd.github+json\nX-GitHub-Api-Version: 2022-11-28\nUser-Agent: peanutgallery-deploy\n' "$token" > "$WORK/github-headers"
  curl -fsS -g --max-time 20 -H @"$WORK/github-headers" "https://api.github.com$1"
}

# gate_verdict <check-runs JSON>: the latest check run named gate that GitHub Actions created:
# success, another conclusion, pending, missing, or unreadable when the answer is not a list of runs.
gate_verdict() {
  printf '%s' "$1" | jq -r '
    if type == "object" and (.check_runs | type) == "array" then
      [.check_runs[] | select(.name == "gate" and .app.slug == "github-actions")]
      | if length == 0 then "missing" else (max_by(.id) | if .status != "completed" then "pending" else (.conclusion // "unknown") end) end
    else "unreadable" end' 2> /dev/null || echo unreadable
}

# check_gate <sha>: returns 0 when the gate check on sha concluded success, else prints why and
# returns 1.
check_gate() {
  local runs verdict
  if ! runs=$(github_get "/repos/$REPO_SLUG/commits/$1/check-runs?check_name=gate&filter=all&per_page=100"); then
    echo "could not read the check runs of $1 from GitHub"
    return 1
  fi
  verdict=$(gate_verdict "$runs")
  if [ "$verdict" != success ]; then
    echo "the gate check on $1 is $verdict, not success"
    return 1
  fi
}

# >>> code clone functions: identical in deploy.sh and provision.sh (platform/ops/test/ops.test.mjs)

# code_git <args>: git in the code clone, as root. No system or global configuration is read,
# replacement objects are ignored, no pager runs, and core.fsmonitor and hooks are off on the
# command line, which overrides any value in the clone's own configuration.
code_git() {
  GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_NO_REPLACE_OBJECTS=1 GIT_PAGER=cat \
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
Then move the clone aside and run provision.sh again (README.md, Roll back)."
  return 1
}

# The keys git writes in a clone's own configuration. Any other key (a credential helper, a proxy or
# ssh command, an attributes or excludes file, a worktree) is refused.
CODE_CONFIG_KEYS=" core.repositoryformatversion core.filemode core.bare core.logallrefupdates core.ignorecase core.precomposeunicode core.symlinks remote.origin.url remote.origin.fetch branch.main.remote branch.main.merge extensions.objectformat lfs.repositoryformatversion "

# check_code_clone: refuses state in the code clone that would make git or node act on something
# other than the commit: a .git that is not a folder, index flags other than H (assume-unchanged,
# skip-worktree), configuration keys git does not write for a clone, info/attributes, info/grafts,
# commondir or objects/info/alternates, a setuid or setgid file, and a symlink that is absolute, does
# not resolve, or resolves outside the clone. Prints one line per problem and returns 1 when there
# is any.
check_code_clone() {
  local problems=0 list entry keys key file root links outside
  if [ ! -d "$CODE_DIR/.git" ] || [ -L "$CODE_DIR/.git" ]; then
    echo "$CODE_DIR/.git is not a folder"
    return 1
  fi
  list=$(mktemp)
  if ! code_git ls-files -v -z > "$list"; then
    echo "could not list the index of $CODE_DIR"
    problems=1
  fi
  while IFS= read -r -d '' entry; do
    case "$entry" in
      'H '*) ;;
      *)
        echo "the index marks ${entry#* } with ${entry%% *}; only H is expected (no assume-unchanged or skip-worktree)"
        problems=1
        ;;
    esac
  done < "$list"
  rm -f "$list"
  if ! keys=$(code_git config --local --name-only --list); then
    echo "could not read $CODE_DIR/.git/config"
    problems=1
  fi
  while IFS= read -r key; do
    [ -n "$key" ] || continue
    case "$CODE_CONFIG_KEYS" in
      *" $key "*) ;;
      *)
        echo "$CODE_DIR/.git/config sets $key, which git does not write for a clone"
        problems=1
        ;;
    esac
  done <<< "$keys"
  for file in info/attributes info/grafts commondir objects/info/alternates; do
    if [ -e "$CODE_DIR/.git/$file" ] || [ -L "$CODE_DIR/.git/$file" ]; then
      echo "$CODE_DIR/.git/$file exists; a clone has none"
      problems=1
    fi
  done
  file=$(find "$CODE_DIR" ! -type l \( -perm -4000 -o -perm -2000 \) -print -quit)
  if [ -n "$file" ]; then
    echo "$file is setuid or setgid"
    problems=1
  fi
  file=$(find "$CODE_DIR" -type l -lname '/*' -print -quit)
  if [ -n "$file" ]; then
    echo "$file is an absolute symlink"
    problems=1
  fi
  root=$(cd "$CODE_DIR" && pwd -P)
  if ! links=$(find "$CODE_DIR" -type l -exec readlink -f {} +); then
    echo "$CODE_DIR has a symlink that does not resolve"
    problems=1
  fi
  # readlink -f accepts a link whose last part is missing, so a dangling link needs its own check.
  file=$(find "$CODE_DIR" -type l ! -exec test -e {} ';' -print -quit)
  if [ -n "$file" ]; then
    echo "$file is a symlink that does not resolve"
    problems=1
  fi
  outside=$(printf '%s\n' "$links" | awk -v root="$root" 'NF && index($0, root "/") != 1 && $0 != root { print; exit }')
  if [ -n "$outside" ]; then
    echo "a symlink in $CODE_DIR resolves outside it, to $outside"
    problems=1
  fi
  [ "$problems" = 0 ]
}

# own_for_build <folder>: creates the folder for the build uid, or gives an existing one to it.
own_for_build() {
  if [ -L "$1" ]; then
    echo "$1 is a symlink"
    return 1
  fi
  if [ -d "$1" ]; then
    chown -hR "$BUILD_UID:$BUILD_UID" "$1"
  else
    install -d -o "$BUILD_UID" -g "$BUILD_UID" -m 0755 "$1"
  fi
}

# prepare_install_dirs: gives the build uid the only folders pnpm install writes: node_modules beside
# every tracked package.json, and the pnpm store. The rest of the code clone stays root's.
prepare_install_dirs() {
  local list entry failed
  list=$(mktemp)
  if ! code_git ls-files -z -- package.json '*/package.json' > "$list"; then
    rm -f "$list"
    echo "could not list the package.json files in $CODE_DIR"
    return 1
  fi
  failed=0
  while IFS= read -r -d '' entry; do
    if ! own_for_build "$CODE_DIR/$(dirname "$entry")/node_modules"; then
      failed=1
      break
    fi
  done < "$list"
  rm -f "$list"
  if [ "$failed" -ne 0 ]; then
    return 1
  fi
  own_for_build "$CODE_DIR/.pnpm-store"
}

# run_install: pnpm install into the code clone in a throwaway container, as the build uid, with no
# capability, no env file and an environment of four names. .git is mounted read-only over the code
# mount, and the build uid owns only the folders prepare_install_dirs gave it, so neither pnpm nor a
# dependency script can change git state or a tracked file. Root is not needed: pnpm writes only
# node_modules and the store.
run_install() {
  docker run --rm --pull never --user "$BUILD_UID:$BUILD_UID" --cap-drop ALL --security-opt no-new-privileges \
    --volume "$CODE_DIR:$CODE_MOUNT" --volume "$CODE_DIR/.git:$CODE_MOUNT/.git:ro" \
    --workdir "$CODE_MOUNT" --entrypoint /usr/bin/env \
    "$IMAGE:current" -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp CI=true \
    pnpm_config_store_dir="$CODE_MOUNT/.pnpm-store" \
    pnpm install --frozen-lockfile --prefer-offline
}

# unit_text <sha> <unit>: the unit file as committed at sha.
unit_text() {
  code_git show "$1:platform/ops/$2"
}

# build_context <sha>: platform/ops as committed at sha, as a tar stream for docker build.
build_context() {
  code_git archive --format=tar "$1:platform/ops"
}

# <<< code clone functions

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

# check_ref <sha>: returns 0 when a roll back may go to sha, else prints why and returns 1. The sha
# must be on origin/main, at or after ROLLBACK_FLOOR, and carry platform/ops/managed-settings.json,
# so a roll back never returns to a layout where the dispatcher runs from a clone it can write.
check_ref() {
  local ref=$1
  if ! [[ "$ROLLBACK_FLOOR" =~ ^[0-9a-f]{40}$ ]]; then
    echo "ROLLBACK_FLOOR in deploy.sh is not set to a commit sha, so no roll back is allowed yet; the board sets it to the merge of docs/specs/ops-separation.md"
    return 1
  fi
  if ! code_git cat-file -e "$ref^{commit}" 2> /dev/null; then
    echo "$ref is not a commit in $CODE_DIR"
    return 1
  fi
  if ! code_git merge-base --is-ancestor "$ref" refs/remotes/origin/main 2> /dev/null; then
    echo "$ref is not a commit on origin/main"
    return 1
  fi
  if ! code_git merge-base --is-ancestor "$ROLLBACK_FLOOR" "$ref" 2> /dev/null; then
    echo "$ref is older than the rollback floor $ROLLBACK_FLOOR"
    return 1
  fi
  if ! code_git cat-file -e "$ref:platform/ops/managed-settings.json" 2> /dev/null; then
    echo "$ref has no platform/ops/managed-settings.json"
    return 1
  fi
}

# review_target <deployed sha> <target sha>: what the deploy would change, for a person to read: the
# commits the target adds and removes, and a diff stat of the paths root and the dispatcher run.
# Control characters other than tab and newline are removed, so a commit message cannot drive the
# terminal.
review_target() {
  {
    echo "deployed: $1"
    echo "target:   $2"
    echo "commits the target adds:"
    code_git log --oneline --no-decorate "$1..$2"
    echo "commits the target removes:"
    code_git log --oneline --no-decorate "$2..$1"
    echo "changes to platform/ops, platform/dispatcher, package.json, pnpm-lock.yaml and .github:"
    code_git diff --stat "$1" "$2" -- platform/ops platform/dispatcher package.json pnpm-lock.yaml .github
  } | LC_ALL=C tr -d '\000-\010\013-\037\177'
}

# confirm_target <target sha> <--confirm value, or empty>: returns 0 when the value, or what the
# operator types at the terminal, is the target's first 12 characters. Under ssh ... 'bash -s' there
# is no terminal, so the operator reads the review and runs deploy.sh again with --confirm.
confirm_target() {
  local want=${1:0:12} answer=$2
  if [ -z "$answer" ]; then
    if (exec < "$CONFIRM_TTY") 2> /dev/null; then
      printf 'Type the first 12 characters of the target sha to deploy it: ' > "$CONFIRM_TTY"
      read -r answer < "$CONFIRM_TTY" || answer=""
    else
      echo "read the review above; to deploy $1, run deploy.sh again with --confirm <its first 12 characters> (README.md, Deploy an update)"
      return 1
    fi
  fi
  if [ "$answer" != "$want" ]; then
    echo "the confirmation '$answer' is not the first 12 characters of the target $1; nothing was deployed"
    return 1
  fi
}

# lock_code_clone: no setuid or setgid bit, root owns everything in the code clone, and nothing in it
# is writable by group or others, so neither uid 10001 nor the build uid can change the code the
# dispatcher runs. chown -h and find's ! -type l leave symlinks' targets alone.
lock_code_clone() {
  find "$CODE_DIR" ! -type l \( -perm -4000 -o -perm -2000 \) -exec chmod ug-s {} +
  if [ -n "$(find "$CODE_DIR" \( ! -user 0 -o ! -group 0 \) -print -quit)" ]; then
    chown -hR 0:0 "$CODE_DIR"
  fi
  find "$CODE_DIR" ! -type l \( -perm -020 -o -perm -002 \) -exec chmod go-w {} +
}

# probe_passed <journal lines of one start>: 0 when `code root is read-only` is logged before
# `startup probe passed`, in the order the dispatcher logs them.
probe_passed() {
  local readonly_line probe_line
  readonly_line=$(grep -m 1 -nF '"msg":"code root is read-only"' <<< "$1" | cut -d: -f1 || true)
  probe_line=$(grep -m 1 -nF '"msg":"startup probe passed"' <<< "$1" | cut -d: -f1 || true)
  [ -n "$readonly_line" ] && [ -n "$probe_line" ] && [ "$readonly_line" -lt "$probe_line" ]
}

# wait_for_probe <invocation id before the restart>: reads only the journal of the unit's current
# start (_SYSTEMD_INVOCATION_ID), so a line an earlier container printed while it stopped, which agent
# code in it could forge, never counts. A retryable failure starts a new invocation, which is read in
# turn.
wait_for_probe() {
  local previous=$1 deadline id logs
  deadline=$(($(date +%s) + PROBE_WAIT_SECONDS))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    id=$(systemctl show -p InvocationID --value dispatcher 2> /dev/null || true)
    if [ -n "$id" ] && [ "$id" != "$previous" ]; then
      logs=$(journalctl _SYSTEMD_INVOCATION_ID="$id" --no-pager -o cat 2> /dev/null || true)
      if probe_passed "$logs"; then
        grep -F -e '"msg":"code root is read-only"' -e '"msg":"startup probe passed"' <<< "$logs"
        return 0
      fi
      # Only an exit systemd will not restart (78, logged with "restart":false) ends the wait; a
      # retryable startup failure exits 1 and systemd tries again after its back-off.
      if grep -qE 'dispatcher exited with an error.*"restart":false' <<< "$logs"; then
        tail -n 20 <<< "$logs"
        die "the dispatcher stopped at startup and will not restart; see the lines above, systemctl status dispatcher, and README.md (Roll back)"
      fi
    fi
    sleep 5
  done
  journalctl -u dispatcher -n 50 --no-pager
  die "no 'code root is read-only' then 'startup probe passed' within $PROBE_WAIT_SECONDS seconds; see README.md (Roll back)"
}

image_id() {
  docker image inspect --format '{{.Id}}' "$1" 2> /dev/null || true
}

main() {
  local ref="" confirm="" studio cards reason old new target origin_main token header unit reload=0 previous before
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
  if [ -n "$ref" ] && ! [[ "$ref" =~ ^[0-9a-f]{40}$ ]]; then
    die "--ref takes a full 40-character commit sha"
  fi
  if [ -n "$confirm" ] && ! [[ "$confirm" =~ ^[0-9a-f]{12}$ ]]; then
    die "--confirm takes the first 12 characters of the target sha"
  fi
  [ "$(id -u)" -eq 0 ] || die "run as root"
  [ -f "$ENV_FILE" ] || die "$ENV_FILE is missing; this VPS is not provisioned"
  [ -d "$CODE_DIR/.git" ] || die "$CODE_DIR is not a clone; run provision.sh (README.md, Provision)"
  [ -d "$WORK_DIR/.git" ] || die "$WORK_DIR is not a clone; run provision.sh (README.md, Provision)"
  [ -d "$WORKTREE_DIR" ] || die "$WORKTREE_DIR is missing; run provision.sh (README.md, Provision)"
  [ "$(env_value GITHUB_REPO)" = "$REPO_SLUG" ] || die "GITHUB_REPO in $ENV_FILE is not $REPO_SLUG"
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
  if ! reason=$(check_code_clone); then
    die "refused: $reason"
  fi
  [ "$(code_git config --local --get remote.origin.url)" = "$REPO_URL" ] || die "$CODE_DIR's origin is not $REPO_URL"
  old=$(code_git rev-parse --verify 'HEAD^{commit}')
  token=$(env_value GITHUB_TOKEN)
  [ -n "$token" ] || die "GITHUB_TOKEN is missing from $ENV_FILE"
  header="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$token" | base64 -w0)"
  # The fetch names the repository's URL rather than trusting remote.origin.url. The token reaches git
  # as configuration in its environment for this one command, so it is on no command line and never in
  # .git/config.
  (
    export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.https://github.com/.extraheader GIT_CONFIG_VALUE_0="$header"
    code_git fetch --quiet "$REPO_URL" +refs/heads/main:refs/remotes/origin/main
  ) || die "could not fetch main from $REPO_URL into $CODE_DIR"
  origin_main=$(code_git rev-parse --verify 'refs/remotes/origin/main^{commit}')

  if [ -z "$ref" ]; then
    target=$origin_main
    code_git merge-base --is-ancestor refs/heads/main "$target" || die "main in $CODE_DIR does not fast-forward to origin/main; treat it as tampering and inspect the clone"
  else
    if ! reason=$(check_ref "$ref"); then
      die "refused: $reason"
    fi
    target=$ref
  fi

  # A person confirms every move of the code clone, after GitHub confirms the gate passed on the
  # target. Anyone holding the GitHub token could push to main; the review is what stops a commit the
  # board did not merge from running as root.
  if [ "$target" != "$old" ]; then
    if ! reason=$(check_gate "$target"); then
      die "refused: $reason"
    fi
    say "the gate check on $target concluded success"
    review_target "$old" "$target"
    if ! reason=$(confirm_target "$target" "$confirm"); then
      die "$reason"
    fi
  fi

  if [ -z "$ref" ]; then
    # After a roll back the clone is detached; a plain deploy returns it to main first.
    if [ "$(code_git symbolic-ref -q HEAD || true)" != refs/heads/main ]; then
      code_git checkout --quiet main
    fi
    code_git merge --ff-only --quiet "$target" || die "main in $CODE_DIR does not fast-forward to $target"
  else
    code_git checkout --quiet --detach "$target"
  fi
  new=$(code_git rev-parse --verify 'HEAD^{commit}')
  [ "$new" = "$target" ] || die "HEAD in $CODE_DIR is $new, not $target"
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

  if ! reason=$(prepare_install_dirs); then
    die "could not prepare node_modules for the install: $reason"
  fi
  run_install || die "pnpm install failed in the throwaway container. The code clone is at $new; fix and run deploy.sh again, or roll back (README.md, Roll back)"
  lock_code_clone
  if ! reason=$(check_clean); then
    die "the install left the code clone dirty: $reason"
  fi
  if ! reason=$(check_code_clone); then
    die "the install left the code clone unsafe: $reason"
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

  previous=$(systemctl show -p InvocationID --value dispatcher 2> /dev/null || true)
  systemctl reset-failed dispatcher 2> /dev/null || true
  systemctl restart dispatcher
  say "restarted; waiting up to $PROBE_WAIT_SECONDS seconds for the startup probe"
  wait_for_probe "$previous"
  say "deployed $new. Resume from /board."
}

# DEPLOY_SOURCE_ONLY=1 loads the functions without running anything (the ops tests use it). stdin is
# closed for the run: under ssh ... 'bash -s' it is the script itself, and a command that read it
# would swallow the rest.
if [ "${DEPLOY_SOURCE_ONLY:-}" != 1 ]; then
  main "$@" < /dev/null
  exit
fi
