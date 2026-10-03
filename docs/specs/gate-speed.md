# Gate speed

Status: agreed. Card: none. Owner: board.

Draft: written, not yet agreed by the board. Agreed: the contract for the work. Built: merged, and every criterion a test can prove is ticked; live verification is still to run. Done: every Verification line has been run and its output quoted. A criterion replaced by a later spec is struck through and names that spec.

## Problem

Every merge waits on the gate, and the gate had grown to 15 to 18 minutes on Actions and about 10 on the Mac. The site's end-to-end suite was most of it: 515 to 579 seconds of the platform job on Actions, run on one worker (the private repository's runner has two vCPUs and Playwright takes half the cores by default), and 4.0 minutes locally, where layout-balance.spec.ts (230 s) and design.spec.ts (190 s) each ran on a single worker because Playwright runs one file's tests in order. Separately, a pull request that changed only BOARD-SETUP.md or CLAUDE.md (#106, #111, #112, #113) ran the full suite, because changed-paths.sh counted every root file as workspace-level.

## Scope

In: Playwright parallelism in platform/site and platform/board; a stricter readiness check in layout-balance.spec.ts; changed-paths.sh flags for CLAUDE.md, README.md and BOARD-SETUP.md; the gate's run time in CLAUDE.md and ROADMAP.md.
Out: gate.yml's jobs (splitting the end-to-end suite into its own job), the gate run on a push to main, a Deno dependency cache, seed-1's Playwright config (its frames render on the CPU through SwiftShader, so two vCPUs gain little). No test or check is removed.

## Behaviour

The site and board suites spread tests, not files, across workers: two on Actions (`CI` set), half the cores locally, no retries, so a test that fails under load fails the gate. The frames job's site draws use the same config. The layout audit fails a data route (routes.ts `isDataRoute`) that is still loading after its wait, as route-shots.spec.ts already does, instead of auditing it half-drawn.

changed-paths.sh gives CLAUDE.md and README.md at the root the flags docs/ gets (platform only), and BOARD-SETUP.md platform and functions, since the Deno test site_snapshot_test.ts runs its pause statement. Only those three root names; every other root path still selects every job. A CLAUDE.md inside a folder follows its folder's rule.

## Acceptance criteria

- [ ] The site suite lists the same 268 tests before and after.
- [ ] Site and board configs set `fullyParallel: true`, `workers: process.env.CI ? 2 : undefined` and `retries: 0`.
- [ ] The suite passes three times over at two workers with `CI` set and at eight workers, with no failure and no flaky test.
- [ ] layout-balance.spec.ts fails a data route still marked `aria-busy="true"`.
- [ ] changed-paths.sh prints `seed=false platform=true lane=code site=false functions=false` for CLAUDE.md and README.md, `functions=true` for BOARD-SETUP.md, and every flag for any other root file; the gate tests carry each case.
- [ ] The Actions gate on this pull request runs the site suite on 2 workers and its platform job is shorter than run 37026284476's (13.5 minutes).

## Verification

- `cd platform/site && E2E_PORT=4410 npx playwright test --list | tail -1` on main and on the branch
- `E2E_PORT=4410 npx playwright test` (wall time against the 4.0 minute baseline)
- `CI=1 E2E_PORT=4411 npx playwright test --repeat-each=3` and `E2E_PORT=4412 npx playwright test --workers=8 --repeat-each=3`, run at the same time
- `BOARD_E2E_PORT=4413 pnpm --filter @backseat/board e2e`
- `bash platform/gate/changed-paths.sh 1860d87 845d90e` (#113, BOARD-SETUP.md and CLAUDE.md) and `pnpm --filter @backseat/gate test`
- `pnpm verify`
- The Actions gate run on the pull request: the platform job's "Running 268 tests using 2 workers" line and its job times

## Evidence

## Decisions

- 2026-10-03: two workers on Actions, one per vCPU, and no retries. More workers than vCPUs would trade speed for flakes; a retry would hide a flake the board should see.
- 2026-10-03: name the three root documents rather than match `*.md`: a shell `case` `*` matches `/`, and a root file no rule names must keep selecting every job.
