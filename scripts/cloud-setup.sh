#!/usr/bin/env bash
# scripts/cloud-setup.sh: the SessionStart hook (.claude/settings.json). It does nothing on the Mac;
# in a Claude Code cloud session (CLAUDE_CODE_REMOTE=true) it installs what `pnpm verify` and the e2e
# specs need: the workspace packages, Deno at the version the gate workflow pins, and Playwright's
# Chromium (docs/specs/session-speed.md).
set -euo pipefail
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "$(git rev-parse --show-toplevel)"
DENO_VERSION=v2.7.13
pnpm install --frozen-lockfile
if ! command -v deno > /dev/null || [ "v$(deno --version | head -1 | awk '{print $2}')" != "$DENO_VERSION" ]; then
  curl -fsSL https://deno.land/install.sh | DENO_INSTALL="$HOME/.deno" sh -s -- "$DENO_VERSION" -y > /dev/null
  [ -n "${CLAUDE_ENV_FILE:-}" ] && echo "export PATH=\"$HOME/.deno/bin:\$PATH\"" >> "$CLAUDE_ENV_FILE"
fi
pnpm --filter @backseat/site exec playwright install --with-deps chromium
