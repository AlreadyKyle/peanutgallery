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

BANNED="$GATE_DIR/banned-phrases.sh"
TOKENS="$GATE_DIR/runtime-token-deny.sh"
SECRETS="$GATE_DIR/secret-scan.sh"
CHANGED="$GATE_DIR/changed-paths.sh"
SHIP="$GATE_DIR/ship-gate.sh"
BOT="$GATE_DIR/headless-bot/run.mjs"

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
awk -v mark="$MARK" 'NR == 320 { print "title: " mark; next } { print }' "$REPO_ROOT/docs/PLAN.md" > "$A/docs/PLAN.md"
expect "banned: hashed term on docs/PLAN.md line 320 fails (no exemption)" 1 '^FAIL: banned-phrases hits=1 first=docs/PLAN.md:320 list=hashed' -- bash "$BANNED" --repo-root "$A" --denylist-dir "$T/lists" "$A/docs/PLAN.md"
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
printf 'export const t = "%s";\n' "$TD" > "$B/seed-1/sim/index.test.ts"
printf 'export const t = "%s";\n' "$TD" > "$B/seed-1/tests/fixture.ts"
expect "tokens: test files are outside the scan" 0 '^PASS: runtime-token-deny files=4$' -- bash "$TOKENS" --repo-root "$B" --folder seed-1
rm -f "$B/seed-1/sim/index.test.ts"
mkdir -p "$B/seed-1/dist/assets"
printf '<p>%s</p>\n' "$TD" > "$B/seed-1/dist/index.html"
expect "tokens: built HTML is scanned" 1 '^FAIL: runtime-token-deny hits=1 first=seed-1/dist/index.html:1 pattern=open-task-marker$' -- bash "$TOKENS" --repo-root "$B" --folder seed-1
printf '<p>Dust</p>\n' > "$B/seed-1/dist/index.html"
printf 'const t = "%s";\n' "$TD" > "$B/seed-1/dist/assets/app.js"
expect "tokens: built assets are not scanned" 0 '^PASS: runtime-token-deny files=5$' -- bash "$TOKENS" --repo-root "$B" --folder seed-1
expect "tokens: a dist folder given directly reads only its HTML" 0 '^PASS: runtime-token-deny files=1$' -- bash "$TOKENS" --repo-root "$B" "$B/seed-1/dist"
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
    github-fine-grained-token "github_""pat_$BODY24" netlify-token "nfp""_$BODY24" json-web-token "eyJhbGci""Oi$BODY24"
}
shape_cases | while IFS='|' read -r name value; do
  printf 'key=%s\n' "$value" > "$C/secret.txt"
  expect "secrets: $name shape fails" 1 "^FAIL: secret-scan hits=1 first=$C/secret.txt:1 shape=$name\$" -- bash "$SECRETS" "$C/secret.txt"
  if printf '%s\n' "$LAST" | grep -q "$BODY24"; then FAILED=$((FAILED + 1)); echo "FAIL secrets: $name value was printed" | tee -a "$LOG"; else PASSED=$((PASSED + 1)); fi
  echo "$PASSED $FAILED" > "$T/counts.txt"
