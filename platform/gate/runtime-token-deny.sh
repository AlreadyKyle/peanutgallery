#!/usr/bin/env bash
# runtime-token-deny.sh: fails when shipped text carries a token that only appears when something
# went wrong or was left unfinished.
#
# usage: runtime-token-deny.sh --folder seed-1|platform [--repo-root d]
#        runtime-token-deny.sh [--repo-root d] path ...
#
# Scope by folder: seed-1/config, seed-1/content, seed-1/sim, seed-1/render and seed-1/dist HTML;
# platform/site/src, platform/agents and platform/site/dist HTML. A path argument names a file or a
# folder; a folder named dist, given directly or found inside a folder argument, contributes only
# its HTML outside assets/. Test files (*.test.*, *.spec.*, test/, tests/, __tests__/, e2e/),
# node_modules and dist assets are never read. A path that does not exist is a usage error.
#
# Code files (.ts .tsx .js .mjs .cjs .jsx) are read through lib/js-views.awk: comments are removed
# first, safe contexts are removed next, and the language identifiers (NaN, undefined, TypeError,
# ReferenceError) then count only inside string literals, template literals and JSX text, where they
# would reach a screen; every other file is read as text with the same safe contexts removed.
# Safe contexts: typeof x === 'undefined', === undefined, !== undefined, ?? undefined,
# Number.isNaN(, and the input hint attribute the unset-marker pattern names. Math.random( is denied
# under seed-1/sim.
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

# name | extended regex | safe-context sed | kind (ident or text) | scope (all or sim)
patterns() {
  printf '%s|%s|%s|%s|%s\n' \
    nan '\bNaN\b' 's/Number\.isNaN\(//g' ident all \
    undefined '\bundefined\b' "$SAFE_UNDEFINED" ident all \
    type-error '\bTypeError\b' '' ident all \
    reference-error '\bReferenceError\b' '' ident all \
    object-object '\[object Object\]' '' text all \
    open-task-marker '\bT[O]DO\b' '' text all \
    fix-marker '\bFIX[M]E\b' '' text all \
    replace-marker 'REPLACE[_]ME' '' text all \
    latin-filler '[Ll]or[e]m ips[u]m' '' text all \
    latin-filler-2 'dolor sit am[e]t' '' text all \
    undecided-marker '\bTB[D]\b' '' text all \
    x-run 'X{4}' '' text all \
    unset-marker '\bplaceh[o]lder\b' 's/placeh[o]lder=//g' text all \
    soon-phrase '[Cc]oming s[o]on' '' text all \
    soon-paren '\(s[o]on\)' '' text all \
    stock-name-1 'J[o]hn Doe' '' text all \
    stock-name-2 'J[a]ne Doe' '' text all \
    stock-email 'test@exampl[e]\.com' '' text all \
    stripe-key-stub 'sk_live_[x]' '' text all \
    math-random 'Math\.rand[o]m\(' '' text sim
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

# The HTML of a build folder, outside assets/.
dist_html() {
  find "$1" -type f -name '*.html' -not -path '*/assets/*' | LC_ALL=C sort
}
# The files of a folder argument: source files, plus built HTML when the folder is or holds dist/.
folder_files() {
  if [ "$(basename "$1")" = dist ]; then
    dist_html "$1"
  else
    gate_find_files "$1"
    if [ -d "$1/dist" ]; then dist_html "$1/dist"; fi
  fi
}
# Files in scope, sorted; test files, dependency folders and dist assets removed.
scope_files() {
  local p
  if [ -n "$FOLDER" ]; then
    case "$FOLDER" in
      seed-1) set -- "$REPO_ROOT/seed-1/config" "$REPO_ROOT/seed-1/content" "$REPO_ROOT/seed-1/sim" "$REPO_ROOT/seed-1/render" ;;
      platform) set -- "$REPO_ROOT/platform/site/src" "$REPO_ROOT/platform/agents" ;;
    esac
    for p in "$@"; do if [ -d "$p" ]; then gate_find_files "$p"; fi; done
    case "$FOLDER" in seed-1) p="$REPO_ROOT/seed-1/dist" ;; platform) p="$REPO_ROOT/platform/site/dist" ;; esac
    if [ -d "$p" ]; then dist_html "$p"; fi
  else
    printf '%s\n' "$PATHS" | grep -v '^$' | while IFS= read -r p; do
      if [ -d "$p" ]; then folder_files "$p"; else printf '%s\n' "$p"; fi
    done
  fi
}
scope_files | grep -v -E '/(node_modules|test|tests|__tests__|e2e)/|\.(test|spec)\.[A-Za-z]+$' | sort -u > "$WORK/files.txt"

ALL=$(patterns | cut -d '|' -f2 | paste -s -d '|' -)
: > "$WORK/hits.tsv"
COUNT=0
while IFS= read -r f; do
  gate_is_generated "$f" && continue
  gate_is_text "$f" || continue
  COUNT=$((COUNT + 1))
  grep -qE "$ALL" "$f" || continue
  rel=$(gate_rel_path "$f")
  case "$f" in
    *.tsx|*.jsx) kind=code; jsx=1 ;;
    *.ts|*.js|*.mjs|*.cjs) kind=code; jsx=0 ;;
    *) kind=text; jsx=0 ;;
  esac
  case "$rel" in
    seed-1/sim/*) in_sim=1 ;;
    *) in_sim=0 ;;
  esac
  if [ "$kind" = code ]; then
    awk -v view=code -v jsx="$jsx" -f "$VIEWS_AWK" "$f" > "$WORK/code.txt"
  fi
  patterns | while IFS='|' read -r name regex safe pkind scope; do
    [ "$scope" = sim ] && [ "$in_sim" -eq 0 ] && continue
    if [ "$kind" = code ] && [ "$pkind" = ident ]; then
      lines=$(sed -E "$safe" "$WORK/code.txt" | awk -v view=strings -v jsx="$jsx" -f "$VIEWS_AWK" | grep -nE "$regex" | cut -d: -f1)
    elif [ "$kind" = code ]; then
      lines=$(sed -E "$safe" "$WORK/code.txt" | grep -nE "$regex" | cut -d: -f1)
    else
      lines=$(sed -E "$safe" "$f" | grep -nE "$regex" | cut -d: -f1)
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
