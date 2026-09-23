#!/usr/bin/env bash
# ship-gate.sh: the gate a change passes before it ships. Steps run in order and stop at the first
# failure.
#
# usage: ship-gate.sh --folder seed-1|platform [--lane config|code] [--phase all|scans|build|checks|bot]
#                     [--dry-run] [--commit-message-file f] [--changed-files-file f] [--repo-root d]
#
# The phases, in the order --phase all (the default, and the local form) runs them. Every step that
# runs no card code comes before the first step that does.
#   scans   secret-scan, banned-phrases, runtime-token-deny. Bash and one node call; nothing is
#           installed and no card code runs.
#   build   the folder's build, then runtime-token-deny over what it wrote (runtime-token-deny-dist).
#           The build config, package files and build scripts are kernel, so no card code runs.
#   checks  typecheck and tests: the seed-1 code lane, or the dispatcher, supabase and site packages
#           for platform. Card code runs here. The seed-1 config lane has no checks.
#   bot     the headless bot, seed-1 only. It imports the card's sim code, so it runs last. Its
#           verdict is read from a report file with a random name in this run's scratch folder, not
#           from its output.
# The gate workflow runs scans in its detect job, checks in the per-folder jobs, and build and then
# bot in its build job on a fresh runner that never runs card tests.
# banned-phrases reads the folder, the changed files and the root files and folders that exist
# (docs, .github, README.md, CLAUDE.md, package.json, pnpm-workspace.yaml, tsconfig.base.json,
# .env.example). runtime-token-deny-dist reads the build the build step just wrote, so the shipped
# files are checked whether or not a build existed before the gate ran.
# --dry-run is the local form: no network is used in any step, the secret scan reads the working
# tree (untracked files included) instead of tracked files only, and the build still runs.
# The commit message comes from the file when given, else from the checked-out HEAD commit.
# Step output goes to stderr; stdout carries one line: GATE PASS folder=<f> lane=<l> (with
# phase=<p> for a single phase) or GATE FAIL step=<name> detail=<first line of the failing step>.
# Exit 0 pass, 1 fail, 2 usage (a phase the folder or lane does not have is a usage error).
set -u
GATE_DIR=$(cd "$(dirname "$0")" && pwd)
. "$GATE_DIR/lib/common.sh"
REPO_ROOT=$(gate_repo_root)

usage() {
  echo "usage: ship-gate.sh --folder seed-1|platform [--lane config|code] [--phase all|scans|build|checks|bot] [--dry-run] [--commit-message-file f] [--changed-files-file f] [--repo-root d]" >&2
  exit 2
}

FOLDER=""
LANE=code
PHASE=all
DRY_RUN=0
MESSAGE_FILE=""
CHANGED_FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --folder) [ $# -ge 2 ] || usage; FOLDER=$2; shift 2 ;;
    --lane) [ $# -ge 2 ] || usage; LANE=$2; shift 2 ;;
    --phase) [ $# -ge 2 ] || usage; PHASE=$2; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --commit-message-file) [ $# -ge 2 ] || usage; MESSAGE_FILE=$(gate_abs_path "$2"); shift 2 ;;
    --changed-files-file) [ $# -ge 2 ] || usage; CHANGED_FILE=$(gate_abs_path "$2"); shift 2 ;;
    --repo-root) [ $# -ge 2 ] || usage; REPO_ROOT=$(gate_abs_path "$2"); shift 2 ;;
    *) usage ;;
  esac
done
case "$FOLDER" in seed-1|platform) ;; *) usage ;; esac
case "$LANE" in config|code) ;; *) usage ;; esac
case "$PHASE" in all|scans|build|checks|bot) ;; *) usage ;; esac
[ "$FOLDER" = platform ] && [ "$LANE" = config ] && usage
[ "$FOLDER" = platform ] && [ "$PHASE" = bot ] && usage
[ "$FOLDER" = seed-1 ] && [ "$LANE" = config ] && [ "$PHASE" = checks ] && usage
[ -z "$MESSAGE_FILE" ] || [ -f "$MESSAGE_FILE" ] || usage
[ -z "$CHANGED_FILE" ] || [ -f "$CHANGED_FILE" ] || usage

