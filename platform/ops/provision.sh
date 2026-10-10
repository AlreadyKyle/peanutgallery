#!/usr/bin/env bash
# provision.sh: prepares an Ubuntu 24.04 instance (arm64 or x86; the board's is an Oracle Cloud
# Always Free Ampere host in Toronto) to run the dispatcher (docs/specs/vps.md).
# Run as root on the VPS. Idempotent: every step checks before it acts, and the last line counts the
# changes, so a second run reports 0. It enables the dispatcher unit and never starts it: starting
# it is the cutover (platform/ops/README.md).
#
# From the Mac, at the repository root, once /etc/peanutgallery/dispatcher.env is uploaded:
#   ssh root@<vps-ip> 'bash -s' < platform/ops/provision.sh
# or copy it over and run it there:
#   scp platform/ops/provision.sh root@<vps-ip>:/root/ && ssh root@<vps-ip> 'bash /root/provision.sh'
#
# The host holds two clones and a worktree folder (docs/specs/ops-separation.md):
#   /srv/peanutgallery-code       the code clone: root-owned, cloned by root, mounted read-only into
#                                 the container. The dispatcher and its node_modules run from here.
#   /srv/peanutgallery            the work clone: uid 10001's, cloned inside the image as uid 10001.
#                                 The dispatcher fetches, pushes and adds worktrees here.
#   /srv/peanutgallery-worktrees  uid 10001's: card, smoke and probe worktrees.
# Root never runs git or any other program from the work clone or the worktree folder: agent-written
# code can write to both.
#
# The clones authenticate with GITHUB_TOKEN from the environment when set, else with GITHUB_TOKEN
# from the env file, as a one-off header in git's environment. It is never written to .git/config.
# NODE_IMAGE=node:22-bookworm-slim@sha256:<digest> pins the base image for the build.
set -euo pipefail

REPO_URL=https://github.com/AlreadyKyle/peanutgallery.git
REPO_SLUG=AlreadyKyle/peanutgallery
CODE_DIR=/srv/peanutgallery-code
CODE_MOUNT=/opt/peanutgallery
WORK_DIR=/srv/peanutgallery
WORKTREE_DIR=/srv/peanutgallery-worktrees
BUILD_UID=10002
ETC_DIR=/etc/peanutgallery
ENV_FILE=$ETC_DIR/dispatcher.env
NTFY_FILE=$ETC_DIR/ntfy.url
AGENT_UID=10001
IMAGE=peanutgallery/dispatcher
NODE_IMAGE=${NODE_IMAGE:-node:22-bookworm-slim}
# The dispatcher's units, then the jobs' (docs/specs/money-safety.md): the backup, the Controller and
# the quota check, each a oneshot service run by its timer, and the alert their failures start.
UNITS="dispatcher.service dispatcher-alert.service peanutgallery-job-alert@.service peanutgallery-backup.service peanutgallery-backup.timer peanutgallery-controller.service peanutgallery-controller.timer peanutgallery-quota.service peanutgallery-quota.timer"
# Every unit but the alert template, which systemd-analyze verify cannot load on its own.
VERIFY_UNITS="dispatcher.service dispatcher-alert.service peanutgallery-backup.service peanutgallery-backup.timer peanutgallery-controller.service peanutgallery-controller.timer peanutgallery-quota.service peanutgallery-quota.timer"
# Where root runs the backup script from: installed from the commit, like the units.
JOB_LIB=/usr/local/lib/peanutgallery
SSHD_DROPIN=/etc/ssh/sshd_config.d/10-peanutgallery.conf

