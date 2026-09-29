#!/usr/bin/env bash
# kernel-guard.sh: fails when a change touches a path no agent may change.
#
# usage: kernel-guard.sh <changed-files-file>
#
# Reads kernel-paths.txt, kernel-names.txt and design-paths.txt beside this script (comments and
# blank lines skipped). A changed file matches a kernel path when it equals it or lies under it, or
# shadows a kernel source file (format.js beside the kernel format.ts: Vite and Vitest try .mjs, .js
# and .mts before .ts, so it replaces the kernel file and still passes the typecheck), and a
# kernel name when any segment of its path matches the name as a glob. It matches a design path, one
# of the board-only files that set the look (docs/specs/design-review.md), the same way as a kernel
# path. Both matches ignore case, because a
# case-insensitive checkout (macOS) loads claude.md as CLAUDE.md. A line that begins with a double
# quote (a path git quoted) or holds a tab or other control character fails too: it cannot be
# matched reliably. The workflow runs this on card/* branches only, in the detect job before any
# install, after restoring platform/gate from the base commit, so a card cannot edit the lists it
# is checked against.
# First stdout line: PASS: kernel-guard files=<n>, or FAIL: kernel-guard path=<file> for the first
# kernel or unreadable path, or FAIL: kernel-guard path=<file> rule=design-path when the first failing
# path is a design path.
# Exit 0 pass, 1 fail, 2 usage.
set -u
GATE_DIR=$(cd "$(dirname "$0")" && pwd)
. "$GATE_DIR/lib/common.sh"
export LC_ALL=C

[ $# -eq 1 ] && [ -f "$1" ] || { echo "usage: kernel-guard.sh <changed-files-file>" >&2; exit 2; }
[ -f "$GATE_DIR/kernel-paths.txt" ] || { echo "FAIL: kernel-guard missing $GATE_DIR/kernel-paths.txt"; exit 1; }
[ -f "$GATE_DIR/kernel-names.txt" ] || { echo "FAIL: kernel-guard missing $GATE_DIR/kernel-names.txt"; exit 1; }
[ -f "$GATE_DIR/design-paths.txt" ] || { echo "FAIL: kernel-guard missing $GATE_DIR/design-paths.txt"; exit 1; }
gate_load_kernel_lists
DESIGN_PATHS=()
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in ''|'#'*) continue ;; esac
  DESIGN_PATHS+=("$line")
done < "$GATE_DIR/design-paths.txt"
shopt -s nocasematch

# True when the path equals a design path or lies under one.
is_design_path() {
  local design
  for design in ${DESIGN_PATHS[@]+"${DESIGN_PATHS[@]}"}; do
    case "$1" in "$design"|"$design"/*) return 0 ;; esac
  done
  return 1
}

# True when the path cannot be read as a plain repository path.
is_unreadable() {
  case "$1" in
    '"'*|*[[:cntrl:]]*) return 0 ;;
  esac
  return 1
}

count=0
first=""
while IFS= read -r file || [ -n "$file" ]; do
  [ -n "$file" ] || continue
  count=$((count + 1))
  if is_unreadable "$file" || gate_has_kernel_name "$file" || gate_under_kernel_path "$file"; then
    [ -n "$first" ] || first=$file
    echo "kernel-guard: $file is a kernel path or cannot be read as a path" >&2
  elif is_design_path "$file"; then
    [ -n "$first" ] || first="$file rule=design-path"
    echo "kernel-guard: $file is a board-only design file" >&2
  fi
done < "$1"

if [ -n "$first" ]; then
  echo "FAIL: kernel-guard path=$first"
  exit 1
fi
echo "PASS: kernel-guard files=$count"
