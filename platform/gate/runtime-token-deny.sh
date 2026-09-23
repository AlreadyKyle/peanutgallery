#!/usr/bin/env bash
# runtime-token-deny.sh: fails when shipped text carries a token that only appears when something
# went wrong or was left unfinished.
#
# usage: runtime-token-deny.sh --folder seed-1|platform [--repo-root d]
#        runtime-token-deny.sh [--repo-root d] path ...
#
# Scope by folder: all of seed-1, and seed-1/dist; platform/site, platform/board and platform/agents,
# and the two sites' dist folders. Test files and test folders are read like any other source: a code-lane card
# writes them, and anything under a folder named tests can be imported and shipped. A path argument
# names a file or a folder. A folder named dist, given directly or found inside a folder argument, is
# the build: every file in it is read, and the bundles under its assets/ folder too. node_modules
# and the Finder's .DS_Store files are never read. A path that does not exist is a usage error.
#
# Code files (.ts .tsx .js .mjs .cjs .jsx) are read through lib/js-views.awk: comments are removed
# first, safe contexts are removed next, and the language identifiers (NaN, undefined, TypeError,
# ReferenceError) then count only inside string literals, template literals and JSX text, where they
# would reach a screen; every other file is read as text with the same safe contexts removed.
# Safe contexts: typeof x === 'undefined', === undefined, !== undefined, ?? undefined,
# Number.isNaN(, and the input hint attribute the unset-marker pattern names. Math.random( is denied
# under seed-1/sim.
# A built bundle (a file under dist/assets/) is read as plain text for the unfinished-work markers
# only: the language identifiers and [object Object] sit in the libraries' own strings, and
# minified code cannot be read through the code view in reasonable time. Every string a card writes
# is still read with the full list in its source file.
# A file with a NUL byte or a UTF-16 byte order mark fails as pattern=unreadable.
# The e2e runs' local builds (dist-e2e) and screenshots are never read, like the other output folders
# lib/common.sh prunes; a file git tracks inside any output folder in scope fails as
# pattern=tracked-build-output, so a commit cannot hide text there.
# First output line: PASS: ... or FAIL: ... (file, line and pattern name). Exit 0 pass, 1 fail, 2 usage.
set -u
GATE_DIR=$(cd "$(dirname "$0")" && pwd)
. "$GATE_DIR/lib/common.sh"
REPO_ROOT=$(gate_repo_root)
VIEWS_AWK="$GATE_DIR/lib/js-views.awk"

usage() {
  echo "usage: runtime-token-deny.sh --folder seed-1|platform [--repo-root d] | [--repo-root d] path ..." >&2
  exit 2
}

SAFE_UNDEFINED="s/typeof [^=!]*[=!]==? *['\"]undefined['\"]//g; s/[=!]==? *undefined//g; s/\?\? *undefined//g"

# name | extended regex | safe-context sed | kind (ident or text) | scope (all or sim) | read in a
# built bundle (yes or no)
patterns() {
  printf '%s|%s|%s|%s|%s|%s\n' \
    nan '\bNaN\b' 's/Number\.isNaN\(//g' ident all no \
    undefined '\bundefined\b' "$SAFE_UNDEFINED" ident all no \
    type-error '\bTypeError\b' '' ident all no \
    reference-error '\bReferenceError\b' '' ident all no \
    object-object '\[object Object\]' '' text all no \
    open-task-marker '\bT[O]DO\b' '' text all yes \
    fix-marker '\bFIX[M]E\b' '' text all yes \
    replace-marker 'REPLACE[_]ME' '' text all yes \
    latin-filler '[Ll]or[e]m ips[u]m' '' text all yes \
    latin-filler-2 'dolor sit am[e]t' '' text all yes \
    undecided-marker '\bTB[D]\b' '' text all yes \
    x-run 'X{4}' '' text all yes \
    unset-marker '\bplaceh[o]lder\b' 's/placeh[o]lder=//g' text all yes \
    soon-phrase '[Cc]oming s[o]on' '' text all yes \
    soon-paren '\(s[o]on\)' '' text all yes \
    stock-name-1 'J[o]hn Doe' '' text all yes \
    stock-name-2 'J[a]ne Doe' '' text all yes \
    stock-email 'test@exampl[e]\.com' '' text all yes \
    stripe-key-stub 'sk_live_[x]' '' text all yes \
    math-random 'Math\.rand[o]m\(' '' text sim no
}

FOLDER=""
PATHS=""
add_path() {
  local abs
  abs=$(gate_abs_path "$1")
  [ -e "$abs" ] || { echo "FAIL: runtime-token-deny path not found: $1"; exit 2; }
  PATHS="$PATHS
$abs"
}
while [ $# -gt 0 ]; do
  case "$1" in
    --folder) [ $# -ge 2 ] || usage; FOLDER=$2; shift 2 ;;
    --repo-root) [ $# -ge 2 ] || usage; REPO_ROOT=$(gate_abs_path "$2"); shift 2 ;;
    --) shift; break ;;
    -*) usage ;;
    *) add_path "$1"; shift ;;
  esac
done
while [ $# -gt 0 ]; do add_path "$1"; shift; done
case "$FOLDER" in
  "") [ -n "$PATHS" ] || usage ;;
  seed-1|platform) [ -z "$PATHS" ] || usage ;;
  *) usage ;;
esac

