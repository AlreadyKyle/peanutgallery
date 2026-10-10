# Frames determinism

Status: built. Card: none. Owner: board.

Draft: written, not yet agreed by the board. Agreed: the contract for the work. Built: merged, and every criterion a test can prove is ticked; live verification is still to run. Done: every Verification line has been run and its output quoted. A criterion replaced by a later spec is struck through and names that spec.

## Problem

The gate's frames job failed about one run in five with "two draws of the same state differ" (and, on card 56f2c598, "two draws of the page differ") on changes that cannot touch the game's pixels: a two-string config rename failed at its merge sha and passed on a re-run, and main's own gate on the revert went red. Each failure rejected a good card or held main red, and while main is red the dispatcher claims no card.

The cause is in the harness, `seed-1/e2e/frames.spec.ts`, not in the game. Playwright's page clock replays the harness's two calls, `install` then `pauseAt`, in each new document, and moves its tick count (the page's `performance.now()`, which Phaser and the clock's animation frames run on) by the real milliseconds that passed between the two calls in the test process: a different few each draw. The clock fires animation frames on a 16 ms grid of ticks (`16 - ticks % 16`), so the harness's jump of a fixed time put each draw at a different place on the grid. A draw that paused at tick 2 ran 189 frames from the jump to the end of the 3 seconds; one that paused at tick 14 ran 188, with different gaps, so the sim stepped 3.018 seconds in one and 3.006 in the other, and the game drew a different amount of dust. At 0 seconds that moved the progress bar's anti-aliased end: 7 pixels in one column (x 21, y 266 to 272) differed. The 375px page holds the same canvas, so it differed the same way. The harness's own comment held that the jump made every draw run the same frames; it fixed Phaser's first gap, not the grid.

## Scope

In: the frames spec's draw (`seed-1/e2e/frames.spec.ts`), a kernel file, changed by the board.
Out: the game (`seed-1/render`, `seed-1/sim`), the Playwright config, the gate workflow, `frames-diff.sh` and the dispatcher's visual review. No tolerance: the check stays byte-identical.

## Behaviour

After the page has loaded and asked for its first animation frame, the draw reads the paused clock's tick and time from the page and jumps the clock to a fixed tick, 1,000, whatever tick it paused at, then runs it 3 seconds as before. Every draw of the same build then runs the same frames at the same ticks, steps the sim by the same amount and draws the same pixels. A draw that paused past tick 983, where the jump would be shorter than Phaser's steady step, stops with an error naming the tick instead of drawing a different frame. Each draw also counts the animation frames the game asked for, and the two draws of a state must ask for the same number before their pixels are compared, so a timing fault reads as one.

## Acceptance criteria

- [x] Two draws whose clocks paused at different ticks run the same frames at the same ticks, end in the same sim state and draw byte-identical canvases.
- [x] The frames spec, run 30 times over (`--repeat-each=30`), passes every draw comparison: the four canvas states and the 375px page.
- [x] The game, the Playwright config and the gate workflow are unchanged; the comparison stays byte-for-byte.

## Verification

- `pnpm --filter @backseat/seed-1 typecheck` and `pnpm --filter @backseat/seed-1 test`
- In `seed-1`, with `E2E_FRAME_STATES` from `pnpm exec tsx e2e/frame-states.ts <folder>/frame-states.json`: `E2E_PORT=<port> E2E_FRAME_STATES=<folder>/frame-states.json pnpm exec playwright test e2e/frames.spec.ts --repeat-each=<n> --workers=3`, on the spec before the change and after it.
- `pnpm verify`

## Evidence

2026-10-10, on this Mac under heavy load (load average 170 to 240 on 8 cores, other sessions running), Playwright 1.63.0, Phaser 3.90.0.

- Before the change, the spec as on main (`--repeat-each=6`, 42 tests): `12 failed`, `30 passed (10.3m)`. Of the 30 draw comparisons, 9 failed on pixels (7 "two draws of the same state differ", at 0, 3,600 and 21,600 s, and 2 "two draws of the page differ"), 3 timed out at 120 s under the load before comparing, and 18 passed. An earlier single run of the spec failed 3,600 and 21,600 s.
- Diagnostic draw pairs with the harness as on main. At 0 s, the clocks paused at ticks 2 and 14: 189 and 188 frames, the sim's `elapsedSeconds` 3.0177 and 3.0057, and 7 pixels differed (one column, the progress bar's end). At 21,600 s, ticks 3 and 13: 189 and 188 frames, and 163 pixels differed (the dust count's last digits, 9,690 against 9,620).
- The same diagnostic with the fixed tick, clocks paused at ticks 39 and 12, then 30 and 37: both pairs ran 189 frames from tick 1,000 to 4,000, ended in the same sim state and drew byte-identical canvases.
- After the change (`--repeat-each=30 --workers=3 --timeout=300000`, the same machine and load): `210 passed (32.1m)`, 0 failed: all 150 draw comparisons (120 canvas, 30 page) byte-identical, each pair with the same frame count. The slowest test took 1.1 minutes, under the default 120 s timeout, so the raised timeout changed nothing.
- `pnpm --filter @backseat/seed-1 typecheck`: clean; `pnpm --filter @backseat/seed-1 test`: `Tests  83 passed (83)`; `pnpm test:docs`: `pass 22`, `fail 0`; `pnpm verify`: exit 0 (`GATE PASS folder=seed-1 lane=code`, `GATE PASS folder=platform lane=code`, `PASS: secret-scan files=762`).
- The gate on pull request #145 (run 38077415576, head `bad727b`): the change's draw passed `7 passed` on all three attempts. The base's draw, which runs main's spec, failed attempts 1 and 2 ("two draws of the same state differ" at 21,600 s, and the page on attempt 2). Attempt 3 passed, and the gate passed. `frames-diff.sh` kept one frame, game-21600, whose dust count read …909,697 on the base and …909,711 on the change: the two harnesses step the sim a different amount, so a real difference between them is expected.

## Decisions

- 2026-10-10: fix the harness's clock, not the comparison (the board). The two draws differed by a whole frame of game time, which a pixel tolerance would have had to hide in the frames the visual review reads; a fixed first tick removes the difference.
