#!/usr/bin/env bash
# changed-paths.sh: which folders a change touches, which lane it belongs to, and which of the
# platform job's slower steps it can affect.
#
# usage: changed-paths.sh [--list | --check-modes | --check-lane <branch>] [--repo-root d] <base-ref> <head-ref>
#
# Compares the merge base of the two refs with head (a pull request diff). When base is the
# all-zero sha or shares no history with head, every file in head counts as changed. Rename
# detection is off whatever the repository's config says, so a renamed file lists both its old
# and new names, and a kernel file moved into a config folder is still seen. Submodule changes are
# never ignored, whatever .gitmodules says.
# Output: seed=true|false platform=true|false lane=config|code site=true|false functions=true|false
#   seed      a changed file lies under seed-1/, or outside seed-1/, platform/ and docs/ (a
#             workspace-level change)
#   platform  a changed file lies under platform/ or docs/, or is workspace-level. The docs tests, the
#             agent spec tests and the supabase tests read docs/, and the seed-1 checks do not.
#   lane      config only when every changed file is a .json file under seed-1/config/ or
#             seed-1/content/: the build copies those folders into the game verbatim, and the config
#             lane runs no typecheck or tests
#   site      the site's build or its end-to-end suite may change: a changed file under
#             platform/site/ or platform/agents/ (the suite reads the role specs), or under platform/
#             outside the folders named below, or workspace-level. Changes only under seed-1/, docs/,
#             platform/dispatcher/, platform/ops/ or platform/supabase/ leave it false.
#   functions the Deno tests of platform/supabase/functions may change: a changed file under
#             platform/supabase/, or under platform/ outside the folders named below, or
#             workspace-level. Changes only under seed-1/, docs/, platform/dispatcher/, platform/ops/,
#             platform/site/ or platform/agents/ leave it false.
# A path no rule names sets every flag, so a new folder is never skipped by mistake.
# --list prints the changed files, one per line, instead. Paths are not quoted for non-ASCII bytes;
# git still quotes a path holding a tab, newline, double quote or backslash, and kernel-guard.sh
# fails a quoted line.
# --check-modes fails when a changed entry, on either side, is a symlink (mode 120000) or a
# submodule (mode 160000): a link can point a lane path at a kernel file, and a submodule's contents
# are never listed. First stdout line: PASS: mode-check entries=<n> or
# FAIL: mode-check path=<file> mode=<mode>; exit 0 pass, 1 fail.
# --check-lane <branch> fails when a card branch leaves its lane. The branch is card/<id>-config or
# card/<id>-code. Every changed file must lie under seed-1/: the platform code lane is closed until
# the board has its own origin (docs/specs/launch-gate.md), so no card branch may change platform/ or
# a root file. On a -config branch every changed file must also be a .json file under seed-1/config/
# or seed-1/content/. First stdout line: PASS: lane-check files=<n> lane=<lane> or
# FAIL: lane-check path=<file> rule=seed-1-only|config-json-only, or
# FAIL: lane-check branch=<branch> rule=branch-name; exit 0 pass, 1 fail.
# --repo-root names another repository.
# Exit 0, or 2 on usage or when a ref does not resolve.
set -u
GATE_DIR=$(cd "$(dirname "$0")" && pwd)
. "$GATE_DIR/lib/common.sh"
REPO_ROOT=$(gate_repo_root)

usage() {
  echo "usage: changed-paths.sh [--list | --check-modes | --check-lane <branch>] [--repo-root d] <base-ref> <head-ref>" >&2
  exit 2
}

MODE=lanes
BRANCH=""
while [ $# -gt 0 ]; do
  case "$1" in
    --list) [ "$MODE" = lanes ] || usage; MODE=list; shift ;;
    --check-modes) [ "$MODE" = lanes ] || usage; MODE=modes; shift ;;
    --check-lane) [ "$MODE" = lanes ] && [ $# -ge 2 ] || usage; MODE=lane-check; BRANCH=$2; shift 2 ;;
    --repo-root) [ $# -ge 2 ] || usage; REPO_ROOT=$(gate_abs_path "$2"); shift 2 ;;
    --*) usage ;;
    *) break ;;
  esac
