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
# The packages to check come from $CHANGED, not from pnpm's own "...[$BASE]" selector: in a linked
# worktree (where `.git` is a file) pnpm reads the main checkout's repository instead, sees no change
# under the worktree's paths and checks nothing ("No projects matched the filters"). Each touched
# package is selected with its dependents; a change to the lockfile or a shared root file selects all.
FILTERS=()
if printf '%s\n' "$CHANGED" | grep -qxE 'pnpm-lock.yaml|pnpm-workspace.yaml|tsconfig.base.json|package.json'; then
  FILTERS=(--filter '*')
else
  for dir in $(sed -n 's/^  - //p' pnpm-workspace.yaml); do
    if printf '%s\n' "$CHANGED" | grep -q "^$dir/"; then FILTERS+=(--filter "...{./$dir}"); fi
  done
fi
if [ ${#FILTERS[@]} -gt 0 ]; then
  echo "verify:changed packages: ${FILTERS[*]}"
  pnpm -r --if-present "${FILTERS[@]}" typecheck
  pnpm -r --if-present "${FILTERS[@]}" test
else
  echo "verify:changed packages: none touched"
fi
if printf '%s\n' "$CHANGED" | grep -q '^platform/ops/'; then pnpm test:ops; fi
if printf '%s\n' "$CHANGED" | grep -q '^platform/supabase/functions/'; then pnpm test:functions; fi
if printf '%s\n' "$CHANGED" | grep -q '^platform/agents/'; then pnpm test:agents; fi
pnpm secret-scan
pnpm test:docs
pnpm test:rename
echo "verify:changed PASS"
