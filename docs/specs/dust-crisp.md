# Dust draws sharp

Status: built. Card: none. Owner: board.

Draft: written, not yet agreed by the board. Agreed: the contract for the work. Built: merged, and every criterion a test can prove is ticked; live verification is still to run. Done: every Verification line has been run and its output quoted. A criterion replaced by a later spec is struck through and names that spec.

## Problem

Dust drew a 420 by 880 canvas and Phaser's FIT mode stretched it to the window, so text and shapes were blurry, most of all on high-density screens.

## Scope

In: the canvas's pixel density (`seed-1/render`). Out: layout, rules, numbers and input.

## Behaviour

The canvas draws at `RENDER_SCALE` pixels per layout pixel (1.5 times the device pixel ratio, rounded up, at most 4) and the camera zooms by the same factor, so every position and touch target is where it was. Text renders at the same resolution.

## Acceptance criteria

- [x] At device scale 2 the canvas is 1260 by 2640 pixels for 420 by 880 layout pixels.
- [x] Dust's unit tests and e2e pass unchanged.

## Verification

- `npx vitest run` in `seed-1`; `E2E_PORT=4470 pnpm --filter @backseat/seed-1 e2e`

## Evidence

2026-10-06: vitest 83 passed; e2e 7 passed; a 2x screenshot read `canvas 1260x2640 shown 417x874 css`.

## Decisions

- 2026-10-06: fix the blur by drawing denser, not by changing the layout (the board).