WORK=$(mktemp -d "${TMPDIR:-/tmp}/runtime-token-deny.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
export LC_ALL=C

# Every file of a build folder, its bundles included.
dist_files() {
  find "$1" \( -name node_modules -o -name .DS_Store \) -prune -o -type f -print | LC_ALL=C sort
}
# The files of a folder argument: source files, plus the build when the folder is or holds dist/.
folder_files() {
  if [ "$(basename "$1")" = dist ]; then
    dist_files "$1"
  else
    gate_find_files "$1"
    if [ -d "$1/dist" ]; then dist_files "$1/dist"; fi
  fi
}
# Files in scope, sorted, dependency folders removed.
scope_files() {
  local p
  if [ -n "$FOLDER" ]; then
    case "$FOLDER" in
      seed-1) set -- "$REPO_ROOT/seed-1" ;;
      platform) set -- "$REPO_ROOT/platform/site" "$REPO_ROOT/platform/board" "$REPO_ROOT/platform/agents" ;;
    esac
    for p in "$@"; do if [ -d "$p" ]; then folder_files "$p"; fi; done
  else
    printf '%s\n' "$PATHS" | grep -v '^$' | while IFS= read -r p; do
      if [ -d "$p" ]; then folder_files "$p"; else printf '%s\n' "$p"; fi
    done
  fi
}
scope_files | grep -v -E '/node_modules/' | sort -u > "$WORK/files.txt"

ALL=$(patterns | cut -d '|' -f2 | paste -s -d '|' -)
: > "$WORK/hits.tsv"
COUNT=0

# The folders in scope, for the tracked-output check.
scope_dirs() {
  if [ -n "$FOLDER" ]; then
    case "$FOLDER" in
      seed-1) printf '%s\n' "$REPO_ROOT/seed-1" ;;
      platform) printf '%s\n' "$REPO_ROOT/platform/site" "$REPO_ROOT/platform/board" "$REPO_ROOT/platform/agents" ;;
    esac
  else
    printf '%s\n' "$PATHS" | grep -v '^$' | while IFS= read -r p; do [ -d "$p" ] && printf '%s\n' "$p"; done
  fi
  return 0
}
scope_dirs | while IFS= read -r d; do
  [ -d "$d" ] || continue
  gate_tracked_output "$REPO_ROOT" "$d"
done | LC_ALL=C sort -u | while IFS= read -r rel; do
  printf '%s\t1\ttracked-build-output\n' "$rel"
done >> "$WORK/hits.tsv"
while IFS= read -r f; do
  gate_is_generated "$f" && continue
  rel=$(gate_rel_path "$f")
  gate_text_kind "$f"
  case $? in
    1) continue ;;
    2) printf '%s\t1\tunreadable\n' "$rel" >> "$WORK/hits.tsv"; COUNT=$((COUNT + 1)); continue ;;
  esac
  COUNT=$((COUNT + 1))
  grep -qE -e "$ALL" "$f" || continue
  case "/$rel" in
    */dist/assets/*) bundle=1 ;;
    *) bundle=0 ;;
  esac
  case "$f" in
    *.tsx|*.jsx) kind=code; jsx=1 ;;
    *.ts|*.js|*.mjs|*.cjs) kind=code; jsx=0 ;;
    *) kind=text; jsx=0 ;;
  esac
  [ "$bundle" -eq 0 ] || { kind=text; jsx=0; }
  case "$rel" in
    seed-1/sim/*) in_sim=1 ;;
    *) in_sim=0 ;;
  esac
  if [ "$kind" = code ]; then
    awk -v view=code -v jsx="$jsx" -f "$VIEWS_AWK" "$f" > "$WORK/code.txt"
  fi
  patterns | while IFS='|' read -r name regex safe pkind scope in_bundles; do
    [ "$scope" = sim ] && [ "$in_sim" -eq 0 ] && continue
    [ "$bundle" -eq 1 ] && [ "$in_bundles" = no ] && continue
    if [ "$kind" = code ] && [ "$pkind" = ident ]; then
      lines=$(sed -E "$safe" "$WORK/code.txt" | awk -v view=strings -v jsx="$jsx" -f "$VIEWS_AWK" | grep -nE -e "$regex" | cut -d: -f1)
    elif [ "$kind" = code ]; then
      lines=$(sed -E "$safe" "$WORK/code.txt" | grep -nE -e "$regex" | cut -d: -f1)
    else
      lines=$(sed -E "$safe" "$f" | grep -nE -e "$regex" | cut -d: -f1)
    fi
    [ -n "$lines" ] || continue
    printf '%s\n' "$lines" | while IFS= read -r line; do
      printf '%s\t%s\t%s\n' "$rel" "$line" "$name" >> "$WORK/hits.tsv"
    done
  done
done < "$WORK/files.txt"

MATCHES=$(wc -l < "$WORK/hits.tsv" | tr -d ' ')
if [ "$MATCHES" -eq 0 ]; then
  echo "PASS: runtime-token-deny files=$COUNT"
  exit 0
fi
sort -t '	' -k1,1 -k2,2n "$WORK/hits.tsv" | awk -F '\t' -v total="$MATCHES" '
  NR == 1 { print "FAIL: runtime-token-deny hits=" total " first=" $1 ":" $2 " pattern=" $3; next }
  { print "hit file=" $1 " line=" $2 " pattern=" $3 }
'
exit 1
