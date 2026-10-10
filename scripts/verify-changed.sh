#!/usr/bin/env bash
# scripts/verify-changed.sh [base]: the fast check while iterating (docs/specs/session-speed.md).
# Typecheck and tests for the workspace packages this branch touches (and the packages that depend
# on them), the ops and functions suites only when their folders changed, then the cheap repo-wide
# checks. `pnpm verify` stays the floor before a push; this is not a substitute for it.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
BASE=${1:-origin/main}
CHANGED=$( { git diff --name-only "$BASE"...HEAD; git diff --name-only HEAD; git ls-files --others --exclude-standard; } | sort -u)
echo "verify:changed base=$BASE files=$(printf '%s\n' "$CHANGED" | grep -c . || true)"
pnpm -r --if-present --filter "...[$BASE]" typecheck
pnpm -r --if-present --filter "...[$BASE]" test
if printf '%s\n' "$CHANGED" | grep -q '^platform/ops/'; then pnpm test:ops; fi
if printf '%s\n' "$CHANGED" | grep -q '^platform/supabase/functions/'; then pnpm test:functions; fi
if printf '%s\n' "$CHANGED" | grep -q '^platform/agents/'; then pnpm test:agents; fi
pnpm secret-scan
pnpm test:docs
pnpm test:rename
echo "verify:changed PASS"
