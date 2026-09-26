#!/bin/bash
# scripts/local-gate.sh <pr-number> [port-base]
#
# The gate (.github/workflows/gate.yml) run on the board's Mac while GitHub Actions cannot start jobs
# (docs/specs/local-gate.md, PLAN.md §10 decision 44). The account's included Actions minutes ran out
# with a $0 spending limit, so every job is refused in seconds; the board decided on 23 September 2026
# "just do everything locally for now".
#
# Run it from main's checkout, never from a pull request's own copy: a pull request could change
# this file to pass itself. Pull main first, then: bash scripts/local-gate.sh <pr> [port-base]
#
# What it runs is what Actions runs on a pull_request event:
#   - the PR's head merged into its base branch's current tip (Actions checks out refs/pull/N/merge);
#   - detect: changed files, the folder/lane flags from platform/gate/changed-paths.sh, the scans phase;
#   - seed-code, platform and build exactly as gate.yml selects them, the build job in its own fresh
#     worktree with --ignore-scripts, on Node 22 like the runners;
#   - the gate job's rule: every selected job passed.
# Board pull requests only. A card/ branch is refused: its checks must come from the base commit on
# a clean runner, and the dispatcher still requires the Actions "gate" check, so cards fail closed.
#
# Logs and work folders live under ${LOCAL_GATE_DIR:-$HOME/.local-gate} (gate-logs/, gate-work/).
# The site e2e uses port-base (default 4380) and the board e2e port-base + 1.
#
# On PASS it posts a commit status "local-gate" (success) on the head sha and prints
#   LOCAL GATE PASS pr=<n> head=<sha> base=<sha> merge=<sha> <flags> log=<path>
# Merge only if origin/<base> still equals the printed base, with
#   gh pr merge <n> --squash --match-head-commit <head> --delete-branch
# and quote the PASS line in the merge body (and the spec's Evidence). If main moved, run it again.
set -uo pipefail

PR=${1:?usage: local-gate.sh <pr-number> [port-base]}
PORT=${2:-4380}
REPO=$(git -C "$(dirname "$0")" rev-parse --show-toplevel) || { echo "local-gate: not inside the repository"; exit 2; }
L=${LOCAL_GATE_DIR:-$HOME/.local-gate}
if [ -d /opt/homebrew/opt/node@22/bin ]; then export PATH="/opt/homebrew/opt/node@22/bin:$PATH"; fi
case "$(node --version 2>/dev/null)" in
  v22.*) ;;
  *) echo "local-gate: the runners use Node 22; put it first on PATH (found: $(node --version 2>/dev/null || echo none))"; exit 2 ;;
esac
export E2E_PORT=$PORT BOARD_E2E_PORT=$((PORT + 1))

mkdir -p "$L/gate-logs" "$L/gate-work"
cd "$REPO" || exit 2
git fetch -q origin || { echo "local-gate: git fetch failed"; exit 2; }

read -r HEAD BASE_REF HEAD_REF < <(gh pr view "$PR" --json headRefOid,baseRefName,headRefName -q '.headRefOid+" "+.baseRefName+" "+.headRefName')
[ -n "${HEAD:-}" ] || { echo "local-gate: cannot read PR $PR"; exit 2; }
case "$HEAD_REF" in
  card/*) echo "local-gate: $HEAD_REF is a card branch; cards need the Actions gate. Refused."; exit 2 ;;
esac
git cat-file -e "$HEAD^{commit}" 2>/dev/null || git fetch -q origin "$HEAD_REF"
BASE=$(git rev-parse "origin/$BASE_REF")
LOG="$L/gate-logs/pr$PR-${HEAD:0:7}.log"
WORK="$L/gate-work/pr$PR-${HEAD:0:7}"
MW="$WORK/merge"
BW="$WORK/build"
rm -rf "$WORK"; git worktree prune; mkdir -p "$WORK"
exec > >(tee "$LOG") 2>&1

echo "local-gate pr=$PR head=$HEAD ($HEAD_REF) base=$BASE (origin/$BASE_REF) node=$(node --version) $(date -u +%Y-%m-%dT%H:%M:%SZ)"

cleanup() {
  cd "$REPO" || return
  git worktree remove --force "$MW" >/dev/null 2>&1
  git worktree remove --force "$BW" >/dev/null 2>&1
  git worktree prune
}
status() { # state description
  gh api -X POST "repos/{owner}/{repo}/statuses/$HEAD" -f state="$1" -f context=local-gate -f description="$2" >/dev/null 2>&1 \
    || echo "local-gate: could not post the commit status (the result above still stands)"
}
fail() {
  echo "LOCAL GATE FAIL pr=$PR head=$HEAD base=$BASE: $1 log=$LOG"
  status failure "$(echo "$1" | cut -c1-120)"
  cleanup
  exit 1
}
step() { # name, command...
  local name=$1; shift
  echo "::: $name"
  "$@" || fail "$name"
}

# The merge Actions would test.
git worktree add -q --detach "$MW" "$BASE" || fail "worktree for the merge"
git -C "$MW" -c user.name=local-gate -c user.email=local-gate@localhost merge -q --no-ff --no-edit "$HEAD" \
  || fail "the PR does not merge cleanly into origin/$BASE_REF"
MERGE=$(git -C "$MW" rev-parse HEAD)
echo "merge=$MERGE"
cd "$MW" || fail "cd merge worktree"

# detect
git log -1 --format=%B "$HEAD" > "$WORK/commit-message.txt"
bash platform/gate/changed-paths.sh --list "$BASE" "$HEAD" > "$WORK/changed-files.txt" || fail "detect: changed files"
result=$(bash platform/gate/changed-paths.sh "$BASE" "$HEAD") || fail "detect: changed-paths"
echo "$result"
SEED=$(echo "$result" | sed -E 's/.*seed=([a-z]+).*/\1/')
PLATFORM=$(echo "$result" | sed -E 's/.*platform=([a-z]+).*/\1/')
LANE=$(echo "$result" | sed -E 's/.*lane=([a-z]+).*/\1/')
SITE=$(echo "$result" | sed -E 's/.*site=([a-z]+).*/\1/')
FUNCTIONS=$(echo "$result" | sed -E 's/.*functions=([a-z]+).*/\1/')
case "$HEAD_REF" in *-code) LANE=code ;; esac
for flag in "seed=$SEED" "platform=$PLATFORM" "site=$SITE" "functions=$FUNCTIONS"; do
  case "${flag#*=}" in true|false) ;; *) fail "detect: malformed flag $flag" ;; esac
