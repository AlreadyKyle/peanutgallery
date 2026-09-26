# Grid boxes: one size for every item in a grid

Status: built. Card: none. Owner: board.

Series position: first in the rest of the launch series, before studio-reports (the order is in `docs/ROADMAP.md`, "The launch series"). The board ordered it on 26 September 2026. It is a board pull request: it changes the layout audit and site styles.

## Problem

- On /team the Running section draws seven agents as three boxes and then two rows of two stretched to half the page (measured live at 1440px: 368, 368, 368, then 564 ×4). The cause is the "fill rule" (`platform/site/src/styles.css`, "The fill rule"; `platform/site/DESIGN.md` "Grid fill"), which widens the last two or four items of a grid so no cell is left empty.
- "Starts later" and "Planned" flow down CSS columns (`.team-coming`), so their tiles are uneven heights and the section reads as a ragged list, not a team.
- The agents are plain rows with no box, so the page has no shape.
- The board, 26 September 2026: "just have each team member in the same sized box. don't stretch them out to fit a row. looks really bad right now." Asked whether this covers the game-card grids too, the board answered yes, every grid on the site; asked whether roles still to come share the running agents' box, the board answered one box size for all.

## Scope

In:
- Every grid of like items on the public site (`.card-grid`, `.team-grid`, `.fill-grid`, the team strip): one item per cell, one width for every item, no spans, no only-child exception.
- /team: every member (Running, Starts later, Planned) in the same box.
- The layout audit's grid rule, its self-test, the unit tests that pin the fill rule, and the docs and agent prompt that state it.

Out:
- The board's own site (`platform/board`): it has no fill rule and imports none of the public site's CSS.
- The game-card component itself (`Card.tsx`), its subgrid rows and its 2px ink edge.
- Any change to what a section shows or in what order.

## Behaviour

