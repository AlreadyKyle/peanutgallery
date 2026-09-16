#!/usr/bin/env bash
# kernel-guard.sh: fails when a change touches a path no agent may change.
#
# usage: kernel-guard.sh <changed-files-file>
#
# Reads kernel-paths.txt and kernel-names.txt beside this script (comments and blank lines
# skipped). A changed file matches a kernel path when it equals it or lies under it, and a kernel
# name when any segment of its path matches the name as a glob. Both matches ignore case, because a
# case-insensitive checkout (macOS) loads claude.md as CLAUDE.md. A line that begins with a double
# quote (a path git quoted) or holds a tab or other control character fails too: it cannot be
# matched reliably. The workflow runs this on card/* branches only, in the detect job before any
# install, after restoring platform/gate from the base commit, so a card cannot edit the lists it
# is checked against.
# First stdout line: PASS: kernel-guard files=<n> or FAIL: kernel-guard path=<file>.
# Exit 0 pass, 1 fail, 2 usage.
set -u
GATE_DIR=$(cd "$(dirname "$0")" && pwd)
LIST="$GATE_DIR/kernel-paths.txt"
NAMES="$GATE_DIR/kernel-names.txt"
export LC_ALL=C

[ $# -eq 1 ] && [ -f "$1" ] || { echo "usage: kernel-guard.sh <changed-files-file>" >&2; exit 2; }
[ -f "$LIST" ] || { echo "FAIL: kernel-guard missing $LIST"; exit 1; }
[ -f "$NAMES" ] || { echo "FAIL: kernel-guard missing $NAMES"; exit 1; }
shopt -s nocasematch

# True when the path cannot be read as a plain repository path.
is_unreadable() {
  case "$1" in
    '"'*|*[[:cntrl:]]*) return 0 ;;
  esac
  return 1
}

# True when any segment of the path matches a kernel name. The name is unquoted in the case pattern
# so its * is a glob.
has_kernel_name() {
  local rest=$1 segment name
  while :; do
    segment=${rest%%/*}
    while IFS= read -r name || [ -n "$name" ]; do
      case "$name" in ''|'#'*) continue ;; esac
      case "$segment" in $name) return 0 ;; esac
    done < "$NAMES"
    [ "$segment" != "$rest" ] || return 1
    rest=${rest#*/}
  done
}

# True when the path equals a kernel path or lies under one.
under_kernel_path() {
  local kernel
  while IFS= read -r kernel || [ -n "$kernel" ]; do
    case "$kernel" in ''|'#'*) continue ;; esac
    case "$1" in
      "$kernel"|"$kernel"/*) return 0 ;;
    esac
  done < "$LIST"
  return 1
}

count=0
first=""
while IFS= read -r file || [ -n "$file" ]; do
  [ -n "$file" ] || continue
  count=$((count + 1))
  if is_unreadable "$file" || has_kernel_name "$file" || under_kernel_path "$file"; then
    [ -n "$first" ] || first=$file
    echo "kernel-guard: $file is a kernel path or cannot be read as a path" >&2
  fi
done < "$1"

if [ -n "$first" ]; then
  echo "FAIL: kernel-guard path=$first"
  exit 1
fi
echo "PASS: kernel-guard files=$count"
