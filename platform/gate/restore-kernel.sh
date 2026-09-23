#!/usr/bin/env bash
# restore-kernel.sh: puts every kernel file back the way the base commit has it, in a card branch's
# checkout.
#
# usage: restore-kernel.sh [--repo-root d] <base-ref>
#
# The gate workflow's build job runs this on card/* branches, on a fresh runner, after it restores
# platform/gate from the base commit and before it installs, builds or runs anything. The detect
# job's kernel guard already fails a card branch that changes a kernel file, so on a branch that got
# this far nothing should change here. It is a second line: the build, the scan of the build and the
# headless bot then run on the base commit's package files, build configs and bot harness even if
# the guard were ever wrong.
# Reads kernel-paths.txt and kernel-names.txt beside this script. A file is kernel when it lies under
# a kernel path or has a kernel name as one of its path segments, both ignoring case. Every kernel
# file that the base commit holds is checked out from it; every kernel file the working tree holds
# (tracked, or untracked and not ignored) that the base commit does not is deleted. Ignored files
# (node_modules, dist) are left alone. A path holding a newline cannot be listed and fails.
# First stdout line: PASS: restore-kernel files=<n> restored=<r> removed=<m>, where restored counts
# the files that differed from the base commit, or FAIL: restore-kernel <why>.
# Exit 0 pass, 1 fail, 2 usage or a base ref that does not resolve.
set -u
GATE_DIR=$(cd "$(dirname "$0")" && pwd)
. "$GATE_DIR/lib/common.sh"
REPO_ROOT=$(gate_repo_root)

usage() {
  echo "usage: restore-kernel.sh [--repo-root d] <base-ref>" >&2
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --repo-root) [ $# -ge 2 ] || usage; REPO_ROOT=$(gate_abs_path "$2"); shift 2 ;;
    --) shift; break ;;
    -*) usage ;;
    *) break ;;
  esac
done
[ $# -eq 1 ] || usage
BASE=$1
export LC_ALL=C

gate_load_kernel_lists || { echo "FAIL: restore-kernel the kernel lists are missing beside the script"; exit 1; }
shopt -s nocasematch

# Every git call: no pager, no hooks, no quoting of non-ASCII bytes, and pathspecs read literally.
git_r() {
  git -C "$REPO_ROOT" -c core.quotePath=false -c core.hooksPath=/dev/null --literal-pathspecs "$@"
}

git_r rev-parse --verify --quiet "$BASE^{commit}" > /dev/null || { echo "restore-kernel: base ref does not resolve: $BASE" >&2; exit 2; }
BASE=$(git_r rev-parse --verify "$BASE^{commit}")

WORK=$(mktemp -d "${TMPDIR:-/tmp}/restore-kernel.XXXXXX")
trap 'rm -rf "$WORK"' EXIT

fail() {
  echo "FAIL: restore-kernel $1"
  exit 1
}

# NUL-separated input on stdin to one path per line on stdout; a path holding a newline fails.
nul_to_lines() {
  local entry
  while IFS= read -r -d '' entry; do
    case "$entry" in *$'\n'*) return 1 ;; esac
    printf '%s\n' "$entry"
  done
}

git_r ls-tree -r -z --name-only "$BASE" > "$WORK/base.z" || fail "cannot list the base commit"
git_r ls-files -z -co --exclude-standard > "$WORK/work.z" || fail "cannot list the working tree"
git_r diff --name-only -z "$BASE" > "$WORK/changed.z" || fail "cannot compare the working tree with the base commit"
{ nul_to_lines < "$WORK/base.z" && nul_to_lines < "$WORK/work.z"; } > "$WORK/all.txt" || fail "a listed path holds a newline"
nul_to_lines < "$WORK/changed.z" > "$WORK/changed.txt" || fail "a listed path holds a newline"

# The kernel files among them, once each.
sort -u "$WORK/all.txt" | while IFS= read -r f; do
  if gate_under_kernel_path "$f" || gate_has_kernel_name "$f"; then printf '%s\n' "$f"; fi
done > "$WORK/kernel.txt"

# Which of them the base commit holds: cat-file answers "<name> missing" for the others, in order.
sed "s|^|$BASE:|" "$WORK/kernel.txt" | git_r cat-file --batch-check='%(objecttype)' > "$WORK/types.txt" \
  || fail "cannot read the base commit"
[ "$(wc -l < "$WORK/types.txt")" -eq "$(wc -l < "$WORK/kernel.txt")" ] || fail "the base commit lookup is incomplete"
: > "$WORK/restore.z"
: > "$WORK/remove.txt"
paste -d '\t' "$WORK/types.txt" "$WORK/kernel.txt" | while IFS='	' read -r type f; do
  case "$type" in
    blob) printf '%s\0' "$f" >> "$WORK/restore.z" ;;
    *" missing") printf '%s\n' "$f" >> "$WORK/remove.txt" ;;
    *) printf '%s\n' "$f" >> "$WORK/remove.txt" ;;
  esac
done

removed=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  if [ -e "$REPO_ROOT/$f" ] || [ -L "$REPO_ROOT/$f" ]; then
    rm -f -- "$REPO_ROOT/$f" || fail "cannot remove $f"
    echo "restore-kernel: removed $f (not in the base commit)" >&2
    removed=$((removed + 1))
  fi
done < "$WORK/remove.txt"

restored=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  if gate_under_kernel_path "$f" || gate_has_kernel_name "$f"; then
    echo "restore-kernel: restored $f from the base commit" >&2
    restored=$((restored + 1))
  fi
done < "$WORK/changed.txt"

files=$(tr -cd '\0' < "$WORK/restore.z" | wc -c | tr -d ' ')
if [ "$files" -gt 0 ]; then
  git_r checkout "$BASE" --pathspec-from-file="$WORK/restore.z" --pathspec-file-nul > /dev/null 2> "$WORK/checkout.err" \
    || { cat "$WORK/checkout.err" >&2; fail "cannot check out the kernel files from the base commit"; }
fi
echo "PASS: restore-kernel files=$files restored=$restored removed=$removed"
