#!/usr/bin/env bash
# scripts/verify.sh: `pnpm verify`, the floor before a push (docs/specs/session-speed.md). The checks
# are independent, so they run at once, each into its own log; the run fails if any check fails and
# prints that check's log tail. The gate dry-runs run the gated packages' typecheck and tests
# (seed-1, dispatcher, supabase, site, board), so only the explainer is typechecked here and only the
# packages the gate does not cover (explainer, gate) run their tests here; a repo-wide `pnpm typecheck`
# would run each gated package's tsc a second time, at the same moment.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
LOGS=$(mktemp -d "${TMPDIR:-/tmp}/verify.XXXXXX")
started=$SECONDS
CHECKS=(
  "typecheck|pnpm --filter @backseat/explainer typecheck"
  "tests|pnpm --filter @backseat/explainer --filter @backseat/gate test"
  "agents|pnpm test:agents"
  "ops|pnpm test:ops"
  "functions|pnpm test:functions"
  "gate-seed|bash platform/gate/ship-gate.sh --dry-run --folder seed-1 --lane code"
  "gate-platform|bash platform/gate/ship-gate.sh --dry-run --folder platform --lane code"
  "secret-scan|pnpm secret-scan"
  "docs|pnpm test:docs"
  "rename|pnpm test:rename"
  "claude-mod|node --test platform/claude-mod/tests/mod.test.mjs"
)
pids=()
for check in "${CHECKS[@]}"; do
  name=${check%%|*}; cmd=${check#*|}
  ( s=$SECONDS; bash -c "$cmd" > "$LOGS/$name.log" 2>&1; rc=$?; echo "$rc $((SECONDS - s))" > "$LOGS/$name.rc" ) &
  pids+=($!)
done
wait "${pids[@]}"
failed=0
for check in "${CHECKS[@]}"; do
  name=${check%%|*}; read -r rc secs < "$LOGS/$name.rc"
  if [ "$rc" = 0 ]; then echo "verify: $name ok ${secs}s"; else
    echo "verify: $name FAIL exit=$rc ${secs}s (log $LOGS/$name.log)"; tail -30 "$LOGS/$name.log" | sed 's/^/  /'; failed=1; fi
done
if [ "$failed" = 0 ]; then echo "VERIFY PASS $((SECONDS - started))s"; rm -rf "$LOGS"; else echo "VERIFY FAIL $((SECONDS - started))s"; exit 1; fi
