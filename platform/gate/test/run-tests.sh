#!/usr/bin/env bash
# run-tests.sh: tests for every gate script. Fixtures are built at run time in a temporary folder:
# deny-listed terms are read from the lists, credential shapes are assembled from parts and
# runtime tokens are spelled in halves, so this file holds none of them in plain text.
# First output line of the summary: PASS: gate tests ... or FAIL: gate tests ... ; exit 0 or 1.
set -u
GATE_DIR=$(cd "$(dirname "$0")/.." && pwd)
. "$GATE_DIR/lib/common.sh"
REPO_ROOT=$(gate_repo_root)
T=$(mktemp -d "${TMPDIR:-/tmp}/gate-tests.XXXXXX")
trap 'rm -rf "$T"' EXIT
export LC_ALL=C
export GIT_AUTHOR_NAME=gate-tests GIT_AUTHOR_EMAIL=gate-tests@localhost GIT_COMMITTER_NAME=gate-tests GIT_COMMITTER_EMAIL=gate-tests@localhost
PASSED=0
FAILED=0
LOG="$T/log.txt"

# expect <name> <exit code> <first-line regex> -- <command ...>
# Runs the command, compares the exit code and the first stdout line. Output is kept in $LAST.
LAST=""
expect() {
  local name=$1 want=$2 pattern=$3 status first
  shift 3
  [ "$1" = "--" ] && shift
  LAST=$("$@" 2> "$T/stderr.txt")
  status=$?
  first=$(printf '%s\n' "$LAST" | head -n 1)
  if [ "$status" -eq "$want" ] && printf '%s\n' "$first" | grep -Eq "$pattern"; then
    PASSED=$((PASSED + 1))
    echo "ok   $name" >> "$LOG"
  else
    FAILED=$((FAILED + 1))
    echo "FAIL $name: exit $status (wanted $want), first line: $(printf '%s' "$first" | sed 's/term=.*/term=<not shown>/') (wanted /$pattern/)" | tee -a "$LOG"
    sed 's/^/     stderr: /' "$T/stderr.txt" | head -n 5 | tee -a "$LOG"
  fi
}

# assert <name> <command ...>: passes when the command exits 0.
assert() {
  local name=$1
  shift
  if "$@"; then PASSED=$((PASSED + 1)); echo "ok   $name" >> "$LOG"
  else FAILED=$((FAILED + 1)); echo "FAIL $name" | tee -a "$LOG"; fi
}

# The n-th single-word term of a list with at least four letters (leet letters included).
term_from() {
  grep -v '^#' "$GATE_DIR/denylist/$1.txt" | awk -v n="$2" 'length($0) >= 4 && $0 !~ /[^a-z]/ && $0 ~ /[oieast]/ { k++; if (k == n) { print; exit } }'
}
sha256_hex() {
  node -e 'process.stdout.write(require("crypto").createHash("sha256").update(process.argv[1]).digest("hex"))' "$1"
}

# A string spelled entirely in JSON \u escapes: ab becomes ab.
json_escaped() {
  printf '%s' "$1" | od -An -tx1 | tr -d ' \n' | sed 's/\(..\)/\\u00\1/g'
}

BANNED="$GATE_DIR/banned-phrases.sh"
TOKENS="$GATE_DIR/runtime-token-deny.sh"
SECRETS="$GATE_DIR/secret-scan.sh"
CHANGED="$GATE_DIR/changed-paths.sh"
SHIP="$GATE_DIR/ship-gate.sh"
BOT="$GATE_DIR/headless-bot/run.mjs"
RESTORE="$GATE_DIR/restore-kernel.sh"

# ---------------------------------------------------------------- banned-phrases.sh
P1=$(term_from profanity 1)
S1=$(term_from sexual 2)
D1=$(term_from drugs 3)
TM1=$(grep -v '^#' "$GATE_DIR/denylist/trademarks.txt" | awk 'length($0) >= 5 && $0 !~ /[^a-z]/ { print; exit }')
ALLOW1=$(grep -v '^#' "$GATE_DIR/denylist/allow.txt" | head -n 1)
[ -n "$P1" ] && [ -n "$S1" ] && [ -n "$D1" ] && [ -n "$TM1" ] && [ -n "$ALLOW1" ] || { echo "FAIL: gate tests could not read fixture terms from the lists"; exit 1; }

A="$T/a"
mkdir -p "$A/seed-1/content" "$A/seed-1/config" "$A/platform/site/src" "$A/node_modules/pkg"
printf '{"title":"Dust","labels":{"buy":"Buy","owned":"owned"},"cost":455}\n' > "$A/seed-1/content/strings.json"
printf '{"rows":[{"id":"gatherer","name":"Gatherer","baseCost":10,"rate":0.2}]}\n' > "$A/seed-1/config/spawn-table.json"
printf 'export const title = "Untitled Game Studio";\n' > "$A/platform/site/src/copy.ts"
expect "banned: clean tree passes" 0 '^PASS: banned-phrases files=3 paths=' -- bash "$BANNED" --repo-root "$A" "$A/seed-1" "$A/platform"
expect "banned: no input is a usage error" 2 '^$' -- bash "$BANNED"
expect "banned: missing path is an error" 2 '^FAIL: banned-phrases path not found' -- bash "$BANNED" "$A/none"
expect "banned: -- ends the options" 0 '^PASS: banned-phrases files=3 paths=' -- bash "$BANNED" --repo-root "$A" -- "$A/seed-1" "$A/platform"
expect "banned: missing list folder is an error" 2 '^FAIL: banned-phrases denylist folder not found' -- bash "$BANNED" --denylist-dir "$A/none" "$A/seed-1"

printf '{"title":"%s"}\n' "$P1" > "$A/seed-1/content/strings.json"
expect "banned: plain term in content fails" 1 "^FAIL: banned-phrases hits=1 first=seed-1/content/strings.json:1 list=profanity term=$P1\$" -- bash "$BANNED" --repo-root "$A" "$A/seed-1"
assert "banned: the term is printed once, on the FAIL line only" test "$(printf '%s\n' "$LAST" | grep -c "$P1")" = 1
printf '{"title":"%s"}\n' "$(printf '%s' "$P1" | tr a-z A-Z)" > "$A/seed-1/content/strings.json"
expect "banned: uppercase term fails" 1 '^FAIL: banned-phrases hits=1 ' -- bash "$BANNED" --repo-root "$A" "$A/seed-1"
printf '{"title":"%s"}\n' "$(printf '%s' "$P1" | tr oieast 013457)" > "$A/seed-1/content/strings.json"
expect "banned: leet spelling fails" 1 '^FAIL: banned-phrases hits=1 .* list=profanity' -- bash "$BANNED" --repo-root "$A" "$A/seed-1"
printf '{"title":"%s"}\n' "$(printf '%s' "$P1" | sed 's/./& /g; s/ $//')" > "$A/seed-1/content/strings.json"
expect "banned: spaced spelling fails" 1 '^FAIL: banned-phrases hits=1 .* list=profanity' -- bash "$BANNED" --repo-root "$A" "$A/seed-1"
printf '{"title":"%s"}\n' "$(printf '%s' "$P1" | sed 's/./&./g; s/\.$//')" > "$A/seed-1/content/strings.json"
expect "banned: dotted spelling fails" 1 '^FAIL: banned-phrases hits=1 .* list=profanity' -- bash "$BANNED" --repo-root "$A" "$A/seed-1"
# JSON.parse turns escapes into the characters a player sees, so a .json line is decoded first.
printf '{"title":"%s"}\n' "$(json_escaped "$P1")" > "$A/seed-1/content/strings.json"
expect "banned: a term spelled in JSON \\u escapes fails" 1 '^FAIL: banned-phrases hits=1 first=seed-1/content/strings.json:1 list=profanity' -- bash "$BANNED" --repo-root "$A" "$A/seed-1"
printf '{"title":"%s"}\n' "$(json_escaped "$P1" | tr 'a-f' 'A-F')" > "$A/seed-1/content/strings.json"
expect "banned: uppercase hex escapes fail" 1 '^FAIL: banned-phrases hits=1 first=seed-1/content/strings.json:1 list=profanity' -- bash "$BANNED" --repo-root "$A" "$A/seed-1"
printf '{"title":"%s%s"}\n' "$(json_escaped "$(printf '%s' "$P1" | cut -c1)")" "$(printf '%s' "$P1" | cut -c2-)" > "$A/seed-1/content/strings.json"
expect "banned: a term with only its first letter escaped fails" 1 '^FAIL: banned-phrases hits=1 first=seed-1/content/strings.json:1 list=profanity' -- bash "$BANNED" --repo-root "$A" "$A/seed-1"
printf '{"title":"Dust\\n%s"}\n' "$P1" > "$A/seed-1/content/strings.json"
expect "banned: a term after an escaped newline fails" 1 '^FAIL: banned-phrases hits=1 first=seed-1/content/strings.json:1 list=profanity' -- bash "$BANNED" --repo-root "$A" "$A/seed-1"
printf '{"title":"Dust \\u00e9 \\\\u0041 \\/ \\"quoted\\""}\n' > "$A/seed-1/content/strings.json"
expect "banned: other escapes in clean JSON pass" 0 '^PASS: banned-phrases files=3 ' -- bash "$BANNED" --repo-root "$A" "$A/seed-1" "$A/platform"
printf '{"title":"Dust"}\n' > "$A/seed-1/content/strings.json"
# A file the line scanners cannot read fails instead of being skipped.
printf '{"title":"Dust"}\000\n' > "$A/seed-1/content/nul.json"
expect "banned: a file with a NUL byte fails as unreadable" 1 '^FAIL: banned-phrases hits=1 first=seed-1/content/nul.json:1 list=unreadable term=nul-or-utf16$' -- bash "$BANNED" --repo-root "$A" "$A/seed-1"
rm -f "$A/seed-1/content/nul.json"
printf '\377\376{\000}\000\n\000' > "$A/seed-1/content/wide.json"
expect "banned: a UTF-16 little-endian file fails as unreadable" 1 '^FAIL: banned-phrases hits=1 first=seed-1/content/wide.json:1 list=unreadable' -- bash "$BANNED" --repo-root "$A" "$A/seed-1"
printf '\376\377\000{\000}' > "$A/seed-1/content/wide.json"
expect "banned: a UTF-16 big-endian file fails as unreadable" 1 '^FAIL: banned-phrases hits=1 first=seed-1/content/wide.json:1 list=unreadable' -- bash "$BANNED" --repo-root "$A" "$A/seed-1"
rm -f "$A/seed-1/content/wide.json"
: > "$A/seed-1/content/empty.json"
printf 'Bud1\000\000' > "$A/seed-1/.DS_Store"
expect "banned: an empty file and a Finder .DS_Store file pass" 0 '^PASS: banned-phrases files=3 ' -- bash "$BANNED" --repo-root "$A" "$A/seed-1" "$A/platform"
rm -f "$A/seed-1/content/empty.json" "$A/seed-1/.DS_Store"
printf '{"title":"x%sy and %s5"}\n' "$P1" "$P1" > "$A/seed-1/content/strings.json"
expect "banned: term inside a longer token passes" 0 '^PASS: banned-phrases' -- bash "$BANNED" --repo-root "$A" "$A/seed-1"
printf '{"title":"cost 455 and 413 and 7175"}\n' > "$A/seed-1/content/strings.json"
expect "banned: pure numbers are not words" 0 '^PASS: banned-phrases' -- bash "$BANNED" --repo-root "$A" "$A/seed-1"
printf 'The rating: %s.\n' "$ALLOW1" > "$A/seed-1/content/strings.json"
expect "banned: allow phrase passes" 0 '^PASS: banned-phrases' -- bash "$BANNED" --repo-root "$A" "$A/seed-1"
printf 'The rating: %s and %s.\n' "$ALLOW1" "$D1" > "$A/seed-1/content/strings.json"
expect "banned: allow phrase does not cover a term beside it" 1 '^FAIL: banned-phrases hits=1 .* list=drugs' -- bash "$BANNED" --repo-root "$A" "$A/seed-1"
printf '{"title":"Dust"}\n' > "$A/seed-1/content/strings.json"

printf 'plain\n' > "$A/seed-1/content/$S1.json"
expect "banned: term in a file name fails" 1 "^FAIL: banned-phrases hits=1 first=path:seed-1/content/$S1.json list=sexual" -- bash "$BANNED" --repo-root "$A" "$A/seed-1"
rm -f "$A/seed-1/content/$S1.json"
printf 'card 1234abcd: rename the %s unit\n' "$D1" > "$T/message.txt"
expect "banned: term in the commit message fails" 1 '^FAIL: banned-phrases hits=1 first=commit-message:1 list=drugs' -- bash "$BANNED" --repo-root "$A" --commit-message-file "$T/message.txt"
printf 'card 1234abcd: raise the cart rate\n' > "$T/message.txt"
expect "banned: clean commit message passes" 0 '^PASS: banned-phrases files=0 paths=0 message=yes$' -- bash "$BANNED" --repo-root "$A" --commit-message-file "$T/message.txt"

printf '{"title":"%s"}\n' "$TM1" > "$A/seed-1/content/strings.json"
expect "banned: trademark in seed content fails" 1 '^FAIL: banned-phrases hits=1 .* list=trademarks' -- bash "$BANNED" --repo-root "$A" "$A/seed-1"
printf '{"title":"Dust"}\n' > "$A/seed-1/content/strings.json"
printf 'export const note = "%s";\n' "$TM1" > "$A/platform/site/src/copy.ts"
expect "banned: trademark in platform prose passes" 0 '^PASS: banned-phrases' -- bash "$BANNED" --repo-root "$A" "$A/platform"
printf 'export const title = "Untitled Game Studio";\n' > "$A/platform/site/src/copy.ts"
mkdir -p "$A/platform/site/src/$TM1"
expect "banned: trademark in a platform path fails" 1 "^FAIL: banned-phrases hits=1 first=path:platform/site/src/$TM1 list=trademarks" -- bash "$BANNED" --repo-root "$A" "$A/platform"
rmdir "$A/platform/site/src/$TM1"