# The keys loadConfig requires (requireEnv in platform/dispatcher/src/config.ts, the managed agent ids
# and the read-only token among them), plus the studio key unattended mode requires and both alert
# URLs, which are optional on the Mac and required here. platform/ops/test/ops.test.mjs keeps this
# list equal to config.ts.
REQUIRED_KEYS="GITHUB_REPO SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY GITHUB_TOKEN NETLIFY_AUTH_TOKEN NETLIFY_SITE_ID_SEED NETLIFY_SITE_ID_PLATFORM MODEL_BUILDER PRICE_TABLE_JSON GITHUB_READ_TOKEN MANAGED_AGENT_ID MANAGED_AGENT_VERSION MANAGED_ENVIRONMENT_ID STUDIO_ANTHROPIC_API_KEY HEALTHCHECK_URL NTFY_TOPIC_URL"
# Secrets the dispatcher never needs: payments, the Supabase management token, the founder's key, the
# jobs' own secrets, which live in their env files only, and the database owner's password.
FORBIDDEN_KEYS="STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET SUPABASE_ACCESS_TOKEN ANTHROPIC_API_KEY STRIPE_READ_KEY BACKUP_DB_URL SUPABASE_DB_PASSWORD"
# The jobs, each with its env file /etc/peanutgallery/<job>.env and its timer peanutgallery-<job>.timer.
JOBS="backup controller quota"
# The Supabase CLI the backup dumps with, pinned; provision.sh checks its package against the release's
# own checksum file before installing it.
SUPABASE_CLI_VERSION=2.117.0
# Set by dispatcher.service, so the env file never carries a second value.
UNIT_KEYS="DISPATCHER_CODE_ROOT DISPATCHER_REPO_ROOT DISPATCHER_WORKTREE_ROOT DISPATCHER_CODE_READONLY"

CHANGES=0

say() { printf 'provision: %s\n' "$*"; }
changed() {
  CHANGES=$((CHANGES + 1))
  printf 'provision: changed: %s\n' "$*"
}
die() {
  printf 'provision: stopped: %s\n' "$*" >&2
  exit 1
}

# verify_units: systemd-analyze verify over every installed unit but the alert template.
verify_units() {
  local unit paths=()
  for unit in $VERIFY_UNITS; do paths+=("/etc/systemd/system/$unit"); done
  systemd-analyze verify "${paths[@]}"
}

# env_value <key> [file]: the value of KEY in a docker env file, or nothing.
env_value() {
  local file=${2:-$ENV_FILE}
  [ -f "$file" ] || return 0
  sed -n "s/^$1=//p" "$file" | tail -n 1
}

# check_env_lines <file>: the checks on a docker env file that need neither root nor docker. Prints
# one line per problem, naming keys and line numbers only, and returns 1 when there is any.
check_env_lines() {
  local file=$1 line key value lineno=0 seen=" " problems=0 name
  while IFS= read -r line || [ -n "$line" ]; do
    lineno=$((lineno + 1))
    case "$line" in '' | '#'*) continue ;; esac
    if [[ "$line" == *$'\r'* ]]; then
      echo "line $lineno ends in a carriage return; write the file with LF line endings"
      problems=1
      continue
    fi
    if ! [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
      echo "line $lineno is not KEY=value (no spaces, no export)"
      problems=1
      continue
    fi
    key=${line%%=*}
    value=${line#*=}
    case "$seen" in *" $key "*)
      echo "$key is set more than once"
      problems=1
      ;;
    esac
    seen="$seen$key "
    case "$value" in \"* | \'*)
      echo "$key starts with a quote; docker keeps quotes as part of the value"
      problems=1
      ;;
    esac
    # A Stripe secret key can move money; nothing on the VPS holds one, under any name
    # (docs/specs/money-safety.md).
    case "$value" in sk_live_* | sk_test_*)
      echo "$key holds a Stripe secret key; nothing on the VPS may hold one, under any name"
      problems=1
      ;;
    esac
  done < "$file"
  for name in $REQUIRED_KEYS; do
    if [ -z "$(env_value "$name" "$file")" ]; then
      echo "$name is missing or empty"
      problems=1
    fi
  done
  for name in $FORBIDDEN_KEYS; do
    if grep -q "^$name=" "$file"; then
      echo "$name must not be in the dispatcher's env file"
      problems=1
    fi
  done
  for name in $UNIT_KEYS; do
    if grep -q "^$name=" "$file"; then
      echo "$name is set by dispatcher.service; remove it from the env file"
      problems=1
    fi
  done
  value=$(env_value GITHUB_READ_TOKEN "$file")
  if [ -n "$value" ] && [ "$value" = "$(env_value GITHUB_TOKEN "$file")" ]; then
    echo "GITHUB_READ_TOKEN equals GITHUB_TOKEN; Managed Agents sessions need a token that cannot write"
    problems=1
  fi
  for name in GITHUB_TOKEN GITHUB_READ_TOKEN; do
    value=$(env_value "$name" "$file")
    case "$value" in '' | github_pat_*) ;; *)
      echo "$name is not a fine-grained personal access token (github_pat_...)"
      problems=1
      ;;
    esac
  done
  value=$(env_value MANAGED_AGENT_VERSION "$file")
  if [ -n "$value" ] && ! [[ "$value" =~ ^[1-9][0-9]*$ ]]; then
    echo "MANAGED_AGENT_VERSION must be a positive integer"
    problems=1
  fi
  value=$(env_value GITHUB_REPO "$file")
  if [ -n "$value" ] && [ "$value" != "$REPO_SLUG" ]; then
    echo "GITHUB_REPO is not $REPO_SLUG, the repository this VPS clones"
    problems=1
  fi
  for name in HEALTHCHECK_URL NTFY_TOPIC_URL SUPABASE_URL; do
    value=$(env_value "$name" "$file")
    case "$value" in '' | https://*) ;; *)
      echo "$name must be an https URL"
      problems=1
      ;;
    esac
  done
  # The optional Discord webhooks (docs/specs/studio-reports.md), with the dispatcher's own pattern.
  # Each is a bearer secret, so only the key is named.
  local discord_re='^https://((ptb|canary)[.])?discord(app)?[.]com/api/webhooks/[0-9]+/[A-Za-z0-9_-]+$'
  for name in DISCORD_WEBHOOK_SHIPS DISCORD_WEBHOOK_WEEKLY; do
    value=$(env_value "$name" "$file")
    if [ -n "$value" ] && ! [[ "$value" =~ $discord_re ]]; then
      echo "$name must be a Discord webhook address"
      problems=1
    fi
  done
  return "$problems"
}