done
read -r PASSED FAILED < "$T/counts.txt"
printf 'prefix only: %s\n' "sk_""live_abc" > "$C/secret.txt"
expect "secrets: a bare prefix is not a key" 0 '^PASS: secret-scan' -- bash "$SECRETS" "$C/secret.txt"
rm -f "$C/secret.txt"
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
expect "changed: config-only change is the config lane" 0 '^seed=true platform=false lane=config$' -- bash "$CHANGED" --repo-root "$D" "$C0" "$C1"
expect "changed: seed code change is the code lane" 0 '^seed=true platform=false lane=code$' -- bash "$CHANGED" --repo-root "$D" "$C1" "$C2"
expect "changed: platform change" 0 '^seed=false platform=true lane=code$' -- bash "$CHANGED" --repo-root "$D" "$C2" "$C3"
expect "changed: root change touches both folders" 0 '^seed=true platform=true lane=code$' -- bash "$CHANGED" --repo-root "$D" "$C3" "$C4"
expect "changed: range spanning config and code is the code lane" 0 '^seed=true platform=true lane=code$' -- bash "$CHANGED" --repo-root "$D" "$C0" "$C4"
expect "changed: identical refs change nothing" 0 '^seed=false platform=false lane=code$' -- bash "$CHANGED" --repo-root "$D" "$C4" "$C4"
expect "changed: zero base counts every file" 0 '^seed=true platform=true lane=code$' -- bash "$CHANGED" --repo-root "$D" 0000000000000000000000000000000000000000 "$C1"
expect "changed: --list prints the files" 0 '^seed-1/config/spawn-table.json$' -- bash "$CHANGED" --repo-root "$D" --list "$C0" "$C1"
expect "changed: unknown head ref is an error" 2 '^$' -- bash "$CHANGED" --repo-root "$D" "$C0" not-a-ref
git -C "$D" checkout -q -b card/abcd1234-config "$C0"
printf '{"rows":[{"id":"cart"}]}\n' > "$D/seed-1/config/spawn-table.json"; git -C "$D" commit -q -am "branch config"; C5=$(git -C "$D" rev-parse HEAD)
expect "changed: branch diff uses the merge base, not main's later commits" 0 '^seed=true platform=false lane=config$' -- bash "$CHANGED" --repo-root "$D" "$C4" "$C5"