done
case "$LANE" in config|code) ;; *) fail "detect: malformed lane $LANE" ;; esac
FLAGS="seed=$SEED platform=$PLATFORM lane=$LANE site=$SITE functions=$FUNCTIONS"
echo "$FLAGS branch=$HEAD_REF"
if [ "$SEED" = true ]; then
  step "scans seed-1" bash platform/gate/ship-gate.sh --phase scans --folder seed-1 --lane "$LANE" --commit-message-file "$WORK/commit-message.txt" --changed-files-file "$WORK/changed-files.txt"
fi
if [ "$PLATFORM" = true ]; then
  step "scans platform" bash platform/gate/ship-gate.sh --phase scans --folder platform --commit-message-file "$WORK/commit-message.txt" --changed-files-file "$WORK/changed-files.txt"
fi

# seed-code and platform share one install, as each Actions job does its own.
if { [ "$SEED" = true ] && [ "$LANE" = code ]; } || [ "$PLATFORM" = true ] || [ "$SITE" = true ] || [ "$FUNCTIONS" = true ]; then
  step "install" pnpm install --frozen-lockfile
fi
if [ "$SEED" = true ] && [ "$LANE" = code ]; then
  step "seed-code: typecheck and tests" bash platform/gate/ship-gate.sh --phase checks --folder seed-1 --lane code
fi
if [ "$PLATFORM" = true ] || [ "$SITE" = true ] || [ "$FUNCTIONS" = true ]; then
  # gate.yml runs the platform job when detect selects platform; site and functions imply it.
  step "platform: typecheck and tests" bash platform/gate/ship-gate.sh --phase checks --folder platform
  step "platform: gate tests" pnpm --filter @backseat/gate test
  step "platform: agent role spec tests" env EVAL_BASE="$BASE" pnpm test:agents
  step "platform: ops tests" pnpm test:ops
  step "platform: docs tests" pnpm test:docs
  if [ "$FUNCTIONS" = true ]; then step "platform: stripe webhook function tests" pnpm test:functions; fi
  if [ "$SITE" = true ]; then
    step "platform: site build" pnpm --filter @backseat/site build
    step "platform: chromium" pnpm --filter @backseat/site exec playwright install chromium
    step "platform: site e2e (port $E2E_PORT)" pnpm --filter @backseat/site e2e
    step "platform: board e2e (port $BOARD_E2E_PORT)" pnpm --filter @backseat/board e2e
  fi
fi

# build, in a fresh worktree that never ran tests, installed without lifecycle scripts
if [ "$SEED" = true ] || [ "$SITE" = true ]; then
  cd "$REPO" || fail "cd repo"
  git worktree add -q --detach "$BW" "$MERGE" || fail "worktree for the build job"
  cd "$BW" || fail "cd build worktree"
  step "build: install --ignore-scripts" pnpm install --frozen-lockfile --ignore-scripts
  if [ "$SEED" = true ]; then step "build: seed-1 build and scan" bash platform/gate/ship-gate.sh --phase build --folder seed-1 --lane "$LANE"; fi
  if [ "$SITE" = true ]; then step "build: sites build and scan" bash platform/gate/ship-gate.sh --phase build --folder platform; fi
  if [ "$SEED" = true ]; then step "build: headless bot" bash platform/gate/ship-gate.sh --phase bot --folder seed-1 --lane "$LANE"; fi
fi

# The gate job's rule holds by construction: any selected step that failed has already exited.
NOW=$(git -C "$REPO" ls-remote origin "refs/heads/$BASE_REF" | cut -f1)
[ "$NOW" = "$BASE" ] || echo "NOTE: origin/$BASE_REF moved to $NOW while the gate ran; run it again before merging."
status success "gate.yml run locally on the merge with $BASE_REF at ${BASE:0:7} ($FLAGS)"
cleanup
echo "LOCAL GATE PASS pr=$PR head=$HEAD base=$BASE merge=$MERGE $FLAGS log=$LOG"
