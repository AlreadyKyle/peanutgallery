#!/usr/bin/env bash
# banned-phrases.sh: deny-list scan over file contents, path names and the commit message.
#
# usage: banned-phrases.sh [--commit-message-file f] [--changed-files-file f]
#                          [--denylist-dir d] [--repo-root d] [path ...]
#
# Every text file under each path (and every changed file that still exists) is scanned line by
# line; every path name under each path is scanned; the commit message is scanned. Lines and terms
# are normalized the same way (lib/banned-scan.awk): lowercase, whole tokens, leet map, spaced and
# dotted spellings joined. Lists: denylist/{profanity,slurs,sexual,drugs,coded}.txt apply everywhere;
# denylist/trademarks.txt applies to seed-1 content, every path name and the commit message;
# denylist/allow.txt phrases are removed before matching; denylist/hashed.txt holds sha256 hex
# digests compared against every token.
#
# First output line: PASS: ... or FAIL: ... ; the FAIL line names the first hit and its term
# (a hashed hit shows the digest prefix). Exit 0 pass, 1 fail, 2 usage.
set -u
GATE_DIR=$(cd "$(dirname "$0")" && pwd)
. "$GATE_DIR/lib/common.sh"
REPO_ROOT=$(gate_repo_root)
DENYLIST_DIR="$GATE_DIR/denylist"
SCAN_AWK="$GATE_DIR/lib/banned-scan.awk"

usage() {
  echo "usage: banned-phrases.sh [--commit-message-file f] [--changed-files-file f] [--denylist-dir d] [--repo-root d] [path ...]" >&2
  exit 2
}

MESSAGE_FILE=""
CHANGED_FILE=""
PATHS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --commit-message-file) [ $# -ge 2 ] || usage; MESSAGE_FILE=$(gate_abs_path "$2"); shift 2 ;;
    --changed-files-file) [ $# -ge 2 ] || usage; CHANGED_FILE=$(gate_abs_path "$2"); shift 2 ;;
    --denylist-dir) [ $# -ge 2 ] || usage; DENYLIST_DIR=$(gate_abs_path "$2"); shift 2 ;;
    --repo-root) [ $# -ge 2 ] || usage; REPO_ROOT=$(gate_abs_path "$2"); shift 2 ;;
    --) shift; break ;;
    -*) usage ;;
    *) PATHS="$PATHS
$(gate_abs_path "$1")"; shift ;;
  esac