check_host() {
  local os systemd_version
  [ "$(id -u)" -eq 0 ] || die "run as root"
  # shellcheck source=/dev/null
  os=$(. /etc/os-release && echo "$ID $VERSION_ID")
  [ "$os" = "ubuntu 24.04" ] || die "this is $os; the dispatcher's units are written for Ubuntu 24.04"
  case "$(uname -m)" in
    x86_64 | aarch64) ;;
    *) die "this is $(uname -m); the image is built for x86_64 and arm64 (aarch64)" ;;
  esac
  systemd_version=$(systemctl --version | awk 'NR == 1 { print $2 }')
  [ "${systemd_version%%.*}" -ge 254 ] || die "systemd $systemd_version has no RestartSteps (254 or later)"
  say "host: $os, $(uname -m), systemd $systemd_version"
}

install_packages() {
  local pkg status missing=()
  for pkg in git ufw unattended-upgrades curl jq ca-certificates age; do
    # shellcheck disable=SC2016 # ${Status} is dpkg-query's format field, not a shell variable
    status=$(dpkg-query -W -f='${Status}' "$pkg" 2> /dev/null || true)
    [ "$status" = "install ok installed" ] || missing+=("$pkg")
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    apt-get update -q
    DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends "${missing[@]}"
    changed "installed ${missing[*]}"
  fi
}

ensure_swap() {
  if [ -z "$(swapon --show --noheadings)" ]; then
    if [ ! -f /swapfile ]; then
      fallocate -l 2G /swapfile
      chmod 600 /swapfile
      mkswap /swapfile > /dev/null
    fi
    swapon /swapfile
    changed "2 GB swapfile on"
  fi
  if [ -f /swapfile ] && ! grep -qE '^/swapfile[[:space:]]' /etc/fstab; then
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    changed "swapfile added to /etc/fstab"
  fi
}