printf '{"title":"%s"}\n' "$P1" > "$A/pnpm-lock.yaml"
printf '{"title":"%s"}\n' "$P1" > "$A/node_modules/pkg/index.json"
expect "banned: lock files and node_modules are skipped" 0 '^PASS: banned-phrases' -- bash "$BANNED" --repo-root "$A" "$A"
rm -f "$A/pnpm-lock.yaml"
printf '%s\n' "$P1" > "$A/outside.txt"
printf 'outside.txt\nmissing.txt\n' > "$T/changed.txt"
expect "banned: changed file outside the paths is scanned" 1 '^FAIL: banned-phrases hits=1 first=outside.txt:1 list=profanity' -- bash "$BANNED" --repo-root "$A" --changed-files-file "$T/changed.txt" "$A/seed-1"
rm -f "$A/outside.txt"

MARK=gatemarkertoken
mkdir -p "$T/lists"
cp "$GATE_DIR"/denylist/*.txt "$T/lists/"
sha256_hex "$MARK" > "$T/lists/hashed.txt"
printf 'title: %s\n' "$(printf '%s' "$MARK" | tr a-z A-Z)" > "$A/seed-1/content/strings.json"
expect "banned: hashed term fails with the digest prefix" 1 "^FAIL: banned-phrases hits=1 first=seed-1/content/strings.json:1 list=hashed term=sha256:$(sha256_hex "$MARK" | cut -c1-12)\$" -- bash "$BANNED" --repo-root "$A" --denylist-dir "$T/lists" "$A/seed-1"
printf 'title: %s\n' "$(printf '%s' "$MARK" | sed 's/./&./g; s/\.$//')" > "$A/seed-1/content/strings.json"
expect "banned: hashed term in dotted spelling fails" 1 '^FAIL: banned-phrases hits=1 .* list=hashed' -- bash "$BANNED" --repo-root "$A" --denylist-dir "$T/lists" "$A/seed-1"
expect "banned: the same text passes against the shipped hashed list" 0 '^PASS: banned-phrases' -- bash "$BANNED" --repo-root "$A" "$A/seed-1"
printf '{"title":"Dust"}\n' > "$A/seed-1/content/strings.json"
printf 'docs/PLAN.md\n' > "$T/changed.txt"
expect "banned: the shipped docs/PLAN.md passes the hashed comparison" 0 '^PASS: banned-phrases files=1' -- bash "$BANNED" --repo-root "$REPO_ROOT" --changed-files-file "$T/changed.txt"
mkdir -p "$A/docs"
# A line in the middle of the real plan, so the fixture follows the file as it changes length.
PLAN_MID=$(( $(wc -l < "$REPO_ROOT/docs/PLAN.md" | tr -d ' ') / 2 ))
awk -v mark="$MARK" -v line="$PLAN_MID" 'NR == line { print "title: " mark; next } { print }' "$REPO_ROOT/docs/PLAN.md" > "$A/docs/PLAN.md"
expect "banned: hashed term on a middle docs/PLAN.md line fails (no exemption)" 1 "^FAIL: banned-phrases hits=1 first=docs/PLAN.md:$PLAN_MID list=hashed" -- bash "$BANNED" --repo-root "$A" --denylist-dir "$T/lists" "$A/docs/PLAN.md"
cp "$REPO_ROOT/docs/PLAN.md" "$A/docs/PLAN.md"
printf 'title: %s\n' "$MARK" >> "$A/docs/PLAN.md"
PLAN_LAST=$(wc -l < "$A/docs/PLAN.md" | tr -d ' ')
expect "banned: hashed term on another docs/PLAN.md line fails" 1 "^FAIL: banned-phrases hits=1 first=docs/PLAN.md:$PLAN_LAST list=hashed" -- bash "$BANNED" --repo-root "$A" --denylist-dir "$T/lists" "$A/docs/PLAN.md"
rm -rf "$A/docs"

# ---------------------------------------------------------------- runtime-token-deny.sh
B="$T/b"
mkdir -p "$B/seed-1/config" "$B/seed-1/content" "$B/seed-1/sim" "$B/seed-1/render" "$B/seed-1/tests" "$B/platform/site/src" "$B/platform/agents/prompts"
printf '{"rows":[{"id":"gatherer","baseCost":10,"rate":0.2}]}\n' > "$B/seed-1/config/spawn-table.json"
printf '{"title":"Dust"}\n' > "$B/seed-1/content/strings.json"
printf 'export const rate = (owned: number): number => 1 + 0.2 * owned;\n' > "$B/seed-1/sim/index.ts"
printf 'export const title = "Dust";\n' > "$B/seed-1/render/main.ts"
printf 'export const copy = { title: "Untitled Game Studio" };\n' > "$B/platform/site/src/copy.ts"
printf 'The role edits config files only.\n' > "$B/platform/agents/prompts/builder-a.md"
expect "tokens: clean seed folder passes" 0 '^PASS: runtime-token-deny files=4$' -- bash "$TOKENS" --repo-root "$B" --folder seed-1
expect "tokens: clean platform folder passes" 0 '^PASS: runtime-token-deny files=2$' -- bash "$TOKENS" --repo-root "$B" --folder platform
expect "tokens: no input is a usage error" 2 '^$' -- bash "$TOKENS"
expect "tokens: unknown folder is a usage error" 2 '^$' -- bash "$TOKENS" --folder docs
expect "tokens: missing path is an error" 2 '^FAIL: runtime-token-deny path not found' -- bash "$TOKENS" --repo-root "$B" "$B/none"
expect "tokens: -- ends the options" 0 '^PASS: runtime-token-deny files=2$' -- bash "$TOKENS" --repo-root "$B" -- "$B/platform/agents" "$B/platform/site/src"

# name|token spelled in halves
token_cases() {
  printf '%s|%s\n' \
    nan "Na""N" undefined "unde""fined" type-error "Type""Error" reference-error "Reference""Error" \
    object-object "[object"" Object]" open-task-marker "TO""DO" fix-marker "FIX""ME" replace-marker "REPLACE""_ME" \
    latin-filler "Lor""em ips""um" latin-filler-2 "dolor sit ""amet" undecided-marker "TB""D" x-run "XX""XX" \
    unset-marker "place""holder" soon-phrase "coming ""soon" soon-paren "(so""on)" stock-name-1 "John ""Doe" \
    stock-name-2 "Jane ""Doe" stock-email "test@""example.com" stripe-key-stub "sk_live""_x"
}
token_cases | while IFS='|' read -r name token; do
  printf '{"title":"Dust","note":"value %s here"}\n' "$token" > "$B/seed-1/content/strings.json"
  expect "tokens: $name in content fails" 1 "^FAIL: runtime-token-deny hits=1 first=seed-1/content/strings.json:1 pattern=$name\$" -- bash "$TOKENS" --repo-root "$B" --folder seed-1
  echo "$PASSED $FAILED" > "$T/counts.txt"
done
read -r PASSED FAILED < "$T/counts.txt"
printf '{"title":"Dust"}\n' > "$B/seed-1/content/strings.json"

U="unde""fined"
N="Na""N"
TD="TO""DO"
cat > "$B/seed-1/sim/index.ts" <<EOF_TS
// $TD comments are removed before matching
export function pick(rows: readonly number[], i: number): number | $U {
  const row = rows[i];
  if (row === $U) return $U;
  if (typeof row === '$U') return $U;
  const fallback = row ?? $U;
  if (Number.is$N(fallback)) throw new TypeError("not a number");
  return fallback !== $U ? fallback : $U;
}
/* block comment
   with $TD inside */
export const url = "https://example.org/path"; // $TD trailing
export const re = /https?:\/\/[^/]+/; // $TD after a regular expression
export const half = (a: number, b: number): number => a / 2 / b; // $TD after division
EOF_TS
expect "tokens: safe contexts and comments in code pass" 0 '^PASS: runtime-token-deny' -- bash "$TOKENS" --repo-root "$B" --folder seed-1
printf 'export const label = "value: %s";\n' "$U" > "$B/seed-1/sim/index.ts"
expect "tokens: identifier inside a string fails" 1 '^FAIL: runtime-token-deny hits=1 first=seed-1/sim/index.ts:1 pattern=undefined$' -- bash "$TOKENS" --repo-root "$B" --folder seed-1
printf 'export const label = `rate ${1} is %s`;\n' "$N" > "$B/seed-1/sim/index.ts"
expect "tokens: identifier inside a template literal fails" 1 '^FAIL: runtime-token-deny hits=1 first=seed-1/sim/index.ts:1 pattern=nan$' -- bash "$TOKENS" --repo-root "$B" --folder seed-1
printf 'export const u = "http://host/%s";\n' "$TD" > "$B/seed-1/sim/index.ts"
expect "tokens: a double slash inside a string is not a comment" 1 '^FAIL: runtime-token-deny hits=1 first=seed-1/sim/index.ts:1 pattern=open-task-marker$' -- bash "$TOKENS" --repo-root "$B" --folder seed-1
printf 'export const r = Math.ran%s();\n' "dom" > "$B/seed-1/sim/index.ts"
expect "tokens: Math.random under seed-1/sim fails" 1 '^FAIL: runtime-token-deny hits=1 first=seed-1/sim/index.ts:1 pattern=math-random$' -- bash "$TOKENS" --repo-root "$B" --folder seed-1
printf 'export const rate = 1;\n' > "$B/seed-1/sim/index.ts"
printf 'export const r = Math.ran%s();\n' "dom" > "$B/seed-1/render/main.ts"
expect "tokens: Math.random outside seed-1/sim passes" 0 '^PASS: runtime-token-deny' -- bash "$TOKENS" --repo-root "$B" --folder seed-1
printf 'export const title = "Dust";\n' > "$B/seed-1/render/main.ts"
# Test files and folders are card code too, and anything in them can be imported and shipped.
printf 'export const t = "%s";\n' "$TD" > "$B/seed-1/sim/index.test.ts"
expect "tokens: a test file is scanned" 1 '^FAIL: runtime-token-deny hits=1 first=seed-1/sim/index.test.ts:1 pattern=open-task-marker$' -- bash "$TOKENS" --repo-root "$B" --folder seed-1
rm -f "$B/seed-1/sim/index.test.ts"
printf 'export const t = "%s";\n' "$TD" > "$B/seed-1/tests/fixture.ts"
expect "tokens: a file in a tests folder is scanned" 1 '^FAIL: runtime-token-deny hits=1 first=seed-1/tests/fixture.ts:1 pattern=open-task-marker$' -- bash "$TOKENS" --repo-root "$B" --folder seed-1
rm -f "$B/seed-1/tests/fixture.ts"
mkdir -p "$B/seed-1/ui"
printf 'export const t = "value %s";\n' "$U" > "$B/seed-1/ui/strings.ts"
expect "tokens: a new folder in the seed code lane is scanned" 1 '^FAIL: runtime-token-deny hits=1 first=seed-1/ui/strings.ts:1 pattern=undefined$' -- bash "$TOKENS" --repo-root "$B" --folder seed-1
rm -rf "$B/seed-1/ui"
mkdir -p "$B/platform/site/e2e"
printf 'export const note = "%s";\n' "$TD" > "$B/platform/site/e2e/home.spec.ts"
expect "tokens: a site end-to-end spec is scanned" 1 '^FAIL: runtime-token-deny hits=1 first=platform/site/e2e/home.spec.ts:1 pattern=open-task-marker$' -- bash "$TOKENS" --repo-root "$B" --folder platform
rm -rf "$B/platform/site/e2e"
printf 'export const a = 1;\000\n' > "$B/seed-1/render/nul.ts"
expect "tokens: a file with a NUL byte fails as unreadable" 1 '^FAIL: runtime-token-deny hits=1 first=seed-1/render/nul.ts:1 pattern=unreadable$' -- bash "$TOKENS" --repo-root "$B" --folder seed-1
rm -f "$B/seed-1/render/nul.ts"
printf '\377\376{\000}\000' > "$B/seed-1/content/wide.json"
expect "tokens: a UTF-16 file fails as unreadable" 1 '^FAIL: runtime-token-deny hits=1 first=seed-1/content/wide.json:1 pattern=unreadable$' -- bash "$TOKENS" --repo-root "$B" --folder seed-1
rm -f "$B/seed-1/content/wide.json"
mkdir -p "$B/seed-1/dist/assets"
printf '<p>%s</p>\n' "$TD" > "$B/seed-1/dist/index.html"
expect "tokens: built HTML is scanned" 1 '^FAIL: runtime-token-deny hits=1 first=seed-1/dist/index.html:1 pattern=open-task-marker$' -- bash "$TOKENS" --repo-root "$B" --folder seed-1
printf '<p>Dust</p>\n' > "$B/seed-1/dist/index.html"
# The built bundle is read for the unfinished-work markers, whatever folder the text came from.
printf 'const t = "%s";\n' "$TD" > "$B/seed-1/dist/assets/app.js"
expect "tokens: a built bundle is scanned for unfinished-work markers" 1 '^FAIL: runtime-token-deny hits=1 first=seed-1/dist/assets/app.js:1 pattern=open-task-marker$' -- bash "$TOKENS" --repo-root "$B" --folder seed-1
printf 'body::after{content:"%s"}\n' "Lor""em ipsum" > "$B/seed-1/dist/assets/app.css"
expect "tokens: a built stylesheet is scanned" 1 '^FAIL: runtime-token-deny hits=2 first=seed-1/dist/assets/app.css:1 pattern=latin-filler$' -- bash "$TOKENS" --repo-root "$B" --folder seed-1
rm -f "$B/seed-1/dist/assets/app.css"
# Libraries carry the language names and the object-to-string text in their own strings.
printf 'var a=typeof x=="%s"?"%s":String(y)==="%s";throw new %s("%s")\n' "$U" "$N" "[object"" Object]" "Type""Error" "$U" > "$B/seed-1/dist/assets/app.js"
expect "tokens: language names in a built bundle pass" 0 '^PASS: runtime-token-deny files=6$' -- bash "$TOKENS" --repo-root "$B" --folder seed-1
expect "tokens: a dist folder given directly reads every built file" 0 '^PASS: runtime-token-deny files=2$' -- bash "$TOKENS" --repo-root "$B" "$B/seed-1/dist"
printf 'export const Field = () => <input place%s="Name" />;\n' "holder" > "$B/platform/site/src/Field.tsx"
expect "tokens: input hint attribute is a safe context" 0 '^PASS: runtime-token-deny files=3$' -- bash "$TOKENS" --repo-root "$B" --folder platform
printf "export const Note = () => <p>Don't stop</p>; // %s later\n" "$TD" > "$B/platform/site/src/Note.tsx"
expect "tokens: a comment after JSX text with an apostrophe is removed" 0 '^PASS: runtime-token-deny files=4$' -- bash "$TOKENS" --repo-root "$B" --folder platform
printf 'export const Note = () => <p>value is %s</p>;\n' "$U" > "$B/platform/site/src/Note.tsx"
expect "tokens: identifier in JSX text fails" 1 '^FAIL: runtime-token-deny hits=1 first=platform/site/src/Note.tsx:1 pattern=undefined$' -- bash "$TOKENS" --repo-root "$B" --folder platform
printf 'export const List = ({ items }: { items: string[] }) => <ul>{items.map((i) => <li key={i}>{i}</li>)}</ul>; // %s\n' "$N" > "$B/platform/site/src/Note.tsx"
expect "tokens: elements nested inside a JSX expression pass" 0 '^PASS: runtime-token-deny files=4$' -- bash "$TOKENS" --repo-root "$B" --folder platform
rm -f "$B/platform/site/src/Note.tsx"
printf 'Estimate: %s.\n' "TB""D" > "$B/platform/agents/prompts/builder-a.md"
expect "tokens: platform prompt text is scanned" 1 '^FAIL: runtime-token-deny hits=1 first=platform/agents/prompts/builder-a.md:1 pattern=undecided-marker$' -- bash "$TOKENS" --repo-root "$B" --folder platform
expect "tokens: explicit path mode scans one file" 1 '^FAIL: runtime-token-deny hits=1 first=platform/agents/prompts/builder-a.md:1 pattern=undecided-marker$' -- bash "$TOKENS" --repo-root "$B" "$B/platform/agents/prompts/builder-a.md"
printf 'The role edits config files only.\n' > "$B/platform/agents/prompts/builder-a.md"

