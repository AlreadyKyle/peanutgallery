#!/usr/bin/env bash
# frames-diff.sh: keeps the frames a change drew differently from its base, as before and after pairs.
#
# usage: frames-diff.sh <before> <after> <out>
#
# The gate's frames job (docs/specs/design-review.md) draws the same frames on the base and on the
# change, into <before> and <after>. For each file in <after> (top level, sorted bytewise), when
# <before> has no file of that name, or cmp -s says the two differ, the after file is copied to
# <out>/<name>.after.png and the before file, when there is one, to <out>/<name>.before.png, where
# <name> is the file name without its .png ending. <out>/changed.txt is always written, one changed
# file name per line (possibly empty). A missing <before> folder counts as a base with no frames.
# First stdout line: frames: total=<n> changed=<m>. Exit 0, 1 when a copy fails, 2 on usage or a
# missing <after> folder.
set -u
export LC_ALL=C

[ $# -eq 3 ] || { echo "usage: frames-diff.sh <before> <after> <out>" >&2; exit 2; }
BEFORE=$1
AFTER=$2
OUT=$3
[ -d "$AFTER" ] || { echo "frames-diff: no after folder: $AFTER" >&2; exit 2; }
mkdir -p "$OUT" || exit 1

total=0
changed=0
: > "$OUT/changed.txt" || exit 1
while IFS= read -r file; do
  [ -n "$file" ] || continue
  total=$((total + 1))
  name=${file%.png}
  if [ -f "$BEFORE/$file" ] && cmp -s "$BEFORE/$file" "$AFTER/$file"; then
    continue
  fi
  changed=$((changed + 1))
  cp "$AFTER/$file" "$OUT/$name.after.png" || exit 1
  if [ -f "$BEFORE/$file" ]; then
    cp "$BEFORE/$file" "$OUT/$name.before.png" || exit 1
  fi
  printf '%s\n' "$file" >> "$OUT/changed.txt"
done < <(find "$AFTER" -mindepth 1 -maxdepth 1 -type f -exec basename {} \; | sort)
echo "frames: total=$total changed=$changed"
