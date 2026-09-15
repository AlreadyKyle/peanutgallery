#!/usr/bin/env bash
# provision.sh: prepares a Hetzner Ubuntu 24.04 x86 instance to run the dispatcher (docs/specs/vps.md).
# Run as root on the VPS. Idempotent: every step checks before it acts, and the last line counts the
# changes, so a second run reports 0. It enables the dispatcher unit and never starts it: starting
# it is the cutover (platform/ops/README.md).
#
# From the Mac, at the repository root, once /etc/peanutgallery/dispatcher.env is uploaded:
#   ssh root@<vps-ip> 'bash -s' < platform/ops/provision.sh
# or copy it over and run it there:
#   scp platform/ops/provision.sh root@<vps-ip>:/root/ && ssh root@<vps-ip> 'bash /root/provision.sh'
#
# The clone authenticates with GITHUB_TOKEN from the environment when set, else with GITHUB_TOKEN
# from the env file, as a one-off header in git's environment. It is never written to .git/config.
# NODE_IMAGE=node:22-bookworm-slim@sha256:<digest> pins the base image for the build.
set -euo pipefail

REPO_URL=https://github.com/AlreadyKyle/peanutgallery.git
REPO_SLUG=AlreadyKyle/peanutgallery
REPO_DIR=/srv/peanutgallery
ETC_DIR=/etc/peanutgallery
ENV_FILE=$ETC_DIR/dispatcher.env
NTFY_FILE=$ETC_DIR/ntfy.url
AGENT_UID=10001
IMAGE=peanutgallery/dispatcher
NODE_IMAGE=${NODE_IMAGE:-node:22-bookworm-slim}
UNITS="dispatcher.service dispatcher-alert.service"
SSHD_DROPIN=/etc/ssh/sshd_config.d/10-peanutgallery.conf

# The keys loadConfig requires (requireEnv in platform/dispatcher/src/config.ts), plus the studio key
# unattended mode requires and both alert URLs, which are optional on the Mac and required here.
# platform/ops/test/ops.test.mjs keeps this list equal to config.ts.
REQUIRED_KEYS="GITHUB_REPO SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY GITHUB_TOKEN NETLIFY_AUTH_TOKEN NETLIFY_SITE_ID_SEED NETLIFY_SITE_ID_PLATFORM MODEL_BUILDER PRICE_TABLE_JSON STUDIO_ANTHROPIC_API_KEY HEALTHCHECK_URL NTFY_TOPIC_URL"
# Secrets the dispatcher never needs: payments, the Supabase management token, the founder's key.
FORBIDDEN_KEYS="STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET SUPABASE_ACCESS_TOKEN ANTHROPIC_API_KEY"

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
  done < "$file"
  if [ "$(env_value AGENT_MODE "$file")" != unattended ]; then
    echo "AGENT_MODE must be unattended"
    problems=1
  fi
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
  return "$problems"
}

check_host() {
  local os systemd_version
  [ "$(id -u)" -eq 0 ] || die "run as root"
  # shellcheck source=/dev/null
  os=$(. /etc/os-release && echo "$ID $VERSION_ID")
  [ "$os" = "ubuntu 24.04" ] || die "this is $os; the dispatcher's units are written for Ubuntu 24.04"
  [ "$(uname -m)" = x86_64 ] || die "this is $(uname -m); the image is built for x86_64"
  systemd_version=$(systemctl --version | awk 'NR == 1 { print $2 }')
  [ "${systemd_version%%.*}" -ge 254 ] || die "systemd $systemd_version has no RestartSteps (254 or later)"
  say "host: $os, $(uname -m), systemd $systemd_version"
}

