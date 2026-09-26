#!/bin/bash
# The Claude Code pin (docs/specs/agent-upkeep.md, R33). The board runs this once, in Terminal, from
# its own account:
#   cd ~/GitHub/peanutgallery && sudo bash platform/ops/mac/pin-claude-code.sh
# It refuses unless it runs as root through sudo and the Claude Code installed for the account that
# ran sudo is the version claude-code-pin.json names (the version its sandbox:check --positive PASS
# line was recorded on). It then sets env.DISABLE_AUTOUPDATER to "1" in Claude Code's managed
# settings, keeping every other key, so the CLI stops updating itself. The file is root-owned at mode
# 0644: Claude Code reads it, and only an administrator can change it. The dispatcher's attended
# adapter refuses any other version before every session; a new version is a board pull request that
# updates the pin with a fresh PASS line on it. CLAUDE_MANAGED_DIR points it elsewhere (the tests).
set -eu

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIN_FILE="$HERE/claude-code-pin.json"
MANAGED_DIR="${CLAUDE_MANAGED_DIR:-/Library/Application Support/ClaudeCode}"
SETTINGS="$MANAGED_DIR/managed-settings.json"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

[ "$(id -u)" = 0 ] || fail "run it as root, from your own account: sudo bash platform/ops/mac/pin-claude-code.sh"
user="${SUDO_USER:-}"
if [ -z "$user" ] || [ "$user" = root ]; then
  fail "run it with sudo from your own account, so Claude Code's version is read as you"
fi

# node reads and writes the JSON; root's PATH may not hold Homebrew's.
node_bin="$(command -v node || true)"
for candidate in /opt/homebrew/bin/node /usr/local/bin/node; do
  if [ -z "$node_bin" ] && [ -x "$candidate" ]; then node_bin="$candidate"; fi
done
[ -n "$node_bin" ] || fail "node is not installed where root can find it"

pinned="$("$node_bin" -e '
const pin = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
if (typeof pin.version !== "string" || !/^\d+\.\d+\.\d+$/.test(pin.version)) throw new Error("no version");
if (typeof pin.sandbox_check !== "string" || !pin.sandbox_check.includes("PASS") || !pin.sandbox_check.includes(pin.version)) {
  throw new Error("its sandbox_check is not a PASS line on its version");
}
process.stdout.write(pin.version);
' "$PIN_FILE")" || fail "the pin $PIN_FILE could not be read"

# Claude Code as the account that ran sudo sees it: on its PATH, or the native installer's place.
claude_bin="$(command -v claude || true)"
if [ -z "$claude_bin" ] && [ -x "/Users/$user/.local/bin/claude" ]; then claude_bin="/Users/$user/.local/bin/claude"; fi
[ -n "$claude_bin" ] || fail "claude is not installed where root can find it"
installed="$(sudo -u "$user" "$claude_bin" --version 2> /dev/null | sed -nE '1s/^[^0-9]*([0-9]+\.[0-9]+\.[0-9]+).*/\1/p' || true)"
if [ "$installed" != "$pinned" ]; then
  fail "Claude Code ${installed:-of no known version} is installed but the pin is $pinned. Install $pinned (claude install $pinned), or update the pin in a board pull request with a fresh sandbox:check --positive PASS line on the installed version, then run this again."
fi

mkdir -p "$MANAGED_DIR"
tmp="$(mktemp "$MANAGED_DIR/.managed-settings.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
"$node_bin" -e '
const fs = require("fs");
const [file, out] = process.argv.slice(1);
const settings = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
if (typeof settings !== "object" || settings === null || Array.isArray(settings)) throw new Error("the settings are not a JSON object");
const env = settings.env === undefined ? {} : settings.env;
if (typeof env !== "object" || env === null || Array.isArray(env)) throw new Error("its env is not a JSON object");
settings.env = { ...env, DISABLE_AUTOUPDATER: "1" };
fs.writeFileSync(out, JSON.stringify(settings, null, 2) + "\n");
' "$SETTINGS" "$tmp" || fail "$SETTINGS could not be read as JSON; it is left as it was"
chown root:wheel "$tmp"
chmod 0644 "$tmp"
mv -f "$tmp" "$SETTINGS"
trap - EXIT
echo "PASS: claude-code pinned $pinned"
