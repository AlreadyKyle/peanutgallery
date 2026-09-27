# Sweep, 27 September: bugs found after the launch series

Status: built. Card: none. Owner: board.

## Problem

A bug hunt over the live site, the Netlify functions, the Stripe webhook, the latest migrations, the dispatcher, the ops scripts and `docs/BOARD-SETUP.md`, after the launch series merged, found one live crash, one money-safety slip in the merge path, two flaky tests and board steps that promise something the scripts cannot do yet. This spec covers only the ones with one obvious fix and no product call.

## Scope

In: the fixes listed under Behaviour.
Out: installing the Mac host's nightly jobs before the dispatcher's env file can be written (it needs the managed agent's ids, which need Console credit); until then a backup runs by hand. A backup job that installs on its own is a backlog item (since built: `jobs-only-install.md`). Out too: a job whose env file is missing alerts every day it runs, which stays as it is, since that alert is how the board hears the job is not running.

## Behaviour

- `/api/card/%E0` and any other malformed percent-escape answer 400 "Not a card id" instead of crashing the function with a 502 (a uuid never needs decoding).
- When GitHub refuses a card's merge because main moved after the merge guard read it (its 405 "Base branch was modified", when the board merges in that gap), the card goes back to funded with `main_moved`, as a move before the guard does, instead of being rejected: a stop the card did not cause never rejects a paid card.
- The two GitHub poll tests give the poll 200 ms, not 30 ms, so a first read slowed by load no longer ends the loop after one read; the dispatcher's tests run with a 20-second test timeout, since its real-git pipeline tests pass 5 seconds under a loaded verify.
- `install.sh --start`, the runbook and `mac-host.md` name the cutover as BOARD-SETUP step 23, not step 8, which is now the Netlify plan check.
- BOARD-SETUP step 3 says what runs before Console credit (the backup login and one backup by hand, which the restore drill uses) and that `install.sh` runs at the cutover; step 19 uses that backup; step 23's kill test says the restarted dispatcher waits up to 5 minutes for the dead process's lease, so a healthchecks.io email then is expected.

## Acceptance criteria

- [x] `/api/card/%E0`, `/api/card/%` and a uuid with `%ZZ` answer 400 with no Supabase call (`platform/site/netlify/card.test.ts`, "answers a malformed percent-escape 400 rather than throwing"; it fails with `URIError: URI malformed` without the fix).
- [x] A merge refused with 405 while main has moved sends the card to funded with `main_moved` (`platform/dispatcher/test/pipeline.test.ts`, "sends a card back to funded when the merge is refused because main moved after the guard"; it fails without the fix). A 409 with main unmoved still rejects with `merge`.
- [x] The GitHub poll tests use a 200 ms deadline; the dispatcher's `test` script passes `--testTimeout=20000`.
- [x] No script or runbook line names BOARD-SETUP step 8 as the cutover.
- [ ] The live site answers `/api/card/%E0` with 400 after the deploy.

## Verification

- `pnpm verify`
- `curl -s -o /dev/null -w '%{http_code}' https://peanutgallery.games/api/card/%E0` prints `400`.
- `node platform/site/scripts/live-check.mjs` passes.

## Evidence

- `npx vitest run netlify/card.test.ts` in `platform/site`: `Tests 15 passed (15)`; with `card.mts` stashed: `URIError: URI malformed`, `Tests 1 failed | 14 passed (15)`.
- `npx vitest run test/pipeline.test.ts -t "main moved after the guard"` with `pipeline.ts` stashed: `Tests 1 failed | 86 skipped (87)`.
- `pnpm --filter @backseat/dispatcher test`: `Test Files 49 passed (49)`, `Tests 861 passed (861)`.
- `node --test platform/ops/test/ops.test.mjs`: `pass 135`, `fail 0`.
- Before the fix, production: `curl https://peanutgallery.games/api/card/%E0` answered 502.