done
while [ $# -gt 0 ]; do PATHS="$PATHS
$(gate_abs_path "$1")"; shift; done
[ -n "$PATHS$CHANGED_FILE$MESSAGE_FILE" ] || usage
[ -z "$MESSAGE_FILE" ] || [ -f "$MESSAGE_FILE" ] || { echo "FAIL: banned-phrases commit message file not found"; exit 2; }
[ -z "$CHANGED_FILE" ] || [ -f "$CHANGED_FILE" ] || { echo "FAIL: banned-phrases changed files list not found"; exit 2; }
[ -d "$DENYLIST_DIR" ] || { echo "FAIL: banned-phrases denylist folder not found"; exit 2; }

WORK=$(mktemp -d "${TMPDIR:-/tmp}/banned-phrases.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
export LC_ALL=C

# 1. Normalized term table (list<TAB>phrase) and allow phrases.
: > "$WORK/terms.tsv"
for list in profanity slurs sexual drugs coded trademarks; do
  file="$DENYLIST_DIR/$list.txt"
  [ -f "$file" ] || { echo "FAIL: banned-phrases list missing: $list.txt"; exit 2; }
  grep -v '^#' "$file" | grep -v '^[[:space:]]*$' | awk -v mode=normalize -f "$SCAN_AWK" \
    | grep -v '^$' | sed "s/^/$list	/" >> "$WORK/terms.tsv"
done
sort -u "$WORK/terms.tsv" -o "$WORK/terms.tsv"
: > "$WORK/allow.txt"
if [ -f "$DENYLIST_DIR/allow.txt" ]; then
  grep -v '^#' "$DENYLIST_DIR/allow.txt" | grep -v '^[[:space:]]*$' \
    | awk -v mode=normalize -f "$SCAN_AWK" | grep -v '^$' > "$WORK/allow.txt"
fi
HASHED="$DENYLIST_DIR/hashed.txt"

# 2. Inputs: content files (split by trademark scope), path names, commit message.
: > "$WORK/files.txt"
: > "$WORK/names.txt"
printf '%s\n' "$PATHS" | grep -v '^$' | while IFS= read -r p; do
  if [ -d "$p" ]; then
    gate_find_files "$p" >> "$WORK/files.txt"
    gate_find_paths "$p" >> "$WORK/names.txt"
  elif [ -f "$p" ]; then
    printf '%s\n' "$p" >> "$WORK/files.txt"
    printf '%s\n' "$p" >> "$WORK/names.txt"
  else
    echo "FAIL: banned-phrases path not found: $(gate_rel_path "$p")"
    exit 2
  fi
done || exit 2
if [ -n "$CHANGED_FILE" ]; then
  grep -v '^[[:space:]]*$' "$CHANGED_FILE" | while IFS= read -r rel; do
    case "$rel" in /*) abs="$rel" ;; *) abs="$REPO_ROOT/$rel" ;; esac
    if [ -f "$abs" ]; then printf '%s\n' "$abs" >> "$WORK/files.txt"; printf '%s\n' "$abs" >> "$WORK/names.txt"; fi
  done
fi
: > "$WORK/seed.txt"
: > "$WORK/other.txt"
# The lists themselves are never scanned: neither the folder in use nor the one in the repository.
is_list_file() {
  case "$1" in "$DENYLIST_DIR"|"$DENYLIST_DIR"/*) return 0 ;; esac
  case "$(gate_rel_path "$1")" in platform/gate/denylist|platform/gate/denylist/*) return 0 ;; esac
  return 1
}
sort -u "$WORK/files.txt" | while IFS= read -r f; do
  is_list_file "$f" && continue
  gate_is_generated "$f" && continue
  gate_is_text "$f" || continue
  rel=$(gate_rel_path "$f")
  case "$rel" in
    seed-1/*) printf '%s\n' "$rel" >> "$WORK/seed.txt" ;;
    *) printf '%s\n' "$rel" >> "$WORK/other.txt" ;;
  esac
done
sort -u "$WORK/names.txt" | while IFS= read -r n; do
  is_list_file "$n" && continue
  gate_rel_path "$n"
done > "$WORK/relnames.txt"

# 3. Scans. Relative paths resolve from the repo root so locations read as repo paths.
cd "$REPO_ROOT" || exit 2
: > "$WORK/hits.tsv"
: > "$WORK/tokens.tsv"
scan_files() {
  # $1 list of files, $2 tm flag
  [ -s "$1" ] || return 0
  awk -v mode=scan -v termfile="$WORK/terms.tsv" -v allowfile="$WORK/allow.txt" -v listfile="$1" \
    -v tm="$2" -v tokfile="$WORK/tokens.tsv" \
    -f "$SCAN_AWK" >> "$WORK/hits.tsv"
}
scan_files "$WORK/seed.txt" 1
scan_files "$WORK/other.txt" 0
if [ -s "$WORK/relnames.txt" ]; then
  awk -v mode=paths -v termfile="$WORK/terms.tsv" -v allowfile="$WORK/allow.txt" -v tm=1 \
    -v tokfile="$WORK/tokens.tsv" -f "$SCAN_AWK" "$WORK/relnames.txt" >> "$WORK/hits.tsv"
fi
if [ -n "$MESSAGE_FILE" ]; then
  awk -v mode=scan -v termfile="$WORK/terms.tsv" -v allowfile="$WORK/allow.txt" -v tm=1 \
    -v name=commit-message -v tokfile="$WORK/tokens.tsv" -f "$SCAN_AWK" "$MESSAGE_FILE" >> "$WORK/hits.tsv"
fi

# 4. Hashed comparison: sha256 of every distinct token against hashed.txt, in one node process.
if [ -f "$HASHED" ] && [ -s "$WORK/tokens.tsv" ]; then
  node -e '
    const fs = require("fs"), crypto = require("crypto");
    const [tokFile, hashFile] = process.argv.slice(1);
    const hashes = new Set(fs.readFileSync(hashFile, "utf8").split(/\r?\n/).map((s) => s.trim().toLowerCase()).filter((s) => /^[0-9a-f]{64}$/.test(s)));
    const seen = new Set();
    for (const line of fs.readFileSync(tokFile, "utf8").split("\n")) {
      if (!line) continue;
      const i = line.indexOf("\t");
      const tok = line.slice(0, i), where = line.slice(i + 1);
      if (seen.has(tok)) continue;
      seen.add(tok);
      const h = crypto.createHash("sha256").update(tok).digest("hex");
      if (hashes.has(h)) process.stdout.write("hit\t" + where + "\thashed\tsha256:" + h.slice(0, 12) + "\n");
    }
  ' "$WORK/tokens.tsv" "$HASHED" >> "$WORK/hits.tsv" || { echo "FAIL: banned-phrases hashed comparison did not run"; exit 2; }
fi

# 5. Report. Only the FAIL line carries a term; later hits give location and list.
FILE_COUNT=$(( $(wc -l < "$WORK/seed.txt") + $(wc -l < "$WORK/other.txt") ))
NAME_COUNT=$(wc -l < "$WORK/relnames.txt" | tr -d ' ')
MATCHES=$(grep -c '^hit' "$WORK/hits.tsv" || true)
if [ "$MATCHES" -eq 0 ]; then
  echo "PASS: banned-phrases files=$FILE_COUNT paths=$NAME_COUNT message=$([ -n "$MESSAGE_FILE" ] && echo yes || echo no)"
  exit 0
fi
sort -t '	' -k2,2 -k3,3 "$WORK/hits.tsv" | awk -F '\t' '
  NR == 1 { print "FAIL: banned-phrases hits=" total " first=" $2 " list=" $3 " term=" $4; next }
  { print "hit where=" $2 " list=" $3 }
' total="$MATCHES"
exit 1
