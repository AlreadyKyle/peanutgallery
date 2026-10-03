# Gate speed

Status: built. Card: none. Owner: board.

Draft: written, not yet agreed by the board. Agreed: the contract for the work. Built: merged, and every criterion a test can prove is ticked; live verification is still to run. Done: every Verification line has been run and its output quoted. A criterion replaced by a later spec is struck through and names that spec.

## Problem

Every merge waits on the gate, and the gate had grown to 15 to 18 minutes on Actions and about 10 on the Mac. The site's end-to-end suite was most of it: 515 to 579 seconds of the platform job on Actions, run on one worker (the private repository's runner has two vCPUs and Playwright takes half the cores by default), and 4.0 minutes locally, where layout-balance.spec.ts (230 s) and design.spec.ts (190 s) each ran on a single worker because Playwright runs one file's tests in order. Separately, a pull request that changed only BOARD-SETUP.md or CLAUDE.md (#106, #111, #112, #113) ran the full suite, because changed-paths.sh counted every root file as workspace-level.

## Scope

In: Playwright parallelism in platform/site and platform/board; a stricter readiness check in layout-balance.spec.ts; the polling tests in snapshot.spec.ts and thanks.spec.ts made safe under load, with an in-page fetch probe (e2e/fetch-probe.ts); changed-paths.sh flags for CLAUDE.md, README.md and BOARD-SETUP.md; the gate's run time in CLAUDE.md and ROADMAP.md.
Out: gate.yml's jobs (splitting the end-to-end suite into its own job), the gate run on a push to main, a Deno dependency cache, seed-1's Playwright config (its frames render on the CPU through SwiftShader, so two vCPUs gain little). No test or check is removed.

## Behaviour

The site and board suites spread tests, not files, across workers: two on Actions (`CI` set), half the cores locally, no retries, so a test that fails under load fails the gate. The frames job's site draws use the same config. The layout audit fails a data route (routes.ts `isDataRoute`) that is still loading after its wait, as route-shots.spec.ts already does, instead of auditing it half-drawn.

changed-paths.sh gives CLAUDE.md and README.md at the root the flags docs/ gets (platform only), and BOARD-SETUP.md platform and functions, since the Deno test site_snapshot_test.ts runs its pause statement. Only those three root names; every other root path still selects every job. A CLAUDE.md inside a folder follows its folder's rule.

## Acceptance criteria

- [x] The site suite lists the same 268 tests before and after.
- [x] Site and board configs set `fullyParallel: true`, `workers: process.env.CI ? 2 : undefined` and `retries: 0`.
- [x] The suite passes three times over at two workers with `CI` set and at eight workers, with no failure and no flaky test.
- [x] layout-balance.spec.ts fails a data route still marked `aria-busy="true"`.
- [x] snapshot.spec.ts and thanks.spec.ts move the clock only after the page has acted on each answer, and fail a poll that fires early or late.
- [x] changed-paths.sh prints `seed=false platform=true lane=code site=false functions=false` for CLAUDE.md and README.md, `functions=true` for BOARD-SETUP.md, and every flag for any other root file; the gate tests carry each case.
- [x] The Actions gate on this pull request runs the site suite on 2 workers and its platform job is shorter than run 37026284476's (13.5 minutes).

## Verification