WORK=$(mktemp -d "${TMPDIR:-/tmp}/ship-gate.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
cd "$REPO_ROOT" || exit 2

if [ -z "$MESSAGE_FILE" ] && git rev-parse --verify --quiet HEAD > /dev/null 2>&1; then
  MESSAGE_FILE="$WORK/commit-message.txt"
  git log -1 --format=%B HEAD > "$MESSAGE_FILE"
fi

# run_step <name> <package or empty> <command...>: stdout of the command is captured and relayed to
# stderr. On failure the detail is the first captured line for a scanner (its FAIL line) and
# "<package>: exit <code>" for a package script.
run_step() {
  local name=$1 label=$2 started status detail
  shift 2
  started=$SECONDS
  echo "gate: step=$name ${label:+package=$label }start" >&2
  "$@" > "$WORK/step.out" 2> "$WORK/step.err"
  status=$?
  cat "$WORK/step.err" >&2
  cat "$WORK/step.out" >&2
  if [ "$status" -ne 0 ]; then
    if [ -n "$label" ]; then detail="$label: exit $status"; else detail=$(head -n 1 "$WORK/step.out"); fi
    [ -n "$detail" ] || detail="exit $status"
    echo "GATE FAIL step=$name detail=$detail"
    exit 1
  fi
  echo "gate: step=$name ${label:+package=$label }ok $((SECONDS - started))s" >&2
}

# A workspace package must exist before pnpm runs a script in it; an absent package is a failure,
# not a pass.
package_dir() {
  case "$1" in
    @backseat/seed-1) echo "seed-1" ;;
    @backseat/dispatcher) echo "platform/dispatcher" ;;
    @backseat/supabase) echo "platform/supabase" ;;
    @backseat/site) echo "platform/site" ;;
  esac
}
require_package() {
  [ -f "$REPO_ROOT/$(package_dir "$1")/package.json" ] && return 0
  echo "GATE FAIL step=$2 detail=$1 is not in the workspace"
  exit 1
}
pnpm_step() {
  # $1 step name, $2 package, $3 script
  require_package "$2" "$1"
  run_step "$1" "$2" pnpm --filter "$2" "$3"
}

phase_scans() {
  if [ "$DRY_RUN" -eq 1 ]; then
    run_step secret-scan "" bash "$GATE_DIR/secret-scan.sh" --repo-root "$REPO_ROOT" --working-tree
  else
    run_step secret-scan "" bash "$GATE_DIR/secret-scan.sh" --repo-root "$REPO_ROOT" --tracked
  fi
  set -- --repo-root "$REPO_ROOT"
  [ -z "$MESSAGE_FILE" ] || set -- "$@" --commit-message-file "$MESSAGE_FILE"
  [ -z "$CHANGED_FILE" ] || set -- "$@" --changed-files-file "$CHANGED_FILE"
  set -- "$@" "$REPO_ROOT/$FOLDER"
  for root_path in docs .github README.md CLAUDE.md package.json pnpm-workspace.yaml tsconfig.base.json .env.example; do
    [ -e "$REPO_ROOT/$root_path" ] && set -- "$@" "$REPO_ROOT/$root_path"
  done
  run_step banned-phrases "" bash "$GATE_DIR/banned-phrases.sh" "$@"
  run_step runtime-token-deny "" bash "$GATE_DIR/runtime-token-deny.sh" --repo-root "$REPO_ROOT" --folder "$FOLDER"
}

phase_build() {
  if [ "$FOLDER" = seed-1 ]; then
    pnpm_step build @backseat/seed-1 build
    run_step runtime-token-deny-dist "" bash "$GATE_DIR/runtime-token-deny.sh" --repo-root "$REPO_ROOT" "$REPO_ROOT/seed-1/dist"
  else
    pnpm_step build @backseat/site build
    run_step runtime-token-deny-dist "" bash "$GATE_DIR/runtime-token-deny.sh" --repo-root "$REPO_ROOT" "$REPO_ROOT/platform/site/dist"
  fi
}

phase_checks() {
  local pkg
  if [ "$FOLDER" = seed-1 ]; then
    [ "$LANE" = code ] || return 0
    pnpm_step typecheck @backseat/seed-1 typecheck
    pnpm_step tests @backseat/seed-1 test
  else
    for pkg in @backseat/dispatcher @backseat/supabase @backseat/site; do
      pnpm_step typecheck "$pkg" typecheck
    done
    for pkg in @backseat/dispatcher @backseat/supabase @backseat/site; do
      pnpm_step tests "$pkg" test
    done
  fi
}

# The verdict is the report file's first line, and the runner's exit code must agree with it.
phase_bot() {
  local report
  report="$WORK/bot-report-$(gate_nonce).txt"
  run_step bot "" node "$GATE_DIR/headless-bot/run.mjs" --repo-root "$REPO_ROOT" \
    --config-dir "$REPO_ROOT/seed-1/config" --hours 10 --seed 20260914 --report-file "$report"
  if ! head -n 1 "$report" 2> /dev/null | grep -q '^PASS: headless-bot '; then
    echo "GATE FAIL step=bot detail=the report file does not hold a PASS line"
    exit 1
  fi
}

case "$PHASE" in
  all)
    phase_scans
    phase_build
    phase_checks
    [ "$FOLDER" = platform ] || phase_bot
    echo "GATE PASS folder=$FOLDER lane=$LANE"
    ;;
  *)
    "phase_$PHASE"
    echo "GATE PASS folder=$FOLDER lane=$LANE phase=$PHASE"
    ;;
esac