install_docker() {
  local codename
  if ! command -v docker > /dev/null 2>&1; then
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    # shellcheck source=/dev/null
    codename=$(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $codename stable" > /etc/apt/sources.list.d/docker.list
    apt-get update -q
    DEBIAN_FRONTEND=noninteractive apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin
    changed "Docker installed from Docker's apt repository"
  fi
  if ! systemctl is-enabled --quiet docker; then
    systemctl enable docker
    changed "docker enabled"
  fi
  if ! systemctl is-active --quiet docker; then
    systemctl start docker
    changed "docker started"
  fi
}

# No container publishes a port. Docker's -p would bypass ufw, so the provider's own firewall allows
# SSH only as well (README.md).
# Command output is captured before it is searched: under pipefail, grep -q closing a pipe early can
# fail the pipeline even on a match.
configure_firewall() {
  local out
  if ! grep -q '^DEFAULT_INPUT_POLICY="DROP"' /etc/default/ufw; then
    ufw default deny incoming > /dev/null
    changed "ufw denies incoming by default"
  fi
  if ! grep -q '^DEFAULT_OUTPUT_POLICY="ACCEPT"' /etc/default/ufw; then
    ufw default allow outgoing > /dev/null
    changed "ufw allows outgoing by default"
  fi
  out=$(ufw limit OpenSSH)
  case "$out" in
    *"Skipping adding existing rule"*) ;;
    *) changed "ufw limits OpenSSH" ;;
  esac
  out=$(ufw status)
  if ! grep -q '^Status: active' <<< "$out"; then
    ufw --force enable > /dev/null
    changed "ufw enabled"
  fi
}

# install_file <path> <mode>: writes stdin to path when the content differs. Sets WROTE to 1 when it
# wrote, else 0.
WROTE=0
install_file() {
  local dest=$1 mode=$2 tmp
  tmp=$(mktemp)
  cat > "$tmp"
  if [ -f "$dest" ] && cmp -s "$tmp" "$dest"; then
    rm -f "$tmp"
    WROTE=0
    return 0
  fi
  install -D -m "$mode" "$tmp" "$dest"
  rm -f "$tmp"
  WROTE=1
  changed "wrote $dest"
}

# The drop-in sorts before cloud-init's 50-cloud-init.conf: sshd keeps the first value it reads.
configure_sshd() {
  local effective
  [ -s /root/.ssh/authorized_keys ] || die "root has no authorized SSH key; add one before password login is turned off"
  install_file "$SSHD_DROPIN" 0644 << 'EOF'
# provision.sh (docs/specs/vps.md): key login only.
PasswordAuthentication no
PermitRootLogin prohibit-password
EOF
  if [ "$WROTE" = 1 ]; then
    if ! sshd -t; then
      rm -f "$SSHD_DROPIN"
      die "sshd rejected $SSHD_DROPIN; it was removed"
    fi
    systemctl try-reload-or-restart ssh
  fi
  effective=$(sshd -T)
  grep -qx 'passwordauthentication no' <<< "$effective" || die "sshd still allows passwords; another file in /etc/ssh/sshd_config.d sets it first"
  grep -qE '^permitrootlogin (prohibit-password|without-password)$' <<< "$effective" || die "sshd still allows root passwords; another file in /etc/ssh/sshd_config.d sets it first"
}

# Security updates install on their own; nothing reboots the VPS or restarts docker behind the
# board's back (a restart mid-card pauses the card).
configure_upgrades() {
  install_file /etc/apt/apt.conf.d/20auto-upgrades 0644 << 'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
  install_file /etc/apt/apt.conf.d/52peanutgallery-unattended-upgrades 0644 << 'EOF'
// provision.sh (docs/specs/vps.md): the board reboots by hand.
Unattended-Upgrade::Automatic-Reboot "false";
EOF
  install_file /etc/needrestart/conf.d/50-peanutgallery.conf 0644 << 'EOF'
# provision.sh (docs/specs/vps.md): list services that need a restart; restart none.
$nrconf{restart} = 'l';
EOF
  if ! systemctl is-enabled --quiet unattended-upgrades; then
    systemctl enable --now unattended-upgrades
    changed "unattended-upgrades enabled"
  fi
}

# github_header: the one-off https header for github.com, from GITHUB_TOKEN in the environment or
# the env file.
github_header() {
  local token
  token=${GITHUB_TOKEN:-$(env_value GITHUB_TOKEN)}
  [ -n "$token" ] || die "no GitHub token to clone with: upload $ENV_FILE first (README.md), or pass GITHUB_TOKEN for this run"
  printf 'AUTHORIZATION: basic %s' "$(printf 'x-access-token:%s' "$token" | base64 -w0)"
}

