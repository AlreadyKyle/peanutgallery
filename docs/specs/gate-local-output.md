# The gate's scans skip the e2e runs' local output

Status: built. Card: none. Owner: board.

## Problem

`pnpm verify` failed on a machine that had run the site's or the board's end-to-end suite. Those runs leave their own build in `platform/site/dist-e2e` and `platform/board/dist-e2e` (and optional screenshots in `platform/site/e2e-screenshots`), gitignored, and the gate's `runtime-token-deny` step walked into them and failed on the libraries' own strings in the bundles (`FAIL: runtime-token-deny hits=12 first=platform/board/dist-e2e/assets/index-….js:1 pattern=object-object`). A CI checkout never has these folders, so only local runs broke, and the fix people reached for was deleting the folders by hand.

## Scope

In: the folders the gate's source scans never walk (`platform/gate/lib/common.sh`: `gate_find_files` and `gate_find_paths`, used by `runtime-token-deny.sh`, `banned-phrases.sh` and the working-tree secret scan), and a guard in `runtime-token-deny.sh` so pruning by name hides nothing a commit can carry.

Out: the payment-host scan and `runtime-token-deny-dist`, which already read only the `dist` folder the gate's own build step writes (`ship-gate.sh` phase build), so a stray `dist-e2e` never reached them. The tracked secret scan (`secret-scan.sh --tracked`), which reads every tracked file and is unchanged.

## Behaviour

- The scans prune `dist-e2e` and `e2e-screenshots` by name, beside the output folders they already pruned (`dist`, `coverage`, `test-results`, `playwright-report`, `.worktrees`) and `node_modules` and `.git`. The list lives once in `GATE_PRUNED_NAMES`.
- `runtime-token-deny.sh` fails any file git tracks inside an output folder in its scope (`dist`, `dist-e2e`, `e2e-screenshots`, `coverage`, `test-results`, `playwright-report`) as `pattern=tracked-build-output`. Pruning by name therefore cannot hide committed text: a card that force-adds a file into one of those folders fails the gate's scans phase, which runs before any card code. Outside a git work tree the check prints nothing.
- No tracked file sits in any of those folders today (`git ls-files | grep -E '(^|/)(dist|dist-e2e|e2e-screenshots|coverage|test-results|playwright-report)/'` prints nothing), so the guard fails nothing that passes now.

## Acceptance criteria

- [x] With `platform/site/dist-e2e` and `platform/board/dist-e2e` present from a local e2e run, `pnpm verify` exits 0.
- [x] An untracked `dist-e2e` or `e2e-screenshots` folder carrying denied tokens is not read, by `--folder platform` or by a folder argument.
- [x] A tracked file in `dist-e2e`, or in any other pruned output folder, fails `runtime-token-deny` as `tracked-build-output`.
- [x] The new gate tests fail against the scripts on `main` before this change and pass after it.

## Verification

- `bash platform/gate/test/run-tests.sh`
- The same suite with `main`'s `lib/common.sh` and `runtime-token-deny.sh` put back in place.
- `E2E_PORT=4398 pnpm --filter @backseat/site e2e`, `BOARD_E2E_PORT=4397 pnpm --filter @backseat/board e2e`, then `pnpm verify` with both `dist-e2e` folders left in place.

## Evidence

- `bash platform/gate/test/run-tests.sh`: `PASS: gate tests passed=504`.
- With `main`'s two scripts in place: `FAIL: gate tests failed=5 passed=499`; the five failures are the new tests, for example `FAIL tokens: the e2e runs' local builds and screenshots are not read: exit 1 (wanted 0), first line: FAIL: runtime-token-deny hits=4 first=platform/board/dist-e2e/assets/index-a1.js:1 pattern=object-object`.
- Site e2e `28 passed`, board e2e `4 passed`; `ls -d platform/*/dist-e2e` printed both folders; then `pnpm verify` exited 0 with `PASS: runtime-token-deny files=146`, `GATE PASS folder=platform lane=code`, `GATE PASS folder=seed-1 lane=code`, site 209, board 67, supabase 267, seed-1 77, dispatcher 619, functions 82, docs 15.

## Decisions

- 2026-09-23: prune by name, as the gate already does for `dist` and the test-output folders, rather than skip gitignored paths through git: the scans also run outside a git work tree (the gate tests' fixtures), and one list of names is simpler to read and test. The tracked-output guard closes the gap pruning by name would otherwise leave.