# ---------------------------------------------------------------- secret-scan.sh
C="$T/c"
mkdir -p "$C"
BODY24=AbCdEfGh12345678IjKlMnOp
printf 'STRIPE_SECRET_KEY=\nclean line\n' > "$C/clean.env"
expect "secrets: clean file passes" 0 '^PASS: secret-scan files=1$' -- bash "$SECRETS" "$C"
expect "secrets: no input is a usage error" 2 '^$' -- bash "$SECRETS"
expect "secrets: missing path is an error" 2 '^FAIL: secret-scan path not found' -- bash "$SECRETS" "$C/none"
shape_cases() {
  printf '%s|%s\n' \
    stripe-secret-key "sk_""live_$BODY24" stripe-test-key "sk_""test_$BODY24" stripe-restricted-key "rk_""live_$BODY24" \
    stripe-publishable-key "pk_""live_$BODY24" stripe-webhook-secret "whsec""_$BODY24" github-token "ghp""_$BODY24" \
    github-fine-grained-token "github_""pat_$BODY24" netlify-token "nfp""_$BODY24" json-web-token "eyJhbGci""Oi$BODY24" \
    anthropic-key "sk-""ant-api03-$BODY24" supabase-secret-key "sb_""secret_$BODY24" openai-key "sk-""proj-$BODY24" \
    google-api-key "AI""za$BODY24$BODY24" openai-key-legacy "sk-""${BODY24}T3Blbk""FJ$BODY24"
}
shape_cases | while IFS='|' read -r name value; do
  printf 'key=%s\n' "$value" > "$C/secret.txt"
  expect "secrets: $name shape fails" 1 "^FAIL: secret-scan hits=1 first=$C/secret.txt:1 shape=$name\$" -- bash "$SECRETS" "$C/secret.txt"
  if printf '%s\n' "$LAST" | grep -q "$BODY24"; then FAILED=$((FAILED + 1)); echo "FAIL secrets: $name value was printed" | tee -a "$LOG"; else PASSED=$((PASSED + 1)); fi
  echo "$PASSED $FAILED" > "$T/counts.txt"
done
read -r PASSED FAILED < "$T/counts.txt"
# The gh command line stores an OAuth token (gho_); GitHub also issues user, server and refresh tokens.
for prefix in gho ghu ghs ghr; do
  printf 'token=%s\n' "$prefix""_$BODY24" > "$C/secret.txt"
  expect "secrets: a GitHub ${prefix}_ token fails as github-token" 1 "^FAIL: secret-scan hits=1 first=$C/secret.txt:1 shape=github-token\$" -- bash "$SECRETS" "$C/secret.txt"
done
printf 'token=%s\n' "gha""_$BODY24" > "$C/secret.txt"
expect "secrets: a prefix GitHub does not issue passes" 0 '^PASS: secret-scan' -- bash "$SECRETS" "$C/secret.txt"
# The key block's first line is assembled here, so no tracked file carries it.
for kind in "RSA " "OPENSSH " "EC " ""; do
  printf '%s\n' "-----BEGIN ""${kind}PRIVATE KEY-----" "MIIEowIBAAKCAQEA" "-----END ""${kind}PRIVATE KEY-----" > "$C/key.pem"
  expect "secrets: a ${kind:-PKCS8 }private key block fails" 1 "^FAIL: secret-scan hits=1 first=$C/key.pem:1 shape=private-key\$" -- bash "$SECRETS" "$C/key.pem"
done
printf 'A key file starts with a BEGIN line naming a PRIVATE KEY.\n' > "$C/key.pem"
expect "secrets: prose about a key block passes" 0 '^PASS: secret-scan' -- bash "$SECRETS" "$C/key.pem"
rm -f "$C/key.pem"
printf 'token\000\n' > "$C/blob.dat"
expect "secrets: a file with a NUL byte fails as unreadable" 1 "^FAIL: secret-scan hits=1 first=$C/blob.dat:1 shape=unreadable\$" -- bash "$SECRETS" "$C/blob.dat"
printf '\377\376k\000e\000y\000' > "$C/blob.dat"
expect "secrets: a UTF-16 file fails as unreadable" 1 "^FAIL: secret-scan hits=1 first=$C/blob.dat:1 shape=unreadable\$" -- bash "$SECRETS" "$C/blob.dat"
rm -f "$C/blob.dat"
printf 'prefix only: %s\n' "sk_""live_abc" > "$C/secret.txt"
expect "secrets: a bare prefix is not a key" 0 '^PASS: secret-scan' -- bash "$SECRETS" "$C/secret.txt"
printf 'key=%s\n' "sb_""publishable_$BODY24" > "$C/secret.txt"
expect "secrets: a Supabase publishable key is public and passes" 0 '^PASS: secret-scan' -- bash "$SECRETS" "$C/secret.txt"
rm -f "$C/secret.txt"
mkdir -p "$T/served"
for name in icon.svg app.js.map app.min.js app.min.css; do
  printf 'token=%s\n' "ghp""_$BODY24" > "$T/served/$name"
  expect "secrets: a token in $name fails" 1 "^FAIL: secret-scan hits=1 first=$T/served/$name:1 shape=github-token\$" -- bash "$SECRETS" "$T/served/$name"
  rm -f "$T/served/$name"
done
printf 'token=%s\n' "ghp""_$BODY24" > "$T/served/icon.png"
expect "secrets: binary media is skipped" 0 '^PASS: secret-scan files=0$' -- bash "$SECRETS" "$T/served/icon.png"
rm -rf "$T/served"
git -C "$C" init -q && git -C "$C" add -A && git -C "$C" commit -q -m "clean"
expect "secrets: tracked scan of a clean repository passes" 0 '^PASS: secret-scan files=1$' -- bash "$SECRETS" --repo-root "$C" --tracked
printf 'token=%s\n' "ghp""_$BODY24" > "$C/untracked.txt"
expect "secrets: untracked files are outside --tracked" 0 '^PASS: secret-scan files=1$' -- bash "$SECRETS" --repo-root "$C" --tracked
expect "secrets: untracked files are inside --working-tree" 1 '^FAIL: secret-scan hits=1 first=untracked.txt:1 shape=github-token$' -- bash "$SECRETS" --repo-root "$C" --working-tree
git -C "$C" add -A && git -C "$C" commit -q -m "with token"
expect "secrets: tracked scan finds a committed token" 1 '^FAIL: secret-scan hits=1 first=untracked.txt:1 shape=github-token$' -- bash "$SECRETS" --repo-root "$C" --tracked
expect "secrets: gate folder is clean" 0 '^PASS: secret-scan' -- bash "$SECRETS" "$GATE_DIR"

# ---------------------------------------------------------------- changed-paths.sh
D="$T/d"
mkdir -p "$D/seed-1/config" "$D/seed-1/sim" "$D/platform/site" "$D/docs"
git -C "$D" init -q -b main
printf '{}\n' > "$D/seed-1/config/spawn-table.json"; printf 'x\n' > "$D/seed-1/sim/a.ts"; printf 'y\n' > "$D/platform/site/a.ts"; printf 'z\n' > "$D/README.md"
git -C "$D" add -A && git -C "$D" commit -q -m "base"
C0=$(git -C "$D" rev-parse HEAD)
printf '{"rows":[]}\n' > "$D/seed-1/config/spawn-table.json"; git -C "$D" commit -q -am "config"; C1=$(git -C "$D" rev-parse HEAD)
printf 'x2\n' > "$D/seed-1/sim/a.ts"; git -C "$D" commit -q -am "code"; C2=$(git -C "$D" rev-parse HEAD)
printf 'y2\n' > "$D/platform/site/a.ts"; git -C "$D" commit -q -am "platform"; C3=$(git -C "$D" rev-parse HEAD)
printf 'z2\n' > "$D/README.md"; git -C "$D" commit -q -am "root"; C4=$(git -C "$D" rev-parse HEAD)
expect "changed: usage without refs" 2 '^$' -- bash "$CHANGED"
expect "changed: config-only change is the config lane" 0 '^seed=true platform=false lane=config site=false functions=false$' -- bash "$CHANGED" --repo-root "$D" "$C0" "$C1"
expect "changed: seed code change is the code lane" 0 '^seed=true platform=false lane=code site=false functions=false$' -- bash "$CHANGED" --repo-root "$D" "$C1" "$C2"
expect "changed: a site change selects the site steps and not the functions tests" 0 '^seed=false platform=true lane=code site=true functions=false$' -- bash "$CHANGED" --repo-root "$D" "$C2" "$C3"
expect "changed: root change touches both folders and every step" 0 '^seed=true platform=true lane=code site=true functions=true$' -- bash "$CHANGED" --repo-root "$D" "$C3" "$C4"
expect "changed: range spanning config and code is the code lane" 0 '^seed=true platform=true lane=code site=true functions=true$' -- bash "$CHANGED" --repo-root "$D" "$C0" "$C4"
expect "changed: identical refs change nothing" 0 '^seed=false platform=false lane=code site=false functions=false$' -- bash "$CHANGED" --repo-root "$D" "$C4" "$C4"
expect "changed: zero base counts every file" 0 '^seed=true platform=true lane=code site=true functions=true$' -- bash "$CHANGED" --repo-root "$D" 0000000000000000000000000000000000000000 "$C1"
expect "changed: --list prints the files" 0 '^seed-1/config/spawn-table.json$' -- bash "$CHANGED" --repo-root "$D" --list "$C0" "$C1"
expect "changed: unknown head ref is an error" 2 '^$' -- bash "$CHANGED" --repo-root "$D" "$C0" not-a-ref
git -C "$D" checkout -q -b card/abcd1234-config "$C0"
printf '{"rows":[{"id":"cart"}]}\n' > "$D/seed-1/config/spawn-table.json"; git -C "$D" commit -q -am "branch config"; C5=$(git -C "$D" rev-parse HEAD)
expect "changed: branch diff uses the merge base, not main's later commits" 0 '^seed=true platform=false lane=config site=false functions=false$' -- bash "$CHANGED" --repo-root "$D" "$C4" "$C5"
# A rename lists both names, so a kernel file moved into a config folder is still seen, and the
# change is the code lane. The repository's own rename settings do not change that.
git -C "$D" checkout -q main
mkdir -p "$D/seed-1/tests" "$D/seed-1/content"
printf 'export const invariants = [];\n' > "$D/seed-1/tests/invariants.test.ts"; git -C "$D" add -A; git -C "$D" commit -q -m "invariants"; C6=$(git -C "$D" rev-parse HEAD)
git -C "$D" config diff.renames copies
git -C "$D" mv seed-1/tests/invariants.test.ts seed-1/content/x.json; git -C "$D" commit -q -m "rename"; C7=$(git -C "$D" rev-parse HEAD)
bash "$CHANGED" --repo-root "$D" --list "$C6" "$C7" > "$T/renamed.txt"
assert "changed: a rename lists both names" test "$(cat "$T/renamed.txt")" = "seed-1/content/x.json
seed-1/tests/invariants.test.ts"
expect "changed: a kernel file renamed into content is the code lane" 0 '^seed=true platform=false lane=code site=false functions=false$' -- bash "$CHANGED" --repo-root "$D" "$C6" "$C7"
expect "changed: kernel-guard fails the old name of a renamed kernel file" 1 '^FAIL: kernel-guard path=seed-1/tests/invariants.test.ts$' -- bash "$GATE_DIR/kernel-guard.sh" "$T/renamed.txt"
# The config lane holds .json files only, and a card branch stays inside one card folder.
git -C "$D" checkout -q -b lane-page "$C0"
mkdir -p "$D/seed-1/content"
printf '<p>x</p>\n' > "$D/seed-1/content/page.html"; git -C "$D" add -A; git -C "$D" commit -q -m "page"; C8=$(git -C "$D" rev-parse HEAD)
expect "changed: a non-JSON file in content is the code lane" 0 '^seed=true platform=false lane=code site=false functions=false$' -- bash "$CHANGED" --repo-root "$D" "$C0" "$C8"
expect "lane: a non-JSON file on a config branch fails" 1 '^FAIL: lane-check path=seed-1/content/page.html rule=config-json-only$' -- bash "$CHANGED" --repo-root "$D" --check-lane card/abcd1234-config "$C0" "$C8"
expect "lane: the same file on a code branch passes" 0 '^PASS: lane-check files=1 lane=code$' -- bash "$CHANGED" --repo-root "$D" --check-lane card/abcd1234-code "$C0" "$C8"
expect "lane: JSON under config passes on a config branch" 0 '^PASS: lane-check files=1 lane=config$' -- bash "$CHANGED" --repo-root "$D" --check-lane card/abcd1234-config "$C0" "$C1"
expect "lane: a seed code change fails on a config branch" 1 '^FAIL: lane-check path=seed-1/sim/a.ts rule=config-json-only$' -- bash "$CHANGED" --repo-root "$D" --check-lane card/abcd1234-config "$C1" "$C2"
# The platform code lane can open now that the board has its own site: platform/site is a card folder
# on a code branch. studio_state.platform_lane_open decides when a platform card runs at all.
expect "lane: a platform/site change passes on a code branch" 0 '^PASS: lane-check files=1 lane=code$' -- bash "$CHANGED" --repo-root "$D" --check-lane card/abcd1234-code "$C2" "$C3"
expect "lane: a platform/site change fails on a config branch" 1 '^FAIL: lane-check path=platform/site/a.ts rule=config-json-only$' -- bash "$CHANGED" --repo-root "$D" --check-lane card/abcd1234-config "$C2" "$C3"
expect "lane: one branch never changes both card folders" 1 '^FAIL: lane-check path=seed-1/sim/a.ts rule=one-folder$' -- bash "$CHANGED" --repo-root "$D" --check-lane card/abcd1234-code "$C1" "$C3"
expect "lane: a root file fails on a card branch" 1 '^FAIL: lane-check path=README.md rule=card-folders$' -- bash "$CHANGED" --repo-root "$D" --check-lane card/abcd1234-code "$C3" "$C4"
expect "lane: a branch that names no lane fails" 1 '^FAIL: lane-check branch=card/abcd1234 rule=branch-name$' -- bash "$CHANGED" --repo-root "$D" --check-lane card/abcd1234 "$C0" "$C1"
expect "lane: --check-lane needs a branch and two refs" 2 '^$' -- bash "$CHANGED" --repo-root "$D" --check-lane card/abcd1234-code "$C0"
git -C "$D" checkout -q main
# The board's own site is never a card folder, and a change to it selects the site steps.
git -C "$D" checkout -q -b lane-board "$C0"
mkdir -p "$D/platform/board" "$D/platform/dispatcher"
printf 'b\n' > "$D/platform/board/a.ts"; git -C "$D" add -A; git -C "$D" commit -q -m "board"; C9=$(git -C "$D" rev-parse HEAD)
printf 'd\n' > "$D/platform/dispatcher/a.ts"; git -C "$D" add -A; git -C "$D" commit -q -m "dispatcher"; C10=$(git -C "$D" rev-parse HEAD)
expect "lane: the board's site is never a card folder" 1 '^FAIL: lane-check path=platform/board/a.ts rule=card-folders$' -- bash "$CHANGED" --repo-root "$D" --check-lane card/abcd1234-code "$C0" "$C9"
expect "lane: another platform folder is never a card folder" 1 '^FAIL: lane-check path=platform/dispatcher/a.ts rule=card-folders$' -- bash "$CHANGED" --repo-root "$D" --check-lane card/abcd1234-code "$C9" "$C10"
expect "changed: a board site change selects the site steps and not the functions tests" 0 '^seed=false platform=true lane=code site=true functions=false$' -- bash "$CHANGED" --repo-root "$D" "$C0" "$C9"
git -C "$D" checkout -q main