install_packages() {
  local pkg status missing=()
  for pkg in git ufw unattended-upgrades curl jq ca-certificates; do
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

# No container publishes a port. Docker's -p would bypass ufw, so the Hetzner Cloud firewall allows
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

clone_repository() {
  local token header entry exclude
  install -d -m 0700 "$ETC_DIR"
  if [ ! -d "$REPO_DIR/.git" ]; then
    token=${GITHUB_TOKEN:-$(env_value GITHUB_TOKEN)}
    [ -n "$token" ] || die "no GitHub token to clone with: upload $ENV_FILE first (README.md), or pass GITHUB_TOKEN for this run"
    header="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$token" | base64 -w0)"
    mkdir -p "$(dirname "$REPO_DIR")"
    GIT_CONFIG_COUNT=2 \
      GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null \
      GIT_CONFIG_KEY_1=http.https://github.com/.extraheader GIT_CONFIG_VALUE_1="$header" \
      git clone --quiet "$REPO_URL" "$REPO_DIR"
    changed "cloned $REPO_URL into $REPO_DIR"
  fi
  if git config --file "$REPO_DIR/.git/config" --get-regexp 'extraheader' > /dev/null; then
    die "$REPO_DIR/.git/config stores an extraheader; remove it: the token must never be on disk"
  fi
  [ "$(git config --file "$REPO_DIR/.git/config" --get remote.origin.url)" = "$REPO_URL" ] || die "$REPO_DIR's origin is not $REPO_URL"
  exclude=$REPO_DIR/.git/info/exclude
  for entry in .pnpm-store .worktrees; do
    if ! grep -qxF "$entry" "$exclude" 2> /dev/null; then
      mkdir -p "$(dirname "$exclude")"
      echo "$entry" >> "$exclude"
      changed "$entry added to .git/info/exclude"
    fi
  done
  if [ -n "$(find "$REPO_DIR" \( ! -uid "$AGENT_UID" -o ! -gid "$AGENT_UID" \) -print -quit)" ]; then
    chown -R "$AGENT_UID:$AGENT_UID" "$REPO_DIR"
    changed "$REPO_DIR owned by $AGENT_UID:$AGENT_UID"
  fi
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
    if (!Object.hasOwn(table, process.env.MODEL_BUILDER)) { console.error("MODEL_BUILDER has no row in PRICE_TABLE_JSON"); process.exit(1); }
  ' || die "$ENV_FILE: PRICE_TABLE_JSON failed the check above"
  say "env file: valid"
  if [ ! -s "$NTFY_FILE" ]; then
    say "note: $NTFY_FILE is missing, so dispatcher-alert.service will post nothing (README.md, Provision)"
  fi
}

build_image() {
  local sha current wanted
  sha=$(git -c safe.directory="$REPO_DIR" -C "$REPO_DIR" rev-parse HEAD)
  if docker image inspect "$IMAGE:$sha" > /dev/null 2>&1; then
    wanted=$(docker image inspect --format '{{.Id}}' "$IMAGE:$sha")
    current=$(docker image inspect --format '{{.Id}}' "$IMAGE:current" 2> /dev/null || true)
    if [ "$current" != "$wanted" ]; then
      docker tag "$IMAGE:$sha" "$IMAGE:current"
      changed "$IMAGE:current tagged $sha"
    fi
  else
    docker build --build-arg NODE_IMAGE="$NODE_IMAGE" \
      -f "$REPO_DIR/platform/ops/Dockerfile.dispatcher" \
      -t "$IMAGE:$sha" -t "$IMAGE:current" "$REPO_DIR/platform/ops"
    changed "built $IMAGE:$sha and :current"
  fi
}

install_units() {
  local unit reload=0
  for unit in $UNITS; do
    if ! cmp -s "$REPO_DIR/platform/ops/$unit" "/etc/systemd/system/$unit"; then
      install -m 0644 "$REPO_DIR/platform/ops/$unit" "/etc/systemd/system/$unit"
      reload=1
      changed "installed /etc/systemd/system/$unit"
    fi
  done
  if [ "$reload" = 1 ]; then
    systemctl daemon-reload
  fi
  systemd-analyze verify /etc/systemd/system/dispatcher.service /etc/systemd/system/dispatcher-alert.service || die "systemd-analyze verify failed on the units"
  if ! systemctl is-enabled --quiet dispatcher; then
    systemctl enable dispatcher
    changed "dispatcher enabled (not started)"
  fi
}

main() {
  check_host
  install_packages
  ensure_swap
  install_docker
  configure_firewall
  configure_sshd
  configure_upgrades
  clone_repository
  check_env_file
  build_image
  install_units
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
