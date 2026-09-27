# Mobile-first games

Status: built. Card: none. Owner: board.

## Problem

The board ordered on 27 September 2026 that when a new game is built, its very first version is mobile friendly. Dust itself fell short on a phone: its unlock list sat below space reserved for every unit, locked ones included, so a new player saw a large empty band between Units and Unlocks, and its Buy buttons were about 34px tall on a 375px phone.

## Scope

In: the rule in `docs/PLAN.md` (§4 Work, Next game; §10 decision 56) and in seed-1's pillars; Dust's unlock section and Buy buttons.
Out: the next seed's harness itself, which the board writes with that seed's folder and which measures the rule in its gate. `docs/BACKLOG.md`'s next-game entry is unchanged, so no production backlog write is needed; the PLAN rule governs it.

## Behaviour

- A new game's first version, prototypes included, fits a 375 by 812 portrait phone with no sideways scroll, every control is at least a 44px touch target there, and no action needs a hover or a keyboard.
- In Dust, the Unlocks section sits directly under the units shown and moves down as each unit opens, with no gap for locked units.
- Dust's unit rows are 64 units tall and its Buy buttons 50, which is 44.6px on a 375px phone (the 420-wide canvas scales by 375/420).

## Acceptance criteria

- [x] PLAN.md §4 Next game and §10 decision 56 state the rule; seed-1's CLAUDE.md pillars carry it.
- [x] At 0 seconds, the page frame at 375px shows Unlocks directly under the one Gatherer row (`page-375.png`); at 3,600 seconds all five units show with Unlocks under them (`game-3600.png`).
- [x] The Buy button is 50 of the canvas's 420 units tall, 44.6px at 375px.
- [ ] The game's live site draws the new layout after the deploy.

## Verification

- `pnpm --filter @backseat/seed-1 typecheck`, `test`, `build`, and `E2E_PORT=4191 E2E_FRAMES=<dir> pnpm --filter @backseat/seed-1 e2e`.
- `pnpm verify`
- The live game at https://peanutgallery-seed-1.netlify.app at 375px after the deploy.

## Evidence

- `pnpm --filter @backseat/seed-1 test`: `Tests 77 passed (77)`; typecheck clean; `build`: `✓ built in 478ms`.
- `E2E_PORT=4191 E2E_FRAMES=… pnpm --filter @backseat/seed-1 e2e`: `7 passed (22.5s)`. The frames were looked at: `page-375.png` shows Unlocks under the Gatherer row with no band; `game-3600.png` shows Gatherer, Cart, Mill, Forge and Foundry, then Unlocks.

- `npm_config_workspace_concurrency=1 pnpm verify` on this branch: exit 0 (board 103, supabase 325, site 531, seed-1 77, dispatcher 861, agents 142, ops 135, functions 130, `GATE PASS folder=seed-1 lane=code`, `GATE PASS folder=platform lane=code`).

## Decisions

- 27 September 2026: the board ordered mobile-first for every new game's first version. Recorded as PLAN.md §10 decision 56.