1. **One cell per item.** A grid of like items has one column on a phone, two from 48rem and three from 72rem. Every item is exactly one column wide, so every item in a grid has the same width. Rows fill from the left; the last row may be part-empty. Nothing spans two columns, and a lone item is one cell wide, not the reading measure. The order never changes.
2. **Team boxes.** Each `li.agent` is a box: a 1px hairline edge (`--hairline`), the standard radius (`--radius`) and `--space-3` padding. It is not a game card: a card keeps its 2px ink edge and `--radius-card`. The avatar sits beside the name and the "AI agent" line; the description and the foot (the facts line with the Paused tag under it, or the line saying when the role starts) run the full width of the box, and the foot is pinned to the bottom.
3. **One box size.** All three sections of /team use the same grid, so every box on the page has the same width at every breakpoint. From 48rem every box in a section is as tall as the tallest box in that section (grid rows of `1fr`), so boxes in a section are identical in size. Heights are equal within a section, not across sections: a role still to come holds about half the lines of a running agent, and making it as tall would leave an empty half-box. Roles still to come keep the asleep pose and their smaller avatar.
4. **The team strip** on home is three equal columns from 48rem, whether one, two or three members are shown.
5. **Examples.** A lone example card (the design guide's `.example` and `.demo` grids) is one three-column cell wide (`minmax(0, 23rem)`).

## Acceptance criteria

- [x] No rule in `styles.css` whose selector names `.card-grid`, `.team-grid` or `.fill-grid` sets `grid-column: span …` or uses `:only-child`; the tracks are `repeat(2, minmax(0, 1fr))` from 48rem and `repeat(3, minmax(0, 1fr))` from 72rem (unit test).
- [x] `grid-auto-rows: 1fr` is set on `.team-grid` only, never on `.card-grid` (unit test).
- [x] The team strip uses `repeat(3, minmax(0, 1fr))` from 48rem (unit test).
- [x] The `.pair:has(> :only-child)` rule is unchanged (unit test kept).
- [x] /team renders every section as a `ul.team-grid` of `li.agent` boxes; `.team-coming` and `.agent-coming` no longer exist.
- [x] On the default fixture, every `li.agent` on /team has the same width (±1px) at 375, 768 and 1440 (e2e).
- [x] At 768 and 1440, every `li.agent` in a section has the same height (±1px) (e2e).
- [x] The foot of every box lines up across a row (the existing foot-alignment e2e, now covering all three sections).
- [x] The layout audit's "grid fill" check is replaced by "grid cells": it flags an item wider than one column (+1px) and a row whose first item starts more than 2px from the grid's content edge; a part-empty last row passes. Its self-test plants both violations and expects `grid cells:`, and a control page with four items in three columns yields no finding (e2e).
- [x] The layout audit passes on home and /contribute with 1, 2, 4, 5 and 7 open cards at 768, 1024 and 1440 (existing e2e matrix).
- [x] `DESIGN.md`, `platform/agents/prompts/platform-builder.md` (and `platform-director.md`, whose "an empty grid cell" stated it too) and the code comments state the new rule and no longer state the fill rule or "never a bordered tile".
- [x] PLAN.md §10 records the board's order as decision 49.
- [x] `pnpm verify` exits 0; the site e2e passes.
- [ ] Production: after the deploy, live /team measures one width for every box at 375, 768 and 1440 and equal heights within each section from 768; /, /contribute and /roadmap have no item wider than one column; `live-check.mjs` passes (the ship stage).

## Production steps

No migration, no function and no board step. In order:

1. Before merge: the local gate on the pull request's head, from main's checkout (`scripts/local-gate.sh`, PLAN.md §10 decision 44), its PASS line quoted in the squash merge's body.
2. Merge on that PASS. Netlify deploys the site from main.
3. After the deploy: the headless measure of live /team at 375, 768 and 1440 and of /, /contribute and /roadmap, live screenshots of /team and / at 375 and 1440, and `node platform/site/scripts/live-check.mjs`, each quoted in Evidence; then Status done.

Board items: none.

## Verification

- `pnpm verify`
- `E2E_PORT=<your port> pnpm --filter @backseat/site e2e`
- After the deploy: a headless measure of live /team at 375, 768 and 1440 (every `li.agent` one width; equal heights within each section from 768) and of /, /contribute and /roadmap (no item wider than one column), quoted.
- Live screenshots of /team and / at 375 and 1440, looked at.
- `node platform/site/scripts/live-check.mjs` → PASS failed=0.

## Evidence

Built on `launch/grid-boxes` from main at 90be039, run on 26 Sep 2026 in the series worktree.

- `pnpm verify` at the repository root: `exit 0`, with `platform/site test: Test Files  43 passed (43)` / `Tests  501 passed (501)`, `platform/board test: Tests  94 passed (94)`, `platform/dispatcher test: Tests  688 passed (688)`, `platform/supabase test: Tests  309 passed (309)`, `seed-1 test: Tests  77 passed (77)`, `PASS: gate tests passed=524`, functions `ok | 123 passed (202 steps) | 0 failed`, `GATE PASS folder=seed-1 lane=code`, `GATE PASS folder=platform lane=code`, docs `ℹ pass 18` `ℹ fail 0`, `tier 1 carries the old name nowhere`.
- The unit tests (`src/styles.test.ts`, `src/pages/Team.test.tsx`):
  ```
  ✓ no dead space (DESIGN.md) > puts one item in each cell of a card grid, a team grid and a fill grid: no span and no only-child exception
  ✓ no dead space (DESIGN.md) > draws two equal columns from 48rem and three from 72rem for the card, team and fill grids
  ✓ no dead space (DESIGN.md) > makes the team rows 1fr from 48rem, and never a card grid (its cards take four subgrid rows)
  ✓ no dead space (DESIGN.md) > draws the team strip as three equal columns from 48rem, however many members it shows
  ✓ no dead space (DESIGN.md) > boxes each team member with a hairline edge and the standard radius, never a card edge
  ✓ no dead space (DESIGN.md) > draws a lone example card one three-column cell wide
  ✓ no dead space (DESIGN.md) > lets one block of a pair take the row alone, so nothing leaves an empty column
  ✓ Team > draws every section as the same team grid of agent boxes, never a card (the board, 26 Sep 2026)
  ```
- The site e2e (`E2E_PORT=4452`, the package's `playwright test`): `5 skipped` `209 passed (3.9m)`, among them:
  ```
  e2e/team-status.spec.ts › the boxes of each section › end their feet together and line up their Paused tags across each row, in all three sections
  e2e/team-status.spec.ts › every member of the team › sits in one box size: one width on the page, one height in each section from 768px
  e2e/layout-balance.spec.ts › finds each planted gap
  e2e/layout-balance.spec.ts › passes a grid whose last row is part-empty
  e2e/layout-balance.spec.ts › layout balance, home with 1 open card › leaves no dead space at 768px (and 2, 4, 5 and 7 cards at 768, 1024 and 1440)
  ```
- Before the deploy, with production's own documents (`/api/live` and `/api/cards` from https://peanutgallery.games, 200, served to the branch's build) and the default fixture, the layout audit and a box measure at 375, 768 and 1440 (`/Users/kylesmith/peanutgallery-launch/shots/build/grid-boxes/prod-report.txt`): the audit is clean on /team, /, /contribute, /roadmap and /how-it-works at every width, and /team on production data measures
  ```
  375: Running w 335 ×7, Starts later w 335 ×8, Planned w 335
  768: Running w 352 ×7, h 344.3 ×7; Starts later w 352 ×8, h 291.5 ×8; Planned w 352, h 237.2
  1440: Running w 368 ×7, h 317.1 ×7; Starts later w 368 ×8, h 269.1 ×8; Planned w 368, h 237.2
  ```
  Screenshots of /team and / at 375, 768 and 1440 on both are in the same folder, looked at: every box one width, a section's boxes one height, the last row part-empty and left-aligned, feet and Paused tags in line, the hairline edge visible on paper, the team strip three equal columns and the fund grid three cards to a row.

## Decisions

- 2026-09-26: every grid of like items puts one item in each cell, with no spans and a part-empty last row allowed; /team members sit in identical boxes (board). It replaces the fill rule of `specs/home-and-design.md` and the gap audit (#76), and "never a bordered tile" in DESIGN.md.
- 2026-09-26: "one box size" means one width for every box on /team and equal heights within each section; equal heights across sections would leave an empty half-box in every role still to come (the board chose one box size for all; this is how it is measured).
- 2026-09-26, at build: the Paused tag sits under the facts line in a box's foot (it sat above it). A facts line wraps to two or three lines depending on its figures, so with the foot pinned to the bottom a tag above it moved with the wrap (measured on the paused fixture at 1440: 1209, 1209 and 1232px); last in the foot, the tags line up across every row.
- 2026-09-26, at build: a role still to come is the same component as a running one (`RoleRow`, with its avatar asleep and 56px), so the boxes share their parts; its name and description take the running box's type sizes, and only its avatar stays smaller (`.agent[data-status='starts'|'planned'] .avatar`).
- 2026-09-26, at build: `platform/agents/prompts/platform-director.md` said dead space includes "an empty grid cell", which a part-empty last row now is by design; it now names a grid item stretched across more than one cell instead.
- 2026-09-26, at build: the team grid takes one `--space-3` gap both ways (it was `--space-4` between rows), since the boxes' edges now separate them; the guide's demo card loses its old `max-width: 24rem` for the shared `minmax(0, 23rem)` track.
