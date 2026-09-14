#!/usr/bin/env bash
# changed-paths.sh: which folders a change touches and which lane it belongs to.
#
# usage: changed-paths.sh [--list] [--repo-root d] <base-ref> <head-ref>
#
# Compares the merge base of the two refs with head (a pull request diff). When base is the
# all-zero sha or shares no history with head, every file in head counts as changed.
# Output: seed=true|false platform=true|false lane=config|code
#   seed      a changed file lies under seed-1/, or outside both folders (workspace-level change)
#   platform  a changed file lies under platform/, or outside both folders
#   lane      config only when every changed file lies under seed-1/config/ or seed-1/content/
# --list prints the changed files, one per line, instead. --repo-root names another repository.
# Exit 0, or 2 on usage or when a ref does not resolve.
set -u
GATE_DIR=$(cd "$(dirname "$0")" && pwd)
. "$GATE_DIR/lib/common.sh"
REPO_ROOT=$(gate_repo_root)

usage() {
  echo "usage: changed-paths.sh [--list] [--repo-root d] <base-ref> <head-ref>" >&2
  exit 2
}

LIST=0
while [ $# -gt 2 ]; do
  case "$1" in
    --list) LIST=1; shift ;;
    --repo-root) REPO_ROOT=$(gate_abs_path "$2"); shift 2 ;;
    *) usage ;;
  esac
done
[ $# -eq 2 ] || usage
BASE=$1
HEAD=$2
export LC_ALL=C

git -C "$REPO_ROOT" rev-parse --verify --quiet "$HEAD^{commit}" > /dev/null || { echo "changed-paths: head ref does not resolve: $HEAD" >&2; exit 2; }

changed_files() {
  local mb
  case "$BASE" in
    0000000000000000000000000000000000000000|"")
      git -C "$REPO_ROOT" ls-tree -r --name-only "$HEAD"
      return
      ;;
  esac
  if git -C "$REPO_ROOT" rev-parse --verify --quiet "$BASE^{commit}" > /dev/null \
    && mb=$(git -C "$REPO_ROOT" merge-base "$BASE" "$HEAD" 2>/dev/null); then
    git -C "$REPO_ROOT" diff --name-only "$mb" "$HEAD"
  else
    git -C "$REPO_ROOT" ls-tree -r --name-only "$HEAD"
  fi
}

FILES=$(changed_files | sort -u)
if [ "$LIST" -eq 1 ]; then
  [ -z "$FILES" ] || printf '%s\n' "$FILES"
  exit 0
fi

SEED=false
PLATFORM=false
LANE=code
if [ -n "$FILES" ]; then
  LANE=config
  while IFS= read -r f; do
    case "$f" in
      seed-1/config/*|seed-1/content/*) SEED=true ;;
      seed-1/*) SEED=true; LANE=code ;;
      platform/*) PLATFORM=true; LANE=code ;;
      *) SEED=true; PLATFORM=true; LANE=code ;;
    esac
  done <<EOF_FILES
$FILES
EOF_FILES
fi
echo "seed=$SEED platform=$PLATFORM lane=$LANE"