# Which of the platform job's slower steps a change selects (docs/specs/scale-launch.md). Each
# commit changes one file on top of $C4, so each range holds exactly that file.
scope_of() {
  local file=$1 base
  git -C "$D" checkout -q "$C4"
  mkdir -p "$D/$(dirname "$file")"
  printf 'scope %s\n' "$file" >> "$D/$file"
  git -C "$D" add -A && git -C "$D" commit -q -m "scope $file"
  base=$C4
  bash "$CHANGED" --repo-root "$D" "$base" "$(git -C "$D" rev-parse HEAD)"
}
for pair in \
  'docs/PLAN.md seed=false platform=true lane=code site=false functions=false' \
  'platform/dispatcher/src/tick.ts seed=false platform=true lane=code site=false functions=false' \
  'platform/ops/deploy.sh seed=false platform=true lane=code site=false functions=false' \
  'platform/supabase/migrations/x.sql seed=false platform=true lane=code site=false functions=true' \
  'platform/agents/builder-a.json seed=false platform=true lane=code site=true functions=false' \
  'platform/site/src/App.tsx seed=false platform=true lane=code site=true functions=false' \
  'platform/gate/ship-gate.sh seed=false platform=true lane=code site=true functions=true' \
  'platform/board/src/main.tsx seed=false platform=true lane=code site=true functions=false' \
  'platform/newfolder/src/main.tsx seed=false platform=true lane=code site=true functions=true' \
  '.github/workflows/gate.yml seed=true platform=true lane=code site=true functions=true' \
  'pnpm-lock.yaml seed=true platform=true lane=code site=true functions=true' \
  'seed-1/sim/b.ts seed=true platform=false lane=code site=false functions=false'; do
  file=${pair%% *}
  want=${pair#* }
  assert "changed: $file gives $want" test "$(scope_of "$file")" = "$want"
done
git -C "$D" checkout -q main

# ---------------------------------------------------------------- headless-bot/run.mjs and ship-gate.sh
W="$T/w"
mkdir -p "$W/seed-1/config" "$W/seed-1/content" "$W/seed-1/sim" "$W/platform/dispatcher" "$W/platform/supabase" "$W/platform/site/src"
printf '{"name":"gate-test-workspace","private":true}\n' > "$W/package.json"
printf 'packages:\n  - seed-1\n  - platform/*\n' > "$W/pnpm-workspace.yaml"
printf 'node_modules/\ndist/\n' > "$W/.gitignore"
cat > "$W/build.js" <<'EOF_BUILD'
// A substitute for a package build: writes dist/index.html and one asset the way the seed and site
// builds do. GATE_TEST_BUILD_TEXT replaces the page text, and a Payment Link in the build's
// environment becomes a link on the page, as the site's Contribute button is.
const fs = require('node:fs');
fs.mkdirSync('dist/assets', { recursive: true });
const link = process.env.VITE_STRIPE_PAYMENT_LINK_URL ? `<a href="${process.env.VITE_STRIPE_PAYMENT_LINK_URL}">Contribute</a>` : '';
fs.writeFileSync('dist/index.html', `<p>${process.env.GATE_TEST_BUILD_TEXT || 'Dust'}</p>${link}\n`);
fs.writeFileSync('dist/assets/app.js', 'export {};\n');
EOF_BUILD
SEED_BUILD="node ../build.js"
SITE_BUILD="node ../../build.js"
# A substitute for the seed bot command line under seed-1/bots, a kernel path, as the real one is:
# same flags, same report shape, no simulation. GATE_TEST_BOT_FAIL fails an invariant,
# GATE_TEST_BOT_STRAY prints a pass line of the runner's own shape first, and GATE_TEST_BOT_FORGE
# names a file the bot writes a pass line to, as card code that learned the report path could.
mkdir -p "$W/seed-1/bots"
cat > "$W/seed-1/bots/report.js" <<'EOF_REPORT'
// The report the bot prints: every invariant must hold for ok.
module.exports = function report(hours, seed, failing) {
  return {
    ok: !failing,
    simulatedSeconds: hours * 3600,
    invariants: [{ name: 'no-negative-resource', ok: !failing, detail: failing ? 'dust fell below zero at 12 s' : 'dust never fell below zero' }],
    unlocks: [{ id: 'cart', atSeconds: 90 }],
    finalTotalDust: hours * 100,
    stateHash: 'seed-' + seed,
  };
};
EOF_REPORT
cat > "$W/seed-1/bots/cli.js" <<'EOF_BOT'
const report = require('./report.js');
const argv = process.argv.slice(2).filter((a) => a !== '--');
const get = (flag) => argv[argv.indexOf(flag) + 1];
const result = report(Number(get('--hours')), get('--seed'), process.env.GATE_TEST_BOT_FAIL === '1');
if (process.env.GATE_TEST_BOT_STRAY === '1') process.stdout.write('PASS: headless-bot simulatedSeconds=1 unlocks=1 finalTotalDust=1 stateHash=x\n');
if (process.env.GATE_TEST_BOT_FORGE) require('node:fs').writeFileSync(process.env.GATE_TEST_BOT_FORGE, 'PASS: headless-bot forged\n');
process.stdout.write(JSON.stringify(result) + '\n');
process.exitCode = result.ok ? 0 : 1;
EOF_BOT
write_package() {
  # $1 folder, $2 name, $3 typecheck command, $4 test command, $5 build command, $6 bot command
  printf '{"name":"%s","private":true,"scripts":{"typecheck":"%s","test":"%s","build":"%s"%s}}\n' "$2" "$3" "$4" "$5" "${6:+,\"bot\":\"$6\"}" > "$1/package.json"
}
SEED_BOT="node bots/cli.js"
write_package "$W/seed-1" @backseat/seed-1 true true "$SEED_BUILD" "$SEED_BOT"
write_package "$W/platform/dispatcher" @backseat/dispatcher true true true
write_package "$W/platform/supabase" @backseat/supabase true true true
write_package "$W/platform/site" @backseat/site true true "$SITE_BUILD"
mkdir -p "$W/platform/board"
write_package "$W/platform/board" @backseat/board true true "$SITE_BUILD"
# The site's public build values, as in platform/site/netlify.toml: the build runs with them and the
# payment-host scan allows this one Payment Link.
printf '[build.environment]\n  NODE_VERSION = "22"\n  VITE_STRIPE_PAYMENT_LINK_URL = "https://buy.stripe.com/gate_test_link"\n' > "$W/platform/site/netlify.toml"
printf '{"rows":[{"id":"gatherer","name":"Gatherer","baseCost":10,"rate":0.2}]}\n' > "$W/seed-1/config/spawn-table.json"
printf '{"unlocks":[]}\n' > "$W/seed-1/config/unlocks.json"
printf '{"title":"Dust"}\n' > "$W/seed-1/content/strings.json"
printf 'export const rate = 1;\n' > "$W/seed-1/sim/index.ts"
printf 'export const title = "Untitled Game Studio";\n' > "$W/platform/site/src/copy.ts"
git -C "$W" init -q -b main && git -C "$W" add -A && git -C "$W" commit -q -m "card 1234abcd: raise the cart rate"

expect "bot: usage without flags" 2 '^$' -- node "$BOT"
expect "bot: missing config folder is a usage error" 2 '^$' -- node "$BOT" --repo-root "$W" --config-dir "$W/none" --hours 1 --seed 1
expect "bot: passing report" 0 '^PASS: headless-bot simulatedSeconds=36000 unlocks=1 finalTotalDust=1000 stateHash=seed-20260914$' -- node "$BOT" --repo-root "$W" --config-dir "$W/seed-1/config" --hours 10 --seed 20260914
expect "bot: real-seconds flag is accepted" 0 '^PASS: headless-bot simulatedSeconds=3600 ' -- node "$BOT" --repo-root "$W" --config-dir "$W/seed-1/config" --hours 1 --seed 7 --real-seconds 60
expect "bot: failing invariant fails" 1 '^FAIL: headless-bot exit=1 ok=false failed=1$' -- env GATE_TEST_BOT_FAIL=1 node "$BOT" --repo-root "$W" --config-dir "$W/seed-1/config" --hours 1 --seed 7
assert "bot: failing invariant is named" test "$(printf '%s\n' "$LAST" | sed -n 2p)" = "invariant no-negative-resource: dust fell below zero at 12 s"
expect "bot: a stray pass line from a failing bot does not pass" 1 '^FAIL: headless-bot exit=1 ok=false failed=1$' -- env GATE_TEST_BOT_FAIL=1 GATE_TEST_BOT_STRAY=1 node "$BOT" --repo-root "$W" --config-dir "$W/seed-1/config" --hours 1 --seed 7
# --report-file: the verdict goes to a new file named per run; a file that already exists, before
# or during the run, fails.
REPORT="$T/bot-report-$(gate_nonce).txt"
expect "bot: --report-file writes the verdict" 0 '^PASS: headless-bot simulatedSeconds=3600 ' -- node "$BOT" --repo-root "$W" --config-dir "$W/seed-1/config" --hours 1 --seed 7 --report-file "$REPORT"
assert "bot: the report file holds the pass line" test "$(head -n 1 "$REPORT")" = "$(printf '%s\n' "$LAST" | head -n 1)"
expect "bot: a report file that already exists is a usage error" 2 '^$' -- node "$BOT" --repo-root "$W" --config-dir "$W/seed-1/config" --hours 1 --seed 7 --report-file "$REPORT"
rm -f "$REPORT"
expect "bot: a report file in a missing folder is a usage error" 2 '^$' -- node "$BOT" --repo-root "$W" --config-dir "$W/seed-1/config" --hours 1 --seed 7 --report-file "$T/none/report.txt"
expect "bot: a failing bot writes its FAIL line to the report file" 1 '^FAIL: headless-bot exit=1 ok=false failed=1$' -- env GATE_TEST_BOT_FAIL=1 node "$BOT" --repo-root "$W" --config-dir "$W/seed-1/config" --hours 1 --seed 7 --report-file "$REPORT"
assert "bot: the report file holds the FAIL line" test "$(head -n 1 "$REPORT")" = "FAIL: headless-bot exit=1 ok=false failed=1"
rm -f "$REPORT"
expect "bot: a report file the bot wrote itself fails the run" 1 '^FAIL: headless-bot could not write the report file: another process created it during the run$' -- env GATE_TEST_BOT_FORGE="$REPORT" node "$BOT" --repo-root "$W" --config-dir "$W/seed-1/config" --hours 1 --seed 7 --report-file "$REPORT"
rm -f "$REPORT"

expect "ship: usage without folder" 2 '^$' -- bash "$SHIP"
expect "ship: usage for an unknown folder" 2 '^$' -- bash "$SHIP" --folder docs
expect "ship: usage for the platform config lane" 2 '^$' -- bash "$SHIP" --folder platform --lane config
expect "ship: seed config lane passes" 0 '^GATE PASS folder=seed-1 lane=config$' -- bash "$SHIP" --repo-root "$W" --folder seed-1 --lane config --dry-run
assert "ship: stdout carries one line" test "$(printf '%s\n' "$LAST" | wc -l | tr -d ' ')" = 1
expect "ship: seed code lane passes" 0 '^GATE PASS folder=seed-1 lane=code$' -- bash "$SHIP" --repo-root "$W" --folder seed-1 --lane code --dry-run
expect "ship: platform passes" 0 '^GATE PASS folder=platform lane=code$' -- bash "$SHIP" --repo-root "$W" --folder platform --dry-run
expect "ship: tracked mode passes on a committed clean tree" 0 '^GATE PASS folder=seed-1 lane=config$' -- bash "$SHIP" --repo-root "$W" --folder seed-1 --lane config
expect "ship: missing commit message file is a usage error" 2 '^$' -- bash "$SHIP" --repo-root "$W" --folder seed-1 --lane config --dry-run --commit-message-file "$T/none.txt"
expect "ship: missing changed files list is a usage error" 2 '^$' -- bash "$SHIP" --repo-root "$W" --folder seed-1 --lane config --dry-run --changed-files-file "$T/none.txt"
printf 'Dust and %s.\n' "$P1" > "$W/README.md"
expect "ship: deny-listed term in a root file fails" 1 '^GATE FAIL step=banned-phrases detail=FAIL: banned-phrases hits=1 first=README.md:1 list=profanity' -- bash "$SHIP" --repo-root "$W" --folder seed-1 --lane config --dry-run
rm -f "$W/README.md"
expect "ship: runtime token in the build output fails after the build" 1 '^GATE FAIL step=runtime-token-deny-dist detail=FAIL: runtime-token-deny hits=1 first=seed-1/dist/index.html:1 pattern=open-task-marker$' -- env GATE_TEST_BUILD_TEXT="$TD" bash "$SHIP" --repo-root "$W" --folder seed-1 --lane config --dry-run
rm -rf "$W/seed-1/dist"
expect "ship: runtime token in the site build output fails after the build" 1 '^GATE FAIL step=runtime-token-deny-dist detail=FAIL: runtime-token-deny hits=1 first=platform/site/dist/index.html:1 pattern=open-task-marker$' -- env GATE_TEST_BUILD_TEXT="$TD" bash "$SHIP" --repo-root "$W" --folder platform --dry-run
rm -rf "$W/platform/site/dist"
printf 'token=%s\n' "nfp""_$BODY24" > "$W/seed-1/notes.txt"
expect "ship: secret in the working tree fails the first step" 1 '^GATE FAIL step=secret-scan detail=FAIL: secret-scan hits=1 first=seed-1/notes.txt:1 shape=netlify-token$' -- bash "$SHIP" --repo-root "$W" --folder seed-1 --lane config --dry-run
rm -f "$W/seed-1/notes.txt"
printf '{"title":"%s"}\n' "$P1" > "$W/seed-1/content/strings.json"
expect "ship: deny-listed term fails the banned-phrases step" 1 '^GATE FAIL step=banned-phrases detail=FAIL: banned-phrases hits=1 first=seed-1/content/strings.json:1 list=profanity' -- bash "$SHIP" --repo-root "$W" --folder seed-1 --lane config --dry-run
printf '{"title":"Dust"}\n' > "$W/seed-1/content/strings.json"
printf 'card 1234abcd: add the %s unit\n' "$P1" > "$T/message.txt"
expect "ship: deny-listed commit message fails" 1 '^GATE FAIL step=banned-phrases detail=FAIL: banned-phrases hits=1 first=commit-message:1' -- bash "$SHIP" --repo-root "$W" --folder seed-1 --lane config --dry-run --commit-message-file "$T/message.txt"
printf '{"title":"%s"}\n' "$TD" > "$W/seed-1/content/strings.json"
expect "ship: runtime token fails the third step" 1 '^GATE FAIL step=runtime-token-deny detail=FAIL: runtime-token-deny hits=1 first=seed-1/content/strings.json:1 pattern=open-task-marker$' -- bash "$SHIP" --repo-root "$W" --folder seed-1 --lane config --dry-run
printf '{"title":"Dust"}\n' > "$W/seed-1/content/strings.json"
expect "ship: failing bot fails the bot step" 1 '^GATE FAIL step=bot detail=FAIL: headless-bot exit=1 ok=false failed=1$' -- env GATE_TEST_BOT_FAIL=1 bash "$SHIP" --repo-root "$W" --folder seed-1 --lane config --dry-run
write_package "$W/seed-1" @backseat/seed-1 "exit 1" true "$SEED_BUILD" "$SEED_BOT"
expect "ship: failing typecheck fails the code lane" 1 '^GATE FAIL step=typecheck detail=@backseat/seed-1: exit 1$' -- bash "$SHIP" --repo-root "$W" --folder seed-1 --lane code --dry-run
expect "ship: config lane skips typecheck" 0 '^GATE PASS folder=seed-1 lane=config$' -- bash "$SHIP" --repo-root "$W" --folder seed-1 --lane config --dry-run
write_package "$W/seed-1" @backseat/seed-1 true "exit 1" "$SEED_BUILD" "$SEED_BOT"
expect "ship: failing tests fail the code lane" 1 '^GATE FAIL step=tests detail=@backseat/seed-1: exit 1$' -- bash "$SHIP" --repo-root "$W" --folder seed-1 --lane code --dry-run
# Every step that runs no card code comes first: the build and its scan before the tests, and the
# tests before the bot.
expect "ship: the build and its scan run before the tests" 1 '^GATE FAIL step=runtime-token-deny-dist detail=FAIL: runtime-token-deny hits=1 first=seed-1/dist/index.html:1 pattern=open-task-marker$' -- env GATE_TEST_BUILD_TEXT="$TD" bash "$SHIP" --repo-root "$W" --folder seed-1 --lane code --dry-run
rm -rf "$W/seed-1/dist"
expect "ship: the tests run before the bot" 1 '^GATE FAIL step=tests detail=@backseat/seed-1: exit 1$' -- env GATE_TEST_BOT_FAIL=1 bash "$SHIP" --repo-root "$W" --folder seed-1 --lane code --dry-run
rm -rf "$W/seed-1/dist"
# The phases the workflow runs one at a time.
expect "ship: the scans phase runs the scans alone" 0 '^GATE PASS folder=seed-1 lane=code phase=scans$' -- env GATE_TEST_BOT_FAIL=1 bash "$SHIP" --repo-root "$W" --folder seed-1 --lane code --phase scans --dry-run
assert "ship: the scans phase builds nothing" test ! -e "$W/seed-1/dist"
expect "ship: the build phase builds and scans the build alone" 0 '^GATE PASS folder=seed-1 lane=code phase=build$' -- env GATE_TEST_BOT_FAIL=1 bash "$SHIP" --repo-root "$W" --folder seed-1 --lane code --phase build --dry-run
assert "ship: the build phase wrote the build" test -f "$W/seed-1/dist/index.html"
rm -rf "$W/seed-1/dist"
expect "ship: the build phase fails on a token in the build" 1 '^GATE FAIL step=runtime-token-deny-dist ' -- env GATE_TEST_BUILD_TEXT="$TD" bash "$SHIP" --repo-root "$W" --folder seed-1 --lane config --phase build --dry-run
rm -rf "$W/seed-1/dist"
expect "ship: the checks phase runs typecheck and tests" 1 '^GATE FAIL step=tests detail=@backseat/seed-1: exit 1$' -- bash "$SHIP" --repo-root "$W" --folder seed-1 --lane code --phase checks --dry-run
assert "ship: the checks phase builds nothing" test ! -e "$W/seed-1/dist"
expect "ship: the bot phase fails a failing bot" 1 '^GATE FAIL step=bot detail=FAIL: headless-bot exit=1 ok=false failed=1$' -- env GATE_TEST_BOT_FAIL=1 bash "$SHIP" --repo-root "$W" --folder seed-1 --lane code --phase bot --dry-run
expect "ship: the bot phase passes a passing bot" 0 '^GATE PASS folder=seed-1 lane=code phase=bot$' -- bash "$SHIP" --repo-root "$W" --folder seed-1 --lane code --phase bot --dry-run
expect "ship: the platform folder has no bot phase" 2 '^$' -- bash "$SHIP" --repo-root "$W" --folder platform --phase bot
expect "ship: the seed config lane has no checks phase" 2 '^$' -- bash "$SHIP" --repo-root "$W" --folder seed-1 --lane config --phase checks
expect "ship: an unknown phase is a usage error" 2 '^$' -- bash "$SHIP" --repo-root "$W" --folder seed-1 --phase deploy
write_package "$W/seed-1" @backseat/seed-1 true true "exit 3" "$SEED_BOT"
expect "ship: failing build fails the build step" 1 '^GATE FAIL step=build detail=@backseat/seed-1: exit 3$' -- bash "$SHIP" --repo-root "$W" --folder seed-1 --lane config --dry-run
write_package "$W/seed-1" @backseat/seed-1 true true "$SEED_BUILD" "$SEED_BOT"
write_package "$W/platform/site" @backseat/site true "exit 1" "$SITE_BUILD"
expect "ship: platform test failure names the package" 1 '^GATE FAIL step=tests detail=@backseat/site: exit 1$' -- bash "$SHIP" --repo-root "$W" --folder platform --dry-run
expect "ship: the site build and its scan run before the platform tests" 1 '^GATE FAIL step=runtime-token-deny-dist detail=FAIL: runtime-token-deny hits=1 first=platform/site/dist/index.html:1 pattern=open-task-marker$' -- env GATE_TEST_BUILD_TEXT="$TD" bash "$SHIP" --repo-root "$W" --folder platform --dry-run
rm -rf "$W/platform/site/dist"
expect "ship: the platform checks phase runs the package tests" 1 '^GATE FAIL step=tests detail=@backseat/site: exit 1$' -- bash "$SHIP" --repo-root "$W" --folder platform --phase checks --dry-run
rm -f "$W/platform/site/package.json"
expect "ship: absent package is a failure, not a pass" 1 '^GATE FAIL step=build detail=@backseat/site is not in the workspace$' -- bash "$SHIP" --repo-root "$W" --folder platform --dry-run
write_package "$W/platform/site" @backseat/site true true "$SITE_BUILD"
# The board's own site is built and its tests run with the platform folder.
write_package "$W/platform/board" @backseat/board true "exit 1" "$SITE_BUILD"
expect "ship: platform test failure names the board package" 1 '^GATE FAIL step=tests detail=@backseat/board: exit 1$' -- bash "$SHIP" --repo-root "$W" --folder platform --dry-run
write_package "$W/platform/board" @backseat/board true true "exit 4"
expect "ship: a failing board build fails the build step" 1 '^GATE FAIL step=build detail=@backseat/board: exit 4$' -- bash "$SHIP" --repo-root "$W" --folder platform --phase build --dry-run
write_package "$W/platform/board" @backseat/board true true "$SITE_BUILD"
rm -rf "$W/platform/site/dist" "$W/platform/board/dist"
# The payment-host scan (docs/specs/board-site.md): the site is built with its netlify.toml values,
# so the configured Payment Link is in the build and allowed; any other payment address fails, and
# the game's build may carry none at all.
expect "ship: the site builds with its Payment Link and the scan allows it" 0 '^GATE PASS folder=platform lane=code phase=build$' -- bash "$SHIP" --repo-root "$W" --folder platform --phase build --dry-run
assert "ship: the site build carries the configured Payment Link" grep -q 'href="https://buy.stripe.com/gate_test_link"' "$W/platform/site/dist/index.html"
assert "ship: the board build carries no Payment Link" test "$(grep -c 'buy.stripe.com' "$W/platform/board/dist/index.html")" = 0
expect "ship: another payment address in the site build fails the scan" 1 '^GATE FAIL step=payment-host-scan detail=FAIL: payment-host-scan path=.*platform/site/dist/index.html address=https://www.paypal.com/donate$' -- env GATE_TEST_BUILD_TEXT='Give at https://www.paypal.com/donate today' bash "$SHIP" --repo-root "$W" --folder platform --phase build --dry-run
expect "ship: a Stripe link with percent-encoded dots in the site build fails the scan" 1 '^GATE FAIL step=payment-host-scan detail=FAIL: payment-host-scan path=.*platform/site/dist/index.html address=https://buy.stripe.com/test_evil$' -- env GATE_TEST_BUILD_TEXT='<a href="https://buy%2Estripe%2Ecom/test_evil">' bash "$SHIP" --repo-root "$W" --folder platform --phase build --dry-run
expect "ship: a second Stripe link in the site build fails the scan" 1 '^GATE FAIL step=payment-host-scan detail=FAIL: payment-host-scan path=.*platform/site/dist/index.html address=https://buy.stripe.com/other_link$' -- env GATE_TEST_BUILD_TEXT='https://buy.stripe.com/other_link' bash "$SHIP" --repo-root "$W" --folder platform --dry-run
expect "ship: any payment address in the game's build fails the scan" 1 '^GATE FAIL step=payment-host-scan detail=FAIL: payment-host-scan path=.*seed-1/dist/index.html address=https://buy.stripe.com/gate_test_link$' -- env GATE_TEST_BUILD_TEXT='https://buy.stripe.com/gate_test_link' bash "$SHIP" --repo-root "$W" --folder seed-1 --lane config --dry-run
rm -rf "$W/platform/site/dist" "$W/platform/board/dist" "$W/seed-1/dist"
mv "$W/platform/site/netlify.toml" "$T/site-netlify.toml"
expect "ship: a site with no configured Payment Link fails the scan closed" 1 '^GATE FAIL step=payment-host-scan detail=FAIL: payment-host-scan usage: ' -- bash "$SHIP" --repo-root "$W" --folder platform --phase build --dry-run
mv "$T/site-netlify.toml" "$W/platform/site/netlify.toml"
rm -rf "$W/platform/site/dist" "$W/platform/board/dist"

# ---------------------------------------------------------------- payment-host-scan.mjs
PAY="$GATE_DIR/payment-host-scan.mjs"
PD="$T/pay"
mkdir -p "$PD/dist/assets" "$PD/other"
printf '[build.environment]\n  VITE_STRIPE_PAYMENT_LINK_URL = "https://buy.stripe.com/abc123"\n' > "$PD/netlify.toml"
printf '[build.environment]\n  VITE_STRIPE_PAYMENT_LINK_URL = "https://evil.example/pay"\n' > "$PD/bad.toml"
printf 'const a="https://buy.stripe.com/abc123";\n' > "$PD/dist/assets/app.js"
printf '\211PNG buy.stripe.com/zzz\n' > "$PD/dist/assets/image.png"
expect "pay: the configured link alone passes" 0 '^PASS: payment-host-scan files=1 allowed=1$' -- node "$PAY" --allow-from "$PD/netlify.toml" "$PD/dist"
expect "pay: --allow names the link directly" 0 '^PASS: payment-host-scan files=1 allowed=1$' -- node "$PAY" --allow https://buy.stripe.com/abc123 "$PD/dist"
expect "pay: with no allowed link any payment address fails" 1 '^FAIL: payment-host-scan path=.*app.js address=https://buy.stripe.com/abc123$' -- node "$PAY" "$PD/dist"
for address in 'https://buy.stripe.com/abc1234' 'https://buy.stripe.com/abc123?prefilled_email=x' 'https://checkout.stripe.com/c/pay/cs_live_x' '//donate.stripe.com/x' 'https://www.paypal.com/cgi-bin/webscr' 'paypal.me/someone' 'https://ko-fi.com/x' 'HTTPS://BUY.STRIPE.COM/abc123x' 'https:\/\/buy.stripe.com\/evil' 'https%3A%2F%2Fcheckout.stripe.com%2Fx'; do
  printf 'const b="%s";\n' "$address" > "$PD/other/x.js"
  expect "pay: $address fails" 1 '^FAIL: payment-host-scan path=.*x.js address=' -- node "$PAY" --allow-from "$PD/netlify.toml" "$PD/other"
done
# Every spelling a browser resolves to a payment host: percent-encoded dots and letters (once, twice,
# and as the UTF-8 bytes of a fullwidth dot), HTML character references, JavaScript escapes, the
# ideographic and fullwidth full stops, and fullwidth letters (new URL() reads each as buy.stripe.com).
for address in 'https://buy%2Estripe%2Ecom/test_evil' 'https://buy%252Estripe%252Ecom/x' 'https://buy.str%69pe.com/x' 'https://buy%EF%BC%8Estripe%EF%BC%8Ecom/x' \
  'https://buy&#46;stripe&#46;com/x' 'https://buy&#x2E;stripe&#x2e;com/x' 'https://buy&period;stripe&period;com/x' 'https&colon;&sol;&sol;paypal&period;me/x' \
  'https://buy\u002estripe\u002ecom/x' 'https://buy\u{2e}stripe\x2ecom/x' 'https://buy。stripe。com/x' 'https://buy．stripe．com/x' 'https://buy｡stripe｡com/x' \
  'https://ｂｕｙ.ｓｔｒｉｐｅ.ｃｏｍ/x' 'https://ＢＵＹ．ＳＴＲＩＰＥ．ＣＯＭ/abc123'; do
  printf 'const b="%s";\n' "$address" > "$PD/other/x.js"
  expect "pay: $address fails as the host a browser reads" 1 '^FAIL: payment-host-scan path=.*x.js address=.*(stripe\.com|STRIPE\.COM|paypal\.me)' -- node "$PAY" --allow-from "$PD/netlify.toml" "$PD/other"
done
printf '<a href="https://buy&#46;stripe&#46;com/abc123">Pay</a>\n' > "$PD/other/x.js"
expect "pay: the configured link written with character references is still the configured link" 0 '^PASS: payment-host-scan files=1 allowed=1$' -- node "$PAY" --allow-from "$PD/netlify.toml" "$PD/other"
printf 'const c="https://notstripe.com/x https://stripe.company/y help@stripe.com https://example.com/buy.stripe";\n' > "$PD/other/x.js"
expect "pay: look-alike hosts, an email address and a path pass" 0 '^PASS: payment-host-scan files=1 allowed=0$' -- node "$PAY" --allow-from "$PD/netlify.toml" "$PD/other"
printf '%s\n' 'const d="100% done, 50%2 off, &#169; 2026, été, notstripe%2Ecom/x";' > "$PD/other/x.js"
expect "pay: decoded text that names no payment host passes" 0 '^PASS: payment-host-scan files=1 allowed=0$' -- node "$PAY" --allow-from "$PD/netlify.toml" "$PD/other"
expect "pay: a netlify.toml with no Payment Link is a usage error" 2 '^FAIL: payment-host-scan usage: .* sets no VITE_STRIPE_PAYMENT_LINK_URL$' -- node "$PAY" --allow-from "$GATE_DIR/payment-hosts.txt" "$PD/dist"
expect "pay: an allowed link that is not a Payment Link is a usage error" 2 '^FAIL: payment-host-scan usage: the allowed link is not a Payment Link address' -- node "$PAY" --allow-from "$PD/bad.toml" "$PD/dist"
expect "pay: a missing folder is a usage error" 2 '^FAIL: payment-host-scan usage: not a folder' -- node "$PAY" "$PD/none"
expect "pay: no folder is a usage error" 2 '^FAIL: payment-host-scan usage: name at least one build folder$' -- node "$PAY"

# ---------------------------------------------------------------- restore-kernel.sh
# The build job's second line. A card test that ran on the same disk could rewrite the bot's package
# script or its report module and forge a green bot; restoring every kernel file from the base
# commit before the bot runs puts the real harness back. W's commit is the base.
W_BASE=$(git -C "$W" rev-parse HEAD)
expect "restore: a clean checkout changes nothing" 0 '^PASS: restore-kernel files=[0-9]+ restored=0 removed=0$' -- bash "$RESTORE" --repo-root "$W" "$W_BASE"
printf 'process.stdout.write(JSON.stringify({ ok: true, simulatedSeconds: 36000, invariants: [], unlocks: [], finalTotalDust: 1, stateHash: "x" }) + "\\n");\n' > "$W/seed-1/forged.js"
write_package "$W/seed-1" @backseat/seed-1 true true "$SEED_BUILD" "node forged.js"
expect "restore: a rewritten bot script forges a green bot when nothing is restored" 0 '^GATE PASS folder=seed-1 lane=config phase=bot$' -- env GATE_TEST_BOT_FAIL=1 bash "$SHIP" --repo-root "$W" --folder seed-1 --lane config --phase bot --dry-run
expect "restore: the rewritten package file comes back from the base commit" 0 '^PASS: restore-kernel files=[0-9]+ restored=1 removed=0$' -- bash "$RESTORE" --repo-root "$W" "$W_BASE"
expect "restore: the restored harness runs the real bot, which fails" 1 '^GATE FAIL step=bot detail=FAIL: headless-bot exit=1 ok=false failed=1$' -- env GATE_TEST_BOT_FAIL=1 bash "$SHIP" --repo-root "$W" --folder seed-1 --lane config --phase bot --dry-run
printf 'module.exports = (hours, seed) => ({ ok: true, simulatedSeconds: hours * 3600, invariants: [], unlocks: [], finalTotalDust: 1, stateHash: "x" });\n' > "$W/seed-1/bots/report.js"
expect "restore: a rewritten report module forges a green bot when nothing is restored" 0 '^GATE PASS folder=seed-1 lane=config phase=bot$' -- env GATE_TEST_BOT_FAIL=1 bash "$SHIP" --repo-root "$W" --folder seed-1 --lane config --phase bot --dry-run
printf 'module.exports = {};\n' > "$W/seed-1/bots/extra.js"
printf 'module.exports = { plugins: [] };\n' > "$W/seed-1/postcss.config.cjs"
mkdir -p "$W/seed-1/render"
printf 'VITE_NOTE=1\n' > "$W/seed-1/render/.env.local"
rm -f "$W/pnpm-workspace.yaml"
expect "restore: changed and deleted kernel files come back and new ones go" 0 '^PASS: restore-kernel files=[0-9]+ restored=2 removed=3$' -- bash "$RESTORE" --repo-root "$W" "$W_BASE"
assert "restore: the report module is the base commit's" test "$(cat "$W/seed-1/bots/report.js")" = "$(git -C "$W" show "$W_BASE:seed-1/bots/report.js")"
assert "restore: the deleted workspace file is back" test -f "$W/pnpm-workspace.yaml"
assert "restore: a new file under a kernel path is gone" test ! -e "$W/seed-1/bots/extra.js"
assert "restore: a new build config is gone" test ! -e "$W/seed-1/postcss.config.cjs"
assert "restore: a new env file is gone" test ! -e "$W/seed-1/render/.env.local"
assert "restore: a lane file is left alone" test -f "$W/seed-1/forged.js"
expect "restore: the real bot fails again" 1 '^GATE FAIL step=bot detail=FAIL: headless-bot exit=1 ok=false failed=1$' -- env GATE_TEST_BOT_FAIL=1 bash "$SHIP" --repo-root "$W" --folder seed-1 --lane config --phase bot --dry-run
expect "restore: a second run changes nothing" 0 '^PASS: restore-kernel files=[0-9]+ restored=0 removed=0$' -- bash "$RESTORE" --repo-root "$W" "$W_BASE"
rm -f "$W/seed-1/forged.js"
expect "restore: usage without a base" 2 '^$' -- bash "$RESTORE" --repo-root "$W"
expect "restore: a base that does not resolve is an error" 2 '^$' -- bash "$RESTORE" --repo-root "$W" not-a-ref

# ---------------------------------------------------------------- .github/workflows/gate.yml
# ---------------------------------------------------------------- kernel-guard
KERNEL="$GATE_DIR/kernel-guard.sh"
printf 'seed-1/config/spawn-table.json\nseed-1/render/scene.ts\n' > "$T/kernel-ok.txt"
printf 'seed-1/config/unlocks.json\nplatform/gate/ship-gate.sh\n' > "$T/kernel-gate.txt"
printf 'seed-1/sim/invariants.ts\n' > "$T/kernel-file.txt"
printf 'seed-1/sim/invariants.tsx\nplatform/gates/x.sh\n' > "$T/kernel-near.txt"
expect "kernel-guard: usage without a file" 2 '^$' -- bash "$KERNEL"
expect "kernel-guard: config and render changes pass" 0 '^PASS: kernel-guard files=2$' -- bash "$KERNEL" "$T/kernel-ok.txt"
expect "kernel-guard: a file under a kernel folder fails" 1 '^FAIL: kernel-guard path=platform/gate/ship-gate.sh$' -- bash "$KERNEL" "$T/kernel-gate.txt"
expect "kernel-guard: a kernel file fails" 1 '^FAIL: kernel-guard path=seed-1/sim/invariants.ts$' -- bash "$KERNEL" "$T/kernel-file.txt"
expect "kernel-guard: a name that only starts like a kernel path passes" 0 '^PASS: kernel-guard files=2$' -- bash "$KERNEL" "$T/kernel-near.txt"
# kernel-names.txt: a file or folder with one of these names is kernel at any depth, in any lane.
for file in seed-1/content/CLAUDE.md seed-1/render/.claude/settings.json seed-1/vitest.config.ts seed-1/config/.npmrc .pnpmfile.mjs seed-1/.pnpmfile.cjs \
  seed-1/content/claude.md seed-1/render/.Claude/settings.json seed-1/Vite.Config.ts .GitHub/workflows/x.yml Platform/Gate/ship-gate.sh; do
  printf 'seed-1/config/spawn-table.json\n%s\n' "$file" > "$T/kernel-name.txt"
  expect "kernel-guard: $file fails by name" 1 "^FAIL: kernel-guard path=$file\$" -- bash "$KERNEL" "$T/kernel-name.txt"
done
printf 'seed-1/config/spawn-table.json\nseed-1/content/CLAUDE.md.txt\nseed-1/content/claude/notes.json\nseed-1/render/vite.configs/a.ts\n' > "$T/kernel-name-near.txt"
expect "kernel-guard: names that only resemble a kernel name pass" 0 '^PASS: kernel-guard files=4$' -- bash "$KERNEL" "$T/kernel-name-near.txt"
# The board's own site, the public site's money, ledger and legal surfaces, the determinism harness,
# the game page, and every config a build tool, the package manager or Netlify loads from the folder
# it works in.
for file in platform/board/src/Board.tsx platform/board/netlify.toml platform/site/src/lib/legal.ts platform/site/src/lib/payment.ts \
  platform/site/src/pages/Contribute.tsx platform/site/src/pages/Ledger.tsx platform/site/src/pages/Legal.tsx platform/site/src/components/Meter.tsx \
  platform/site/src/lib/source.ts platform/site/src/lib/env.ts seed-1/index.html seed-1/sim/hash.ts seed-1/sim/rng.ts seed-1/tests/timeline.test.ts \
  platform/site/postcss.config.mjs seed-1/.postcssrc.json seed-1/render/tailwind.config.ts seed-1/babel.config.json seed-1/.babelrc platform/site/tsconfig.json \
  seed-1/render/tsconfig.app.json seed-1/.env seed-1/.env.production seed-1/public/_headers platform/site/public/_redirects seed-1/pnpm-workspace.yaml \
  seed-1/pnpm-lock.yaml seed-1/package-lock.json seed-1/npm-shrinkwrap.json seed-1/yarn.lock \
  platform/site/index.html platform/site/src/main.tsx platform/site/src/App.tsx platform/site/src/lib/studio.tsx platform/site/src/components/Stat.tsx \
  platform/site/src/components/Guarded.tsx platform/site/src/components/EventList.tsx platform/site/src/components/DeployList.tsx \
  platform/site/src/components/StaleNotice.tsx platform/site/src/components/PausedNotice.tsx platform/site/src/components/Funding.tsx; do
  printf 'seed-1/config/spawn-table.json\n%s\n' "$file" > "$T/kernel-new.txt"
  expect "kernel-guard: $file is kernel" 1 "^FAIL: kernel-guard path=$file\$" -- bash "$KERNEL" "$T/kernel-new.txt"
done
printf 'seed-1/render/headers.ts\nseed-1/content/environment.json\nseed-1/sim/hashing.ts\nseed-1/render/postcss.ts\nseed-1/render/rng-view.ts\n' > "$T/kernel-new-near.txt"
expect "kernel-guard: names that only resemble the new kernel files pass" 0 '^PASS: kernel-guard files=5$' -- bash "$KERNEL" "$T/kernel-new-near.txt"
# The site's pages, their routes, copy, card layout, page header and styles stay open to the platform code lane.
printf 'platform/site/src/pages/Landing.tsx\nplatform/site/src/lib/copy.ts\nplatform/site/src/lib/roster.ts\nplatform/site/src/components/Cards.tsx\nplatform/site/src/styles.css\nplatform/boards/x.ts\nplatform/site/src/routes.tsx\nplatform/site/src/components/PageHeader.tsx\nplatform/site/src/lib/cards.ts\n' > "$T/kernel-site-open.txt"
expect "kernel-guard: the site's pages, routes, copy, cards, header and styles pass" 0 '^PASS: kernel-guard files=9$' -- bash "$KERNEL" "$T/kernel-site-open.txt"
printf 'seed-1/config/spawn-table.json\nseed-1/content/a\tb.json\n' > "$T/kernel-tab.txt"
expect "kernel-guard: a tab in a listed name fails" 1 '^FAIL: kernel-guard path=seed-1/content/a.b\.json$' -- bash "$KERNEL" "$T/kernel-tab.txt"
printf 'seed-1/content/a\001b.json\n' > "$T/kernel-control.txt"
expect "kernel-guard: a control character in a listed name fails" 1 '^FAIL: kernel-guard path=seed-1/content/a.b\.json$' -- bash "$KERNEL" "$T/kernel-control.txt"
printf '"seed-1/content/x.json"\n' > "$T/kernel-quoted.txt"
expect "kernel-guard: a quoted line fails" 1 '^FAIL: kernel-guard path="seed-1/content/x\.json"$' -- bash "$KERNEL" "$T/kernel-quoted.txt"

# Names git would quote reach the guard unquoted; names it still quotes, symlinks and submodules fail.
E="$T/e"
mkdir -p "$E/seed-1/content" "$E/.github/workflows"
git -C "$E" init -q -b main
printf '{}\n' > "$E/seed-1/content/strings.json"
git -C "$E" add -A && git -C "$E" commit -q -m "base"; E0=$(git -C "$E" rev-parse HEAD)
NTILDE=$(printf '\303\261')
EACUTE=$(printf '\303\251')
printf 'on: push\n' > "$E/.github/workflows/$NTILDE.yml"
git -C "$E" add -A && git -C "$E" commit -q -m "workflow"; E1=$(git -C "$E" rev-parse HEAD)
bash "$CHANGED" --repo-root "$E" --list "$E0" "$E1" > "$T/non-ascii.txt"
expect "kernel-guard: a non-ASCII workflow listed by changed-paths fails" 1 "^FAIL: kernel-guard path=\\.github/workflows/$NTILDE\\.yml\$" -- bash "$KERNEL" "$T/non-ascii.txt"
mkdir -p "$E/seed-1/content/$EACUTE"
printf '# notes\n' > "$E/seed-1/content/$EACUTE/CLAUDE.md"
git -C "$E" add -A && git -C "$E" commit -q -m "nested"; E2=$(git -C "$E" rev-parse HEAD)
bash "$CHANGED" --repo-root "$E" --list "$E1" "$E2" > "$T/non-ascii.txt"
expect "kernel-guard: CLAUDE.md in a non-ASCII folder listed by changed-paths fails" 1 "^FAIL: kernel-guard path=seed-1/content/$EACUTE/CLAUDE\\.md\$" -- bash "$KERNEL" "$T/non-ascii.txt"
printf '{}\n' > "$E/seed-1/content/a	b.json"
git -C "$E" add -A && git -C "$E" commit -q -m "tab"; E3=$(git -C "$E" rev-parse HEAD)
bash "$CHANGED" --repo-root "$E" --list "$E2" "$E3" > "$T/tab.txt"
expect "kernel-guard: a tab in a name listed by changed-paths fails" 1 '^FAIL: kernel-guard path="seed-1/content/a' -- bash "$KERNEL" "$T/tab.txt"
expect "changed: ordinary files pass the mode check" 0 '^PASS: mode-check entries=1$' -- bash "$CHANGED" --repo-root "$E" --check-modes "$E2" "$E3"
ln -s ../../.github "$E/seed-1/content/gh"
git -C "$E" add -A && git -C "$E" commit -q -m "link"; E4=$(git -C "$E" rev-parse HEAD)
bash "$CHANGED" --repo-root "$E" --list "$E3" "$E4" > "$T/link.txt"
expect "kernel-guard: a symlink's own name passes the guard" 0 '^PASS: kernel-guard files=1$' -- bash "$KERNEL" "$T/link.txt"
expect "changed: a symlink fails the mode check" 1 '^FAIL: mode-check path=seed-1/content/gh mode=120000$' -- bash "$CHANGED" --repo-root "$E" --check-modes "$E3" "$E4"
expect "changed: a zero base checks the mode of every entry" 1 '^FAIL: mode-check path=seed-1/content/gh mode=120000$' -- bash "$CHANGED" --repo-root "$E" --check-modes 0000000000000000000000000000000000000000 "$E4"
printf '[submodule "sub"]\n\tpath = seed-1/content/sub\n\turl = ./sub\n\tignore = all\n' > "$E/seed-1/content/.gitmodules"
git -C "$E" update-index --add --cacheinfo "160000,$E0,seed-1/content/sub"
git -C "$E" commit -q -m "submodule"; E5=$(git -C "$E" rev-parse HEAD)
expect "changed: a submodule fails the mode check" 1 '^FAIL: mode-check path=seed-1/content/sub mode=160000$' -- bash "$CHANGED" --repo-root "$E" --check-modes "$E4" "$E5"
expect "changed: --check-modes needs refs" 2 '^$' -- bash "$CHANGED" --repo-root "$E" --check-modes "$E4"

# The dispatcher polls the check run named gate; these checks pin the names the workflow must keep.
WORKFLOW="$REPO_ROOT/.github/workflows/gate.yml"
workflow_has() { grep -qE -- "$1" "$WORKFLOW"; }
assert "workflow: file exists" test -f "$WORKFLOW"
assert "workflow: named gate" workflow_has '^name: gate$'
for job in detect seed-code platform build gate; do
  assert "workflow: job $job" workflow_has "^  $job:$"
done
assert "workflow: no seed-config job (the config lane's build and bot run in the build job)" test "$(grep -c '^  seed-config:$' "$WORKFLOW")" = 0
assert "workflow: the gate job needs every other job" workflow_has '^    needs: \[detect, seed-code, platform, build\]$'
assert "workflow: the gate job runs unless the run was cancelled" workflow_has '^    if: \$\{\{ !cancelled\(\) \}\}$'
assert "workflow: the gate job fails on a failed or cancelled job" workflow_has '\(failure\|cancelled\)'
assert "workflow: card branches restore the base commit's gate in every job" test "$(grep -cE '^ +(run: )?git checkout "\$BASE" -- platform/gate$' "$WORKFLOW")" = 4
assert "workflow: the gate is restored before the changed-files list is written" awk '/Use the base commit.s gate on a card branch/{r=NR} /Write the commit message and changed files/{if (!r || r > NR) bad=1; r=0} END{exit bad}' "$WORKFLOW"
job_block() { awk -v job="  $1:" '$0 == job {p=1; next} /^  [a-z-]+:$/{p=0} p' "$WORKFLOW"; }
detect_runs() { job_block detect | grep -qF -- "$1"; }
detect_installs_nothing() { ! job_block detect | grep -qE 'pnpm (install|i )|npm (install|ci)|uses: (pnpm/action-setup|actions/setup-node)'; }
# order <job> <fixed string> ...: each string is found in the job, each after the one before.
order() {
  local job=$1
  shift
  job_block "$job" | ORDER_LIST="$(printf '%s\n' "$@")" awk 'BEGIN { n = split(ENVIRON["ORDER_LIST"], want, "\n") } { for (i = 1; i <= n; i++) if (!(i in at) && index($0, want[i])) at[i] = NR } END { for (i = 1; i <= n; i++) { if (!(i in at)) exit 1; if (i > 1 && at[i] <= at[i - 1]) exit 1 } }'
}
assert "workflow: card branches run the kernel guard in detect" detect_runs 'run: bash platform/gate/kernel-guard.sh "$RUNNER_TEMP/changed-files.txt"'
assert "workflow: card branches run the mode check in detect" detect_runs 'run: bash platform/gate/changed-paths.sh --check-modes "$BASE" "$HEAD"'
assert "workflow: card branches run the lane check in detect" detect_runs 'run: bash platform/gate/changed-paths.sh --check-lane "$BRANCH" "$BASE" "$HEAD"'
assert "workflow: the kernel guard runs in one place only" test "$(grep -c 'platform/gate/kernel-guard.sh' "$WORKFLOW")" = 1
assert "workflow: detect installs nothing" detect_installs_nothing
assert "workflow: detect restores the base gate, then guards, then scans" order detect 'run: git checkout "$BASE" -- platform/gate' 'kernel-guard.sh' '--check-modes' '--check-lane' 'Detect folders and lane' '--phase scans --folder seed-1' '--phase scans --folder platform'
assert "workflow: the gate job requires detect to pass" workflow_has '\[ "\$DETECT" = success \]'
for pair in 'seed-code SEED_CODE' 'platform PLATFORM_JOB' 'build BUILD'; do
  set -- $pair
  assert "workflow: the gate job requires $1 to pass when detect selects it" workflow_has "want $1 \"\\\$$2\""
done
assert "workflow: the gate job requires the build job whenever detect selects the seed or the site" workflow_has 'if \[ "\$SEED" = true \] \|\| \[ "\$SITE" = true \]; then want build'
assert "workflow: the gate job requires the platform job whenever detect selects any platform step" workflow_has 'if \[ "\$PLATFORM" = true \] \|\| \[ "\$SITE" = true \] \|\| \[ "\$FUNCTIONS" = true \]; then want platform'
for flag in seed platform lane site functions; do
  assert "workflow: detect outputs $flag" test "$(job_block detect | grep -c "^      $flag: \\\${{ steps.paths.outputs.$flag }}\$")" = 1
  assert "workflow: detect writes $flag to its outputs" detect_runs "echo \"$flag=\$$flag\" >> \"\$GITHUB_OUTPUT\""
done
assert "workflow: detect fails a flag that is not true or false before writing any output" order detect 'for flag in "seed=$seed" "platform=$platform" "site=$site" "functions=$functions"; do' 'echo "seed=$seed" >> "$GITHUB_OUTPUT"'
assert "workflow: the gate job fails a flag that is not true or false" order gate 'for flag in "seed=$SEED" "platform=$PLATFORM" "site=$SITE" "functions=$FUNCTIONS"; do' 'want() {'
# step_if <job> <step line> <if line>: the step's next line is exactly the condition.
step_if() {
  job_block "$1" | STEP="$2" COND="$3" awk 'index($0, ENVIRON["STEP"]) { getline nxt; if (nxt ~ /^ +if: / && index(nxt, ENVIRON["COND"])) ok = 1; else bad = 1 } END { exit !(ok && !bad) }'
}
for step in 'uses: denoland/setup-deno' 'name: Stripe webhook function tests'; do
  assert "workflow: the platform job runs '$step' only when detect selects the functions" step_if platform "$step" "if: needs.detect.outputs.functions == 'true'"
done
for step in 'name: Build the site for the end-to-end suite' 'name: Install Chromium for Playwright' 'name: Site end-to-end' 'name: Board site end-to-end'; do
  assert "workflow: the platform job runs '$step' only when detect selects the site" step_if platform "$step" "if: needs.detect.outputs.site == 'true'"
done
assert "workflow: the platform job gates exactly six steps on detect's flags" test "$(job_block platform | grep -cE "^        if: needs\.detect\.outputs\.(site|functions) == 'true'\$")" = 6
assert "workflow: the platform job's checks, gate, agent, ops and docs tests run on every platform change" test "$(job_block platform | grep -cE '^        if: ')" = 7
assert "workflow: the build job builds the sites only when detect selects them" step_if build 'name: Build the sites and scan the builds' "if: needs.detect.outputs.site == 'true'"
for job in seed-code platform; do
  assert "workflow: $job caches the pnpm store" test "$(job_block "$job" | grep -c '^          cache: pnpm$')" = 1
done
for step in 'pnpm --filter @backseat/gate test' 'pnpm test:agents' 'pnpm test:ops' 'pnpm test:functions'; do
  assert "workflow: the platform job runs $step after typecheck and tests" awk -v run="        run: $step" '/^  platform:$/{p=1; next} /^  [a-z-]+:$/{p=0} p && /name: Typecheck and tests$/{g=1} p && $0 == run {found=g} END{exit !found}' "$WORKFLOW"
done
assert "workflow: the platform job pins Deno" workflow_has '^          deno-version: v2\.[0-9]+\.[0-9]+$'
assert "workflow: the platform job builds the site for the end-to-end suite before running it, then the board site's suite" order platform 'run: pnpm --filter @backseat/site build' 'run: pnpm --filter @backseat/site exec playwright install' 'run: pnpm --filter @backseat/site e2e' 'run: pnpm --filter @backseat/board e2e'
assert "workflow: every job has a timeout" test "$(grep -c '^    timeout-minutes: ' "$WORKFLOW")" = "$(grep -c '^    runs-on: ' "$WORKFLOW")"
# Card code runs in seed-code and platform only; the build job runs it only in its last step.
assert "workflow: every ship-gate call names its phase" test "$(grep 'ship-gate.sh' "$WORKFLOW" | grep -vc -- '--phase ')" = 0
for job in seed-code platform; do
  assert "workflow: $job runs the checks phase and never the build or the bot" test "$(job_block "$job" | grep -c -- '--phase checks')" = 1 -a "$(job_block "$job" | grep -cE -- '--phase (build|bot|all)')" = 0
done
assert "workflow: the build job restores every kernel file, then installs, builds, scans and runs the bot last" order build 'git checkout "$BASE" -- platform/gate' 'restore-kernel.sh "$BASE"' 'uses: pnpm/action-setup' 'uses: actions/setup-node' 'run: pnpm install --frozen-lockfile --ignore-scripts' '--phase build --folder seed-1' '--phase build --folder platform' '--phase bot --folder seed-1'
build_runs_no_card_tests() { ! job_block build | grep -qE -- '--phase checks|pnpm (--filter [^ ]+ )?(test|e2e)|test:|playwright'; }
build_has_no_cache() { ! job_block build | grep -qE '^ +cache:'; }
assert "workflow: the build job runs no card tests" build_runs_no_card_tests
assert "workflow: the build job uses no dependency cache" build_has_no_cache
assert "workflow: the build job runs when detect selects the seed or the site" test "$(job_block build | grep -c "^    if: needs.detect.outputs.seed == 'true' || needs.detect.outputs.site == 'true'$")" = 1
assert "workflow: the build job restores kernel files on card branches only" order build 'name: Restore every kernel file from the base commit on a card branch' "if: startsWith(github.head_ref, 'card/')" 'restore-kernel.sh "$BASE"'
assert "workflow: a newer push to a pull request cancels its older run" workflow_has "^  cancel-in-progress: \\\$\\{\\{ github.event_name == 'pull_request' \\}\\}$"

# Every workflow file (.github is a kernel path; the board writes these): the token reads and
# nothing more, no secret is named, no trigger runs with the base branch's rights, every checkout
# drops the token, and only gate.yml has a job named gate, the check the dispatcher merges on.
for file in "$REPO_ROOT"/.github/workflows/*.yml "$REPO_ROOT"/.github/workflows/*.yaml; do
  [ -f "$file" ] || continue
  name=$(basename "$file")
  top_permissions() { awk '/^permissions:/{p=1; next} p && /^  /{print; next} {p=0}' "$1"; }
  assert "workflow audit: $name grants the token contents: read and nothing else" test "$(top_permissions "$file")" = "  contents: read"
  assert "workflow audit: $name sets no job-level permissions" test "$(grep -cE '^ +permissions:' "$file")" = 0
  assert "workflow audit: $name grants no write access" test "$(grep -cE ':[[:space:]]*write([[:space:]]|$)|write-all' "$file")" = 0
  assert "workflow audit: $name names no secret" test "$(grep -c 'secrets\.' "$file")" = 0
  assert "workflow audit: $name has no pull_request_target or workflow_run trigger" test "$(grep -cE 'pull_request_target|workflow_run' "$file")" = 0
  checkouts_drop_token() {
    awk '
      /uses: actions\/checkout@/ { if (open && !ok) bad = 1; open = 1; ok = 0; indent = index($0, "-"); next }
      open && /persist-credentials: false/ { ok = 1 }
      open && /^ *- / && index($0, "-") <= indent { if (!ok) bad = 1; open = 0 }
      open && /^  [A-Za-z0-9_-]+:[[:space:]]*$/ { if (!ok) bad = 1; open = 0 }
      END { if (open && !ok) bad = 1; exit bad }
    ' "$1"
  }
  assert "workflow audit: every checkout in $name sets persist-credentials: false" checkouts_drop_token "$file"
  gate_jobs=$(awk '
    /^jobs:/ { j = 1; next }
    j && /^[^ ]/ { j = 0 }
    j && /^  [A-Za-z0-9_-]+:[[:space:]]*$/ { id = $1; sub(/:$/, "", id); if (id == "gate") n++ }
    j && /^    name:[[:space:]]*["'"'"']?gate["'"'"']?[[:space:]]*$/ { n++ }
    END { print n + 0 }
  ' "$file")
  if [ "$name" = gate.yml ]; then
    assert "workflow audit: gate.yml has one job with the id gate and the name gate" test "$gate_jobs" = 2 -a "$(job_block gate | grep -c '^    name: gate$')" = 1
  else
    assert "workflow audit: $name has no job named gate" test "$gate_jobs" = 0
  fi
done
assert "workflow audit: gate.yml runs checkout four times" test "$(grep -c 'uses: actions/checkout@' "$WORKFLOW")" = 4

# The run block of the named step in a job, dedented, as the runner writes it to a script.
step_script() {
  job_block "$1" | awk -v step="      - name: $2" '
    $0 == step { s = 1; next }
    s && /^      - / { exit }
    s && /^        run: \|$/ { r = 1; next }
    r && /^          / { print substr($0, 11); next }
    r && /^ {0,9}[^ ]/ { exit }
  '
}
GATE_SCRIPT="$T/gate-verdict.sh"
step_script gate 'Require detect and every job it selected to pass' > "$GATE_SCRIPT"
assert "workflow: the gate job's verdict script is found" test -s "$GATE_SCRIPT"
# verdict <exit> <name> KEY=value ...: runs the verdict with GitHub's env, success by default.
verdict() {
  local want=$1 name=$2
  shift 2
  expect "gate verdict: $name" "$want" '' -- env -i PATH="$PATH" RESULTS='{}' DETECT=success SEED=false PLATFORM=false SITE=false FUNCTIONS=false LANE=code \
    SEED_CODE=skipped PLATFORM_JOB=skipped BUILD=skipped "$@" bash -e "$GATE_SCRIPT"
}
verdict 0 "a docs-only change passes with platform alone" PLATFORM=true PLATFORM_JOB=success
verdict 0 "a dispatcher change passes without the build job" PLATFORM=true PLATFORM_JOB=success
verdict 1 "a site change fails when the build job did not run" PLATFORM=true SITE=true PLATFORM_JOB=success
verdict 0 "a site change passes with platform and build" PLATFORM=true SITE=true PLATFORM_JOB=success BUILD=success
verdict 1 "a functions change fails when the platform job did not run" PLATFORM=true FUNCTIONS=true
verdict 1 "a site flag without the platform flag still needs the platform job" SITE=true BUILD=success
verdict 1 "a seed code change fails when seed-code did not run" SEED=true BUILD=success
verdict 0 "a seed code change passes with seed-code and build" SEED=true SEED_CODE=success BUILD=success
verdict 0 "a config change passes with build alone" SEED=true LANE=config BUILD=success
verdict 1 "a failed detect fails the gate" DETECT=failure
verdict 1 "a missing site flag fails the gate" PLATFORM=true PLATFORM_JOB=success SITE=
verdict 1 "a malformed functions flag fails the gate" PLATFORM=true PLATFORM_JOB=success FUNCTIONS=yes
verdict 1 "a failed job named in the results fails the gate" PLATFORM=true PLATFORM_JOB=success RESULTS='{"build": {"result": "failure"}}'
verdict 0 "a change to nothing passes with detect alone"

DETECT_SCRIPT="$T/detect-paths.sh"
step_script detect 'Detect folders and lane' > "$DETECT_SCRIPT"
assert "workflow: detect's parsing script is found" test -s "$DETECT_SCRIPT"
# detect_with <exit> <name> <changed-paths line> [branch]: runs detect's script against a stand-in
# changed-paths.sh that prints the line, and keeps what it wrote to GITHUB_OUTPUT in $T/detect-out.txt.
detect_with() {
  local want=$1 name=$2 line=$3 branch=${4:-launch/x}
  rm -rf "$T/detect" && mkdir -p "$T/detect/platform/gate"
  printf 'printf "%%s\\n" "%s"\n' "$line" > "$T/detect/platform/gate/changed-paths.sh"
  : > "$T/detect-out.txt"
  expect "detect: $name" "$want" '' -- env -i PATH="$PATH" BASE=a HEAD=b BRANCH="$branch" GITHUB_OUTPUT="$T/detect-out.txt" bash -e -c "cd '$T/detect' && bash -e '$DETECT_SCRIPT'"
}
detect_with 0 "passes every flag through" 'seed=false platform=true lane=code site=false functions=true'
assert "detect: writes all five outputs" test "$(cat "$T/detect-out.txt")" = "seed=false
platform=true
lane=code
site=false
functions=true"
detect_with 0 "puts a -code card branch in the code lane" 'seed=true platform=false lane=config site=false functions=false' card/abcd1234-code
assert "detect: a -code branch is the code lane" grep -qx 'lane=code' "$T/detect-out.txt"
detect_with 1 "fails an output from an older changed-paths.sh with no site or functions flag" 'seed=true platform=true lane=code'
assert "detect: writes nothing when a flag is missing" test ! -s "$T/detect-out.txt"
detect_with 1 "fails a malformed lane" 'seed=true platform=true lane=other site=true functions=true'

# The constitution's description of the gate (docs/PLAN.md Appendix A) says what the workflow does:
# the work is selected by changed path, the site build and its suite run only for a change that can
# reach the site, and the gate job fails closed.
PLAN="$REPO_ROOT/docs/PLAN.md"
assert "plan: Appendix A names the selection by changed path" grep -qF 'The detect job selects the work by changed path (`platform/gate/changed-paths.sh`)' "$PLAN"
assert "plan: Appendix A runs the site build and the end-to-end suite only when a change can reach the site" grep -qF 'then, when it can reach the site, the site build and the Playwright end-to-end suite.' "$PLAN"
assert "plan: Appendix A says the gate job fails closed" grep -qF 'The `gate` job fails closed: it fails when detect failed, when a flag is missing or not exactly true or false, and when a job detect selected did not pass.' "$PLAN"
assert "plan: Appendix A no longer says every platform change builds the site" test "$(grep -cF 'supabase and site packages, then the site build and the Playwright end-to-end suite.' "$PLAN")" = 0

# ---------------------------------------------------------------- netlify.toml
# A card branch's pull request is opened before the gate runs, so neither site may build a deploy
# preview of it. Netlify runs the ignore command with bash in the site's folder; exit 0 skips.
SITES="$T/netlify"
mkdir -p "$SITES/platform/site" "$SITES/seed-1"
git -C "$SITES" init -q -b main
for f in pnpm-lock.yaml package.json pnpm-workspace.yaml tsconfig.base.json platform/site/index.html seed-1/index.html; do printf 'x\n' > "$SITES/$f"; done
git -C "$SITES" add -A && git -C "$SITES" commit -q -m "base"; N0=$(git -C "$SITES" rev-parse HEAD)
printf 'y\n' > "$SITES/seed-1/index.html"; git -C "$SITES" commit -q -am "seed"; N1=$(git -C "$SITES" rev-parse HEAD)
netlify_ignore() { sed -n "s/^  ignore = '\(.*\)'\$/\1/p" "$REPO_ROOT/$1"; }
# ignore_exit <toml> <folder> <HEAD> <CACHED_COMMIT_REF> <COMMIT_REF>
ignore_exit() {
  local cmd
  cmd=$(netlify_ignore "$1")
  (cd "$SITES/$2" && env HEAD="$3" CACHED_COMMIT_REF="$4" COMMIT_REF="$5" bash -c "$cmd") > /dev/null 2>&1
  echo $?
}
for pair in 'platform/site/netlify.toml platform/site' 'seed-1/netlify.toml seed-1'; do
  set -- $pair
  assert "netlify: $1 has one ignore command" test "$(netlify_ignore "$1" | wc -l | tr -d ' ')" = 1
  assert "netlify: $1 skips a card branch's deploy preview" test "$(ignore_exit "$1" "$2" card/abcd1234-code '' "$N1")" = 0
  assert "netlify: $1 skips a card branch with a cached build too" test "$(ignore_exit "$1" "$2" card/abcd1234-config "$N0" "$N1")" = 0
  assert "netlify: $1 builds a board branch's deploy preview" test "$(ignore_exit "$1" "$2" launch/gate '' "$N1")" != 0
  assert "netlify: $1 builds a branch that only starts like a card branch" test "$(ignore_exit "$1" "$2" cards/x '' "$N1")" != 0
  assert "netlify: $1 builds main with no cached build" test "$(ignore_exit "$1" "$2" main '' "$N1")" != 0
done
assert "netlify: the site skips a main build that changed nothing it uses" test "$(ignore_exit platform/site/netlify.toml platform/site main "$N0" "$N1")" = 0
assert "netlify: the seed builds main when its folder changed" test "$(ignore_exit seed-1/netlify.toml seed-1 main "$N0" "$N1")" != 0
# Only the site that changed builds; a workspace file the builds read rebuilds both, and a change
# neither build reads (docs, the dispatcher) rebuilds neither (docs/specs/scale-launch.md).
netlify_commit() {
  local f=$1
  mkdir -p "$SITES/$(dirname "$f")"
  printf 'z %s\n' "$f" >> "$SITES/$f"
  git -C "$SITES" add -A && git -C "$SITES" commit -q -m "$f"
  git -C "$SITES" rev-parse HEAD
}
N2=$(netlify_commit platform/site/src/App.tsx)
assert "netlify: a site change builds the site" test "$(ignore_exit platform/site/netlify.toml platform/site main "$N1" "$N2")" != 0
assert "netlify: a site change skips the seed" test "$(ignore_exit seed-1/netlify.toml seed-1 main "$N1" "$N2")" = 0
for f in tsconfig.base.json pnpm-workspace.yaml pnpm-lock.yaml package.json; do
  B=$(git -C "$SITES" rev-parse HEAD)
  A=$(netlify_commit "$f")
  for pair in 'platform/site/netlify.toml platform/site' 'seed-1/netlify.toml seed-1'; do
    set -- $pair
    assert "netlify: a $f change builds $2" test "$(ignore_exit "$1" "$2" main "$B" "$A")" != 0
  done
done
for f in docs/PLAN.md platform/dispatcher/src/tick.ts; do
  B=$(git -C "$SITES" rev-parse HEAD)
  A=$(netlify_commit "$f")
  for pair in 'platform/site/netlify.toml platform/site' 'seed-1/netlify.toml seed-1'; do
    set -- $pair
    assert "netlify: a $f change skips $2" test "$(ignore_exit "$1" "$2" main "$B" "$A")" = 0
  done
done
for pair in 'platform/site/netlify.toml platform/site' 'seed-1/netlify.toml seed-1'; do
  set -- $pair
  assert "netlify: $1 skips a dependabot branch's deploy preview" test "$(ignore_exit "$1" "$2" dependabot/npm_and_yarn/vite-8.3.1 '' "$N1")" = 0
  assert "netlify: $1 builds a branch that only mentions dependabot" test "$(ignore_exit "$1" "$2" launch/dependabot '' "$N1")" != 0
done

# ---------------------------------------------------------------- summary
if [ "$FAILED" -eq 0 ]; then
  echo "PASS: gate tests passed=$PASSED"
  exit 0
fi
echo "FAIL: gate tests failed=$FAILED passed=$PASSED"
exit 1