# ensure_dir <path> <owner uid> <mode>: creates the folder, or corrects the folder's own owner and
# mode. Never recursive: root does not walk a tree uid 10001 writes to.
ensure_dir() {
  local dir=$1 owner=$2 mode=$3
  [ ! -L "$dir" ] || die "$dir is a symlink; move it aside"
  if [ ! -d "$dir" ]; then
    install -d -o "$owner" -g "$owner" -m "$mode" "$dir"
    changed "created $dir ($owner:$owner, $mode)"
  elif [ "$(stat -c '%u:%g %a' "$dir")" != "$owner:$owner ${mode#0}" ]; then
    chown "$owner:$owner" "$dir"
    chmod "$mode" "$dir"
    changed "$dir set to $owner:$owner, $mode"
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

# agent_git <args>: git as uid 10001 inside the dispatcher image, in the work clone, with no capability
# and no env file. When GITHUB_AUTH_HEADER is exported it becomes git's one-off extraheader for
# github.com; docker passes it by name, so its value is on no command line and never in .git/config.
agent_git() {
  local config=(-e GIT_CONFIG_COUNT=0)
  if [ -n "${GITHUB_AUTH_HEADER:-}" ]; then
    config=(-e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=http.https://github.com/.extraheader -e GIT_CONFIG_VALUE_0)
  fi
  GIT_CONFIG_VALUE_0=${GITHUB_AUTH_HEADER:-} docker run --rm --pull never --user "$AGENT_UID:$AGENT_UID" \
    --cap-drop ALL --security-opt no-new-privileges \
    --volume "$WORK_DIR:$WORK_DIR" --workdir "$WORK_DIR" --entrypoint git "${config[@]}" \
    "$IMAGE:current" -c core.fsmonitor=false -c core.hooksPath=/dev/null "$@"
}

# The code clone: cloned by root over https, root-owned, clean. pnpm's store is excluded from git.
clone_code() {
  local header exclude problems
  install -d -m 0700 "$ETC_DIR"
  ensure_dir "$CODE_DIR" 0 0755
  if [ ! -d "$CODE_DIR/.git" ]; then
    [ -z "$(find "$CODE_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ] || die "$CODE_DIR has files but no .git; move it aside"
    header=$(github_header)
    (
      export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.https://github.com/.extraheader GIT_CONFIG_VALUE_0="$header"
      GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null git -c core.fsmonitor=false -c core.hooksPath=/dev/null clone --quiet "$REPO_URL" "$CODE_DIR"
    )
    changed "cloned $REPO_URL into $CODE_DIR"
  fi
  if ! problems=$(check_code_clone); then
    die "$problems"
  fi
  if code_git config --local --get-regexp extraheader > /dev/null; then
    die "$CODE_DIR/.git/config stores an extraheader; remove it: the token must never be on disk"
  fi
  [ "$(code_git config --local --get remote.origin.url)" = "$REPO_URL" ] || die "$CODE_DIR's origin is not $REPO_URL"
  exclude=$CODE_DIR/.git/info/exclude
  if ! grep -qxF .pnpm-store "$exclude" 2> /dev/null; then
    mkdir -p "$(dirname "$exclude")"
    echo .pnpm-store >> "$exclude"
    changed ".pnpm-store added to $exclude"
  fi
  if ! problems=$(check_clean); then
    die "$problems"
  fi
}

# node_modules in the code clone, installed by the build uid in a throwaway container (run_install).
# It runs when the installed lockfile differs from the committed one, so a second run changes nothing.
install_dependencies() {
  local problems
  if ! cmp -s "$CODE_DIR/pnpm-lock.yaml" "$CODE_DIR/node_modules/.pnpm/lock.yaml"; then
    if ! problems=$(prepare_install_dirs); then
      die "could not prepare node_modules for the install: $problems"
    fi
    run_install
    changed "installed node_modules in $CODE_DIR in a throwaway container"
  fi
}

# No setuid or setgid bit, root owns everything in the code clone, nothing in it is writable by group
# or others, and it is clean and holds no git state a clone does not have.
lock_code_clone() {
  local problems
  if [ -n "$(find "$CODE_DIR" ! -type l \( -perm -4000 -o -perm -2000 \) -print -quit)" ]; then
    find "$CODE_DIR" ! -type l \( -perm -4000 -o -perm -2000 \) -exec chmod ug-s {} +
    changed "setuid and setgid bits removed in $CODE_DIR"
  fi
  if [ -n "$(find "$CODE_DIR" \( ! -user 0 -o ! -group 0 \) -print -quit)" ]; then
    chown -hR 0:0 "$CODE_DIR"
    changed "$CODE_DIR owned by root"
  fi
  if [ -n "$(find "$CODE_DIR" ! -type l \( -perm -020 -o -perm -002 \) -print -quit)" ]; then
    find "$CODE_DIR" ! -type l \( -perm -020 -o -perm -002 \) -exec chmod go-w {} +
    changed "group and other write removed in $CODE_DIR"
  fi
  if ! problems=$(check_clean); then
    die "$problems"
  fi
  if ! problems=$(check_code_clone); then
    die "$problems"
  fi
}

# The work clone: uid 10001's, cloned inside the image as uid 10001, so root never runs git in a tree
# agent-written code can write to. The worktree folder beside it is uid 10001's too.
create_work_clone() {
  local origin
  ensure_dir "$WORK_DIR" "$AGENT_UID" 0755
  if [ ! -d "$WORK_DIR/.git" ]; then
    [ -z "$(find "$WORK_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ] || die "$WORK_DIR has files but no .git; move it aside"
    GITHUB_AUTH_HEADER=$(github_header)
    export GITHUB_AUTH_HEADER
    agent_git clone --quiet "$REPO_URL" "$WORK_DIR"
    unset GITHUB_AUTH_HEADER
    changed "cloned $REPO_URL into $WORK_DIR as uid $AGENT_UID"
  fi
  origin=$(agent_git config --get remote.origin.url) || die "could not read $WORK_DIR's origin"
  [ "$origin" = "$REPO_URL" ] || die "$WORK_DIR's origin is not $REPO_URL"
  if agent_git config --get-regexp extraheader > /dev/null; then
    die "$WORK_DIR/.git/config stores an extraheader; remove it: the token must never be on disk"
  fi
  ensure_dir "$WORKTREE_DIR" "$AGENT_UID" 0700
}

# read_token_verdict <GET status> <POST status> <POST body file>: the read-only token check, as the
# dispatcher makes it (platform/dispatcher/src/adapters/read-token.ts). Prints nothing and returns 0
# when the token reads the repository and GitHub refuses it a ref write for want of permission; else
# prints why and returns 1.
read_token_verdict() {
  local read=$1 write=$2 body=$3
  if [ "$read" != 200 ]; then
    echo "GITHUB_READ_TOKEN cannot read $REPO_SLUG (GET returned $read)"
    return 1
  fi
  if [ "$write" = 422 ]; then
    echo "GITHUB_READ_TOKEN can write to $REPO_SLUG: a ref write was refused only on validation (422); create a token with Contents read and nothing else"
    return 1
  fi
  if [ "$write" != 403 ] || ! grep -qiE 'resource not accessible by (personal access token|integration)' "$body"; then
    echo "GITHUB_READ_TOKEN write check returned $write; only a 403 permission denial proves the token cannot write"
    return 1
  fi
}

# check_read_token: proves GITHUB_READ_TOKEN reads the repository and cannot write it, with a ref write
# at the all-zero sha, which changes nothing whatever the answer. The token goes to curl in a header
# file, never on a command line.
check_read_token() {
  local work token read_status write_status problem
  token=$(env_value GITHUB_READ_TOKEN)
  [ -n "$token" ] || die "GITHUB_READ_TOKEN is missing from $ENV_FILE"
  work=$(mktemp -d)
  printf 'Authorization: Bearer %s\nAccept: application/vnd.github+json\nX-GitHub-Api-Version: 2022-11-28\nUser-Agent: peanutgallery-provision\n' "$token" > "$work/headers"
  read_status=$(curl -sS -g --max-time 20 -o /dev/null -w '%{http_code}' -H @"$work/headers" "https://api.github.com/repos/$REPO_SLUG") || read_status=000
  write_status=$(curl -sS -g --max-time 20 -o "$work/body" -w '%{http_code}' -H @"$work/headers" -X POST \
    -d '{"ref":"refs/heads/_read-token-probe","sha":"0000000000000000000000000000000000000000"}' "https://api.github.com/repos/$REPO_SLUG/git/refs") || write_status=000
  if ! problem=$(read_token_verdict "$read_status" "$write_status" "$work/body"); then
    rm -rf "$work"
    die "$problem"
  fi
  rm -rf "$work"
  say "GITHUB_READ_TOKEN: reads $REPO_SLUG and cannot write it"
}

check_env_file() {
  local problems
  if [ ! -f "$ENV_FILE" ]; then
    die "$ENV_FILE is missing. On the Mac, at the repository root:
  platform/ops/make-dispatcher-env.sh
  scp <the file it names> root@<vps-ip>:$ENV_FILE
  ssh root@<vps-ip> 'chown root:root $ENV_FILE && chmod 600 $ENV_FILE'
then run provision.sh again (README.md, Provision)."
  fi
  [ "$(stat -c '%U:%G %a' "$ENV_FILE")" = "root:root 600" ] || die "$ENV_FILE must be owned by root:root with mode 0600"
  if ! problems=$(check_env_lines "$ENV_FILE"); then
    die "$ENV_FILE:
$problems"
  fi
  # docker reads the file the way the service will; the JSON is parsed where the dispatcher parses it.
  # No network, and the node script prints no value.
  docker run --rm --network none --env-file "$ENV_FILE" "$NODE_IMAGE" node -e '
    let table;
    try { table = JSON.parse(process.env.PRICE_TABLE_JSON); } catch { console.error("PRICE_TABLE_JSON is not valid JSON"); process.exit(1); }
    if (typeof table !== "object" || table === null || Array.isArray(table) || Object.keys(table).length === 0) { console.error("PRICE_TABLE_JSON must be an object keyed by model id"); process.exit(1); }
    for (const name of ["MODEL_BUILDER", "MODEL_DIRECTOR", "MODEL_HOST"]) {
      const model = process.env[name];
      if ((name === "MODEL_BUILDER" || model) && !Object.hasOwn(table, model ?? "")) { console.error(name + " has no row in PRICE_TABLE_JSON"); process.exit(1); }
    }
  ' || die "$ENV_FILE: PRICE_TABLE_JSON failed the check above"
  say "env file: valid"
  if [ ! -s "$NTFY_FILE" ]; then
    say "note: $NTFY_FILE is missing, so dispatcher-alert.service will post nothing (README.md, Provision)"
  fi
}

# The image is built from the code clone's commit, never from its working tree.
build_image() {
  local sha current wanted
  sha=$(code_git rev-parse HEAD)
  if docker image inspect "$IMAGE:$sha" > /dev/null 2>&1; then
    wanted=$(docker image inspect --format '{{.Id}}' "$IMAGE:$sha")
    current=$(docker image inspect --format '{{.Id}}' "$IMAGE:current" 2> /dev/null || true)
    if [ "$current" != "$wanted" ]; then
      docker tag "$IMAGE:$sha" "$IMAGE:current"
      changed "$IMAGE:current tagged $sha"
    fi
  else
    build_context "$sha" | docker build --build-arg NODE_IMAGE="$NODE_IMAGE" -f Dockerfile.dispatcher -t "$IMAGE:$sha" -t "$IMAGE:current" -
    changed "built $IMAGE:$sha and :current from $sha"
  fi
}

# The units as committed at the code clone's HEAD, and the backup script peanutgallery-backup.service
# runs. systemd-analyze verify refuses a unit whose ExecStart does not exist, so the script goes in
# before the units are verified, on a fresh host too.
install_units() {
  local unit sha text reload=0
  sha=$(code_git rev-parse HEAD)
  for unit in $UNITS; do
    text=$(mktemp)
    unit_text "$sha" "$unit" > "$text"
    install_file "/etc/systemd/system/$unit" 0644 < "$text"
    rm -f "$text"
    if [ "$WROTE" = 1 ]; then
      reload=1
    fi
  done
  install_job_scripts
  if [ "$reload" = 1 ]; then
    systemctl daemon-reload
  fi
  verify_units || die "systemd-analyze verify failed on the units"
  if ! systemctl is-enabled --quiet dispatcher; then
    systemctl enable dispatcher
    changed "dispatcher enabled (not started)"
  fi
}

# The backup script, as committed at the code clone's HEAD.
install_job_scripts() {
  local sha text
  sha=$(code_git rev-parse HEAD)
  text=$(mktemp)
  unit_text "$sha" backup/backup.sh > "$text"
  install_file "$JOB_LIB/backup.sh" 0755 < "$text"
  rm -f "$text"
}

# install_supabase_cli: the pinned Supabase CLI, from its GitHub release, checked against the
# release's checksum file. The backup's `supabase db dump` runs pg_dump in Docker, so no Postgres
# client is installed on the host.
install_supabase_cli() {
  local arch work deb base
  if [ "$(supabase --version 2> /dev/null || true)" = "$SUPABASE_CLI_VERSION" ]; then
    return 0
  fi
  arch=$(dpkg --print-architecture)
  deb="supabase_${SUPABASE_CLI_VERSION}_linux_${arch}.deb"
  base="https://github.com/supabase/cli/releases/download/v$SUPABASE_CLI_VERSION"
  work=$(mktemp -d)
  curl -fsSL -o "$work/$deb" "$base/$deb" || die "could not download $deb"
  curl -fsSL -o "$work/checksums.txt" "$base/supabase_${SUPABASE_CLI_VERSION}_checksums.txt" || die "could not download the Supabase CLI checksums"
  if ! (cd "$work" && grep -E " \*?$deb\$" checksums.txt | sha256sum -c - > /dev/null); then
    rm -rf "$work"
    die "$deb does not match the checksum its release publishes"
  fi
  dpkg -i "$work/$deb" > /dev/null
  rm -rf "$work"
  [ "$(supabase --version)" = "$SUPABASE_CLI_VERSION" ] || die "the Supabase CLI did not install as $SUPABASE_CLI_VERSION"
  changed "Supabase CLI $SUPABASE_CLI_VERSION installed"
}

# check_job_env <job>: returns 0 when /etc/peanutgallery/<job>.env exists and passes the job's checks
# (platform/ops/jobs/check-env.mjs, in the image, as nobody, with no network; the file goes in on
# stdin, so it stays root 0600), 1 when it is missing. Stops on a file that fails.
check_job_env() {
  local job=$1 file=$ETC_DIR/$1.env problems
  if [ ! -f "$file" ]; then
    say "note: $file is missing, so peanutgallery-$job.timer stays off (README.md, Backups and the Controller)"
    return 1
  fi
  [ "$(stat -c '%U:%G %a' "$file")" = "root:root 600" ] || die "$file must be owned by root:root with mode 0600"
  if ! problems=$(docker run --rm -i --pull never --network none --user 65534:65534 --cap-drop ALL --security-opt no-new-privileges \
    --volume "$CODE_DIR:$CODE_MOUNT:ro" --entrypoint node "$IMAGE:current" \
    "$CODE_MOUNT/platform/ops/jobs/check-env.mjs" "$job" /dev/stdin < "$file"); then
    die "$file:
$problems"
  fi
  say "$job env file: valid"
}

# The jobs: the backup's tools (install_units installed its script), then each timer whose env file
# passes. A timer only schedules its job; nothing here runs one.
install_jobs() {
  local job timer
  install_supabase_cli
  for job in $JOBS; do
    timer=peanutgallery-$job.timer
    if check_job_env "$job" && ! systemctl is-enabled --quiet "$timer"; then
      systemctl enable --now "$timer"
      changed "$timer enabled"
    fi
  done
}

main() {
  check_host
  install_packages
  ensure_swap
  install_docker
  configure_firewall
  configure_sshd
  configure_upgrades
  clone_code
  check_env_file
  check_read_token
  build_image
  install_dependencies
  lock_code_clone
  create_work_clone
  install_units
  install_jobs
  if systemctl is-active --quiet dispatcher; then
    say "the dispatcher is running"
  else
    say "the dispatcher is enabled and not running; starting it is the cutover (README.md, Cutover)"
  fi
  say "done: $CHANGES change(s)"
}

# PROVISION_SOURCE_ONLY=1 loads the functions without running anything (the ops tests use it).
# stdin is closed for the run: under `ssh ... 'bash -s' < provision.sh` it is the script itself, and a
# command that read it would swallow the rest.
if [ "${PROVISION_SOURCE_ONLY:-}" != 1 ]; then
  main "$@" < /dev/null
fi