done
[ $# -eq 2 ] || usage
BASE=$1
HEAD=$2
export LC_ALL=C

# Every git call that lists paths: no quoting of non-ASCII bytes, no rename detection, no ignored
# submodules.
git_paths() {
  git -C "$REPO_ROOT" -c core.quotePath=false -c diff.renames=false -c diff.ignoreSubmodules=none "$@"
}

git -C "$REPO_ROOT" rev-parse --verify --quiet "$HEAD^{commit}" > /dev/null || { echo "changed-paths: head ref does not resolve: $HEAD" >&2; exit 2; }

# The merge base, or empty when every file in head counts as changed.
MB=""
case "$BASE" in
  0000000000000000000000000000000000000000|"") ;;
  *)
    if git -C "$REPO_ROOT" rev-parse --verify --quiet "$BASE^{commit}" > /dev/null; then
      MB=$(git -C "$REPO_ROOT" merge-base "$BASE" "$HEAD" 2>/dev/null) || MB=""
    fi
    ;;
esac

changed_files() {
  if [ -n "$MB" ]; then
    git_paths diff --no-renames --ignore-submodules=none --name-only "$MB" "$HEAD"
  else
    git_paths ls-tree -r --name-only "$HEAD"
  fi
}

# One line per changed entry: old mode, new mode and path, tab separated. Read from -z output so
# no path is quoted; an entry that does not exist on one side has mode 000000 there.
changed_modes() {
  local meta path mode
  if [ -n "$MB" ]; then
    git_paths diff --raw -z --no-renames --ignore-submodules=none "$MB" "$HEAD" | while IFS= read -r -d '' meta; do
      IFS= read -r -d '' path || break
      set -- $meta
      printf '%s\t%s\t%s\n' "${1#:}" "$2" "$path"
    done
  else
    git_paths ls-tree -r -z "$HEAD" | while IFS= read -r -d '' meta; do
      mode=${meta%% *}
      printf '000000\t%s\t%s\n' "$mode" "${meta#*	}"
    done
  fi
}

if [ "$MODE" = modes ]; then
  count=0
  failed=""
  while IFS='	' read -r old new path; do
    count=$((count + 1))
    case "$old $new" in
      *120000*|*160000*)
        if [ -z "$failed" ]; then
          case "$new" in 120000|160000) failed="path=$path mode=$new" ;; *) failed="path=$path mode=$old" ;; esac
        fi
        echo "mode-check: $path is a symlink or submodule" >&2
        ;;
    esac
  done < <(changed_modes)
  if [ -n "$failed" ]; then
    echo "FAIL: mode-check $failed"
    exit 1
  fi
  echo "PASS: mode-check entries=$count"
  exit 0
fi

FILES=$(changed_files | sort -u)
if [ "$MODE" = list ]; then
  [ -z "$FILES" ] || printf '%s\n' "$FILES"
  exit 0
fi

if [ "$MODE" = lane-check ]; then
  case "$BRANCH" in
    card/?*-config) BRANCH_LANE=config ;;
    card/?*-code) BRANCH_LANE=code ;;
    *) echo "FAIL: lane-check branch=$BRANCH rule=branch-name"; exit 1 ;;
  esac
  count=0
  failed=""
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    count=$((count + 1))
    rule=""
    case "$f" in
      seed-1/*) ;;
      *) rule=seed-1-only ;;
    esac
    if [ -z "$rule" ] && [ "$BRANCH_LANE" = config ]; then
      case "$f" in
        seed-1/config/*.json|seed-1/content/*.json) ;;
        *) rule=config-json-only ;;
      esac
    fi
    if [ -n "$rule" ]; then
      [ -n "$failed" ] || failed="path=$f rule=$rule"
      echo "lane-check: $f breaks $rule" >&2
    fi
  done <<EOF_FILES
$FILES
EOF_FILES
  if [ -n "$failed" ]; then
    echo "FAIL: lane-check $failed"
    exit 1
  fi
  echo "PASS: lane-check files=$count lane=$BRANCH_LANE"
  exit 0
fi

SEED=false
PLATFORM=false
SITE=false
FUNCTIONS=false
LANE=code
if [ -n "$FILES" ]; then
  LANE=config
  while IFS= read -r f; do
    case "$f" in
      seed-1/config/*.json|seed-1/content/*.json) SEED=true ;;
      seed-1/*) SEED=true; LANE=code ;;
      docs/*|platform/dispatcher/*|platform/ops/*) PLATFORM=true; LANE=code ;;
      platform/site/*|platform/agents/*) PLATFORM=true; SITE=true; LANE=code ;;
      platform/supabase/*) PLATFORM=true; FUNCTIONS=true; LANE=code ;;
      platform/*) PLATFORM=true; SITE=true; FUNCTIONS=true; LANE=code ;;
      *) SEED=true; PLATFORM=true; SITE=true; FUNCTIONS=true; LANE=code ;;
    esac
  done <<EOF_FILES
$FILES
EOF_FILES
fi
echo "seed=$SEED platform=$PLATFORM lane=$LANE site=$SITE functions=$FUNCTIONS"
