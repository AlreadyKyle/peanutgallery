#!/usr/bin/env bash
# secret-scan.sh: fails when a file carries a credential shape. The matched value is never printed.
#
# usage: secret-scan.sh [--repo-root d] --tracked | --working-tree | path ...
#   --tracked       every file git tracks in the repository
#   --working-tree  tracked plus untracked files that are not ignored (the local pre-commit view)
#   path ...        files, or folders scanned recursively (dependency and build folders skipped)
#   --repo-root d   the repository to read for --tracked and --working-tree (default: this one)
#
# Shapes: Stripe secret, restricted, publishable and webhook keys; GitHub tokens (personal, OAuth
# as the gh command line stores it, user-to-server, server-to-server and refresh) and fine-grained
# tokens; Netlify personal tokens; JSON web tokens; Anthropic, OpenAI (project, service, admin and
# legacy) and Google API keys; Supabase secret keys and Management API access tokens (a Supabase
# publishable key is public and is not a shape); Discord webhook addresses; age secret keys (the
# backups' identity); the first line of a PEM private key block. A prefix alone is not a hit: a real key
# always carries a body, so the pattern text in this file and in documentation does not match
# itself. Lock files and binary media are skipped; SVGs, source maps and minified bundles are
# served, so they are scanned. Any other file with a NUL byte or a UTF-16 byte order mark fails as
# shape=unreadable: a scan that cannot read it cannot pass it.
# First output line: PASS: ... or FAIL: ... (file, line and shape name only). Exit 0 pass, 1 fail, 2 usage.
set -u
GATE_DIR=$(cd "$(dirname "$0")" && pwd)
. "$GATE_DIR/lib/common.sh"
REPO_ROOT=$(gate_repo_root)

usage() {
  echo "usage: secret-scan.sh [--repo-root d] --tracked | --working-tree | path ..." >&2
  exit 2
}

shapes() {
  printf '%s\t%s\n' \
    stripe-secret-key 'sk_live_[0-9A-Za-z]{8}' \
    stripe-test-key 'sk_test_[0-9A-Za-z]{8}' \
    stripe-restricted-key 'rk_live_[0-9A-Za-z]{8}' \
    stripe-publishable-key 'pk_live_[0-9A-Za-z]{8}' \
    stripe-webhook-secret 'whsec_[0-9A-Za-z]{8}' \
    github-token 'gh[pousr]_[0-9A-Za-z]{8}' \
    github-fine-grained-token 'github_pat_[0-9A-Za-z_]{8}' \
    netlify-token 'nfp_[0-9A-Za-z_-]{8}' \
    json-web-token 'eyJhbGciOi[0-9A-Za-z_-]{16}' \
    anthropic-key 'sk-ant-[0-9A-Za-z_-]{12}' \
    supabase-secret-key 'sb_secret_[0-9A-Za-z_-]{8}' \
    openai-key 'sk-(proj|svcacct|admin)-[0-9A-Za-z_-]{8}' \
    openai-key-legacy 'sk-[0-9A-Za-z_-]{16,}T3BlbkFJ' \
    google-api-key 'AIza[0-9A-Za-z_-]{35}' \
    supabase-access-token 'sbp_[0-9a-f]{40}' \
    discord-webhook 'discord(app)?\.com/api/webhooks/[0-9]{17,20}/[0-9A-Za-z_-]{20}' \
    age-secret-key 'AGE-SECRET-KEY-1[0-9A-Z]{20}' \
    private-key '-----BEGIN [A-Z ]*PRIVATE KEY-----'
}

if [ "${1:-}" = "--repo-root" ]; then
  [ $# -ge 3 ] || usage
  REPO_ROOT=$(gate_abs_path "$2")
  shift 2
fi
[ $# -ge 1 ] || usage
WORK=$(mktemp -d "${TMPDIR:-/tmp}/secret-scan.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
export LC_ALL=C

# The files git lists, as absolute paths one per line. A scan that read nothing because git failed
# (not a repository, a checkout git refuses) must not pass, and REPO_ROOT goes through printf, not
# sed, so a repository path holding & or | is read like any other.
list_git_files() {
  git -C "$REPO_ROOT" ls-files -z "$@" > "$WORK/listed.z" 2> "$WORK/listed.err" \
    || { echo "FAIL: secret-scan cannot list the files of $REPO_ROOT: $(head -n 1 "$WORK/listed.err")"; exit 1; }
  tr '\0' '\n' < "$WORK/listed.z" | while IFS= read -r rel; do printf '%s/%s\n' "$REPO_ROOT" "$rel"; done > "$WORK/files.txt"
}

case "$1" in
  --tracked)
    [ $# -eq 1 ] || usage
    list_git_files
    ;;
  --working-tree)
    [ $# -eq 1 ] || usage
    list_git_files -co --exclude-standard
    ;;
  -*) usage ;;
  *)
    : > "$WORK/files.txt"
    for p in "$@"; do
      abs=$(gate_abs_path "$p")
      if [ -d "$abs" ]; then gate_find_files "$abs" >> "$WORK/files.txt"
      elif [ -f "$abs" ]; then printf '%s\n' "$abs" >> "$WORK/files.txt"
      else echo "FAIL: secret-scan path not found: $p"; exit 2; fi
    done
    ;;
esac

ALL=$(shapes | cut -f2 | paste -s -d '|' -)
: > "$WORK/hits.txt"
COUNT=0
while IFS= read -r f; do
  [ -f "$f" ] || continue
  gate_is_lock_file "$f" && continue
  gate_is_binary_media "$f" && continue
  gate_text_kind "$f"
  case $? in
    1) continue ;;
    2) printf '%s\t1\tunreadable\n' "$(gate_rel_path "$f")" >> "$WORK/hits.txt"; COUNT=$((COUNT + 1)); continue ;;
  esac
  COUNT=$((COUNT + 1))
  grep -qE -e "$ALL" "$f" || continue
  rel=$(gate_rel_path "$f")
  shapes | while IFS='	' read -r name pattern; do
    grep -nE -e "$pattern" "$f" | cut -d: -f1 | while IFS= read -r line; do
      printf '%s\t%s\t%s\n' "$rel" "$line" "$name" >> "$WORK/hits.txt"
    done
  done
done < <(sort -u "$WORK/files.txt")

MATCHES=$(wc -l < "$WORK/hits.txt" | tr -d ' ')
if [ "$MATCHES" -eq 0 ]; then
  echo "PASS: secret-scan files=$COUNT"
  exit 0
fi
awk -F '\t' -v total="$MATCHES" '
  NR == 1 { print "FAIL: secret-scan hits=" total " first=" $1 ":" $2 " shape=" $3; next }
  { print "hit file=" $1 " line=" $2 " shape=" $3 }
' "$WORK/hits.txt"
exit 1