# ---------------------------------------------------------------- headless-bot/run.mjs and ship-gate.sh
W="$T/w"
mkdir -p "$W/seed-1/config" "$W/seed-1/content" "$W/seed-1/sim" "$W/platform/dispatcher" "$W/platform/supabase" "$W/platform/site/src"
printf '{"name":"gate-test-workspace","private":true}\n' > "$W/package.json"
printf 'packages:\n  - seed-1\n  - platform/*\n' > "$W/pnpm-workspace.yaml"
printf 'node_modules/\ndist/\n' > "$W/.gitignore"
cat > "$W/build.js" <<'EOF_BUILD'
// A substitute for a package build: writes dist/index.html and one asset the way the seed and site
// builds do. GATE_TEST_BUILD_TEXT replaces the page text.
const fs = require('node:fs');
fs.mkdirSync('dist/assets', { recursive: true });
fs.writeFileSync('dist/index.html', `<p>${process.env.GATE_TEST_BUILD_TEXT || 'Dust'}</p>\n`);
fs.writeFileSync('dist/assets/app.js', 'export {};\n');
EOF_BUILD
SEED_BUILD="node ../build.js"
SITE_BUILD="node ../../build.js"
cat > "$W/seed-1/bot.js" <<'EOF_BOT'
// A substitute for the seed bot command line: same flags, same report shape, no simulation.
const argv = process.argv.slice(2).filter((a) => a !== '--');
const get = (flag) => argv[argv.indexOf(flag) + 1];
const hours = Number(get('--hours'));
const failing = process.env.GATE_TEST_BOT_FAIL === '1';
const report = {
  ok: !failing,
  simulatedSeconds: hours * 3600,
  invariants: [{ name: 'no-negative-resource', ok: !failing, detail: failing ? 'dust fell below zero at 12 s' : 'dust never fell below zero' }],
  unlocks: [{ id: 'cart', atSeconds: 90 }],
  finalTotalDust: hours * 100,
  stateHash: 'seed-' + get('--seed'),
};
process.stdout.write(JSON.stringify(report) + '\n');
process.exitCode = report.ok ? 0 : 1;
EOF_BOT
write_package() {
  # $1 folder, $2 name, $3 typecheck command, $4 test command, $5 build command, $6 bot command
  printf '{"name":"%s","private":true,"scripts":{"typecheck":"%s","test":"%s","build":"%s"%s}}\n' "$2" "$3" "$4" "$5" "${6:+,\"bot\":\"$6\"}" > "$1/package.json"
}
write_package "$W/seed-1" @backseat/seed-1 true true "$SEED_BUILD" "node bot.js"
write_package "$W/platform/dispatcher" @backseat/dispatcher true true true
write_package "$W/platform/supabase" @backseat/supabase true true true
write_package "$W/platform/site" @backseat/site true true "$SITE_BUILD"
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
write_package "$W/seed-1" @backseat/seed-1 "exit 1" true "$SEED_BUILD" "node bot.js"
expect "ship: failing typecheck fails the code lane" 1 '^GATE FAIL step=typecheck detail=@backseat/seed-1: exit 1$' -- bash "$SHIP" --repo-root "$W" --folder seed-1 --lane code --dry-run
expect "ship: config lane skips typecheck" 0 '^GATE PASS folder=seed-1 lane=config$' -- bash "$SHIP" --repo-root "$W" --folder seed-1 --lane config --dry-run
write_package "$W/seed-1" @backseat/seed-1 true "exit 1" "$SEED_BUILD" "node bot.js"
expect "ship: failing tests fail the code lane" 1 '^GATE FAIL step=tests detail=@backseat/seed-1: exit 1$' -- bash "$SHIP" --repo-root "$W" --folder seed-1 --lane code --dry-run
write_package "$W/seed-1" @backseat/seed-1 true true "exit 3" "node bot.js"
expect "ship: failing build fails the last step" 1 '^GATE FAIL step=build detail=@backseat/seed-1: exit 3$' -- bash "$SHIP" --repo-root "$W" --folder seed-1 --lane config --dry-run
write_package "$W/seed-1" @backseat/seed-1 true true "$SEED_BUILD" "node bot.js"
write_package "$W/platform/site" @backseat/site true "exit 1" "$SITE_BUILD"
expect "ship: platform test failure names the package" 1 '^GATE FAIL step=tests detail=@backseat/site: exit 1$' -- bash "$SHIP" --repo-root "$W" --folder platform --dry-run
rm -f "$W/platform/site/package.json"
expect "ship: absent package is a failure, not a pass" 1 '^GATE FAIL step=typecheck detail=@backseat/site is not in the workspace$' -- bash "$SHIP" --repo-root "$W" --folder platform --dry-run

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

# The dispatcher polls the check run named gate; these checks pin the names the workflow must keep.
WORKFLOW="$REPO_ROOT/.github/workflows/gate.yml"
workflow_has() { grep -qE -- "$1" "$WORKFLOW"; }
assert "workflow: file exists" test -f "$WORKFLOW"
assert "workflow: named gate" workflow_has '^name: gate$'
for job in detect seed-config seed-code platform gate; do
  assert "workflow: job $job" workflow_has "^  $job:$"
done
assert "workflow: the gate job needs every other job" workflow_has '^    needs: \[detect, seed-config, seed-code, platform\]$'
assert "workflow: the gate job always runs" workflow_has '^    if: always\(\)$'
assert "workflow: the gate job fails on a failed or cancelled job" workflow_has '\(failure\|cancelled\)'
assert "workflow: card branches run the kernel guard from the base commit's gate" workflow_has 'git checkout "\$BASE" -- platform/gate && bash platform/gate/kernel-guard.sh'
assert "workflow: every job has a timeout" test "$(grep -c '^    timeout-minutes: ' "$WORKFLOW")" = "$(grep -c '^    runs-on: ' "$WORKFLOW")"

# ---------------------------------------------------------------- summary
if [ "$FAILED" -eq 0 ]; then
  echo "PASS: gate tests passed=$PASSED"
  exit 0
fi
echo "FAIL: gate tests failed=$FAILED passed=$PASSED"
exit 1