- `cd platform/site && E2E_PORT=4410 npx playwright test --list | tail -1` on main and on the branch
- `E2E_PORT=4410 npx playwright test` (wall time against the 4.0 minute baseline)
- `CI=1 E2E_PORT=4411 npx playwright test --repeat-each=3` and `E2E_PORT=4412 npx playwright test --workers=8 --repeat-each=3`, run at the same time
- `BOARD_E2E_PORT=4413 pnpm --filter @backseat/board e2e`
- `bash platform/gate/changed-paths.sh 1860d87 845d90e` (#113, BOARD-SETUP.md and CLAUDE.md) and `pnpm --filter @backseat/gate test`
- `pnpm verify`
- The Actions gate run on the pull request: the platform job's "Running 268 tests using 2 workers" line and its job times

## Evidence

- Same tests: `npx playwright test --list | tail -1` on main b4fd091 and on the branch: `Total: 268 tests in 16 files`.
- Local site suite, before: `260 passed (4.0m)` (local gate log pr113-845d90e, 4 workers). After, on the branch: `260 passed (2.4m)`, `real 148.80`, with the gate tests running at the same time.
- Stress, the two runs at the same time (ten Chromium workers on eight cores): `Running 804 tests using 2 workers` … `24 skipped` `780 passed (13.1m)`, exit 0; `Running 804 tests using 8 workers` … `24 skipped` `780 passed (3.9m)`, exit 0. No failed and no flaky test.
- Board suite: `Running 9 tests using 4 workers` `9 passed (4.3s)`.
- Detect on #113's range: `bash platform/gate/changed-paths.sh 1860d87 845d90e` prints `seed=false platform=true lane=code site=false functions=true render=false` (it ran every job before). Gate tests: `PASS: gate tests passed=678` (672 before; the new rows are CLAUDE.md, README.md, BOARD-SETUP.md, seed-1/CLAUDE.md, docs/CLAUDE.md and .env.example, and the generic root fixture is now tsconfig.base.json).
- `pnpm verify` exit 0: dispatcher 872, site 529, supabase 325, board 103, seed-1 83, explainer 14, gate 678.
- Actions gate run 37140619071 on head a983996, success in 13.9 minutes: platform `Running 268 tests using 2 workers` `260 passed (5.6m)`, site end-to-end step 339 s (515 s in run 37026284476 and 579 s in run 36951019779, both on one worker); platform job 12.9 minutes (13.5 and 16.3); frames job 4.3 minutes (8.9), its change draw `Running 9 tests using 2 workers` `9 passed (1.4m)` and its base draw, on main's config, `using 1 worker` `9 passed (2.1m)`. The platform job's other steps ran slower than in the earlier runs (typecheck and tests 160 s against 103 s, Deno tests 108 s against 65 s), so the job shrank less than the suite did; those steps, about 6.5 minutes, are now most of the platform job.

## Decisions

- 2026-10-03: two workers on Actions, one per vCPU, and no retries. More workers than vCPUs would trade speed for flakes; a retry would hide a flake the board should see.
- 2026-10-03: name the three root documents rather than match `*.md`: a shell `case` `*` matches `/`, and a root file no rule names must keep selecting every job.
- 2026-10-03: the second gate run on this pull request (run 37141646498, head 7a4d53d) failed one test: snapshot.spec.ts's 60-second read counted the second /api/live request as soon as it was sent and moved the fake clock, but the site schedules the next read only once a load is drawn (studio.tsx), so on a loaded runner the clock moved before the timer existed (`Expected: 3, Received: 2`). A race in the test, not the site: each answer now carries a new balance and the clock moves only after the page shows it. 90 of 90 passed at eight workers, fifteen times over.
- 2026-10-03: the third run (37142574481, head 7cc6640) failed the same way in thanks.spec.ts (`Expected: 35, Received: 34`): /thanks also asks again only once an answer is handled (thanks.ts), and nothing on the page changes while it stays pending. e2e/fetch-probe.ts now counts, inside the page, each fetch of a path as it is called and each answer the page has finished acting on (a task posted when the answer's JSON is read runs only after the page's own handling). Both polling tests wait on it before moving the clock, and check in the page that no read fires early: 4.5 of the 5 seconds on /thanks, 55 of the 60 on home. Mutations of the poll intervals, run on the built site: 4 s and 50 s fail both tests, 6 s and 70 s fail both tests, the real 5 s and 60 s pass. Before this the tests could not tell a 4-second poll from a 5-second one. Stress: thanks, snapshot and card specs fifteen times over at eight workers, `510 passed (1.7m)`, at the same time as the whole suite twice over at two workers with `CI` set, `16 skipped` `520 passed (8.4m)`.
