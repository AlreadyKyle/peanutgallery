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
# Deno comes from npm: the cloud environment's default (Limited) network allows the package registries
# but not deno.land. The installer from deno.land is the fallback for an environment that allows it.
deno_ok() { command -v deno > /dev/null && [ "v$(deno --version | head -1 | awk '{print $2}')" = "$DENO_VERSION" ]; }
if ! deno_ok && ! npm install -g "deno@${DENO_VERSION#v}" > /dev/null 2>&1; then
  if curl -fsSL https://deno.land/install.sh | DENO_INSTALL="$HOME/.deno" sh -s -- "$DENO_VERSION" -y > /dev/null; then
    [ -z "${CLAUDE_ENV_FILE:-}" ] || echo "export PATH=\"$HOME/.deno/bin:\$PATH\"" >> "$CLAUDE_ENV_FILE"
  else
    echo "cloud-setup: Deno $DENO_VERSION not installed; pnpm test:functions will fail" >&2
  fi
fi
# The cloud image ships Chromium under PLAYWRIGHT_BROWSERS_PATH; download it only when it is missing.
if ! ls "${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"/chromium-* > /dev/null 2>&1; then
  pnpm --filter @backseat/site exec playwright install --with-deps chromium \
    || echo "cloud-setup: Playwright Chromium not installed; e2e will fail" >&2
fi
