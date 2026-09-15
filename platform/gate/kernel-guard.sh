#!/usr/bin/env bash
# kernel-guard.sh: fails when a change touches a path no agent may change.
#
# usage: kernel-guard.sh <changed-files-file>
#
# Reads kernel-paths.txt beside this script (comments and blank lines skipped). A changed file
# matches a kernel path when it equals it or lies under it. The workflow runs this on card/*
# branches only, after restoring platform/gate from the base commit, so a card cannot edit the
# list it is checked against.
# First stdout line: PASS: kernel-guard files=<n> or FAIL: kernel-guard path=<file>.
# Exit 0 pass, 1 fail, 2 usage.
set -u
GATE_DIR=$(cd "$(dirname "$0")" && pwd)
LIST="$GATE_DIR/kernel-paths.txt"
export LC_ALL=C

[ $# -eq 1 ] && [ -f "$1" ] || { echo "usage: kernel-guard.sh <changed-files-file>" >&2; exit 2; }
[ -f "$LIST" ] || { echo "FAIL: kernel-guard missing $LIST"; exit 1; }

count=0
matched=""
while IFS= read -r file || [ -n "$file" ]; do
  [ -n "$file" ] || continue
  count=$((count + 1))
  while IFS= read -r kernel || [ -n "$kernel" ]; do
    case "$kernel" in ''|'#'*) continue ;; esac
    case "$file" in
      "$kernel"|"$kernel"/*) matched="$matched $file"; break ;;
    esac
  done < "$LIST"
done < "$1"

if [ -n "$matched" ]; then
  set -- $matched
  echo "FAIL: kernel-guard path=$1"
  for found in "$@"; do echo "kernel-guard: $found is a kernel path" >&2; done
  exit 1
fi
echo "PASS: kernel-guard files=$count"
