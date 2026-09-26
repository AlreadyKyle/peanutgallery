# Grid boxes: one size for every item in a grid

Status: done. Card: none. Owner: board.

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
5. **Examples.** A lone example card (/how-it-works's `.example` and the design guide's `.demo` grids) is one three-column cell wide (`minmax(0, 23rem)`). The dashed `.example` frame around it hugs the card (`width: fit-content; max-width: 100%`), so the card fills the frame's inner width and no empty column runs beside it inside the dashed edge; on a phone the frame is the full width and the card fills it.

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
- [x] On /how-it-works each example card fills its dashed frame's inner width (±2px) and is at most 23rem wide at 375, 768, 1024 and 1440 (e2e). The layout audit gains a "frame" check: a box with an edge on every side that holds a card, a row or a box leaves no more than 2px empty inside its right edge; its self-test plants a half-empty example frame and expects `frame:`, and a hugging frame and a text-only box yield no finding (e2e).
- [x] `DESIGN.md`, `platform/agents/prompts/platform-builder.md` (and `platform-director.md`, whose "an empty grid cell" stated it too) and the code comments state the new rule and no longer state the fill rule or "never a bordered tile".
- [x] PLAN.md §10 records the board's order as decision 49.
- [x] `pnpm verify` exits 0; the site e2e passes.
- [x] Production: after the deploy, live /team measures one width for every box at 375, 768 and 1440 and equal heights within each section from 768; /, /contribute and /roadmap have no item wider than one column; `live-check.mjs` passes (the ship stage).

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

- After the review's example-frame finding (26 Sep 2026, commit 6a87436 and the evidence commit after it): the new tests fail before the fix (`5 failed`: the example-card e2e at 768, 1024 and 1440 with `{"inner":670,"card":368}` and `{"inner":654,"card":368}`, and the layout audit on the default fixture at 768 and 1440 with `/how-it-works frame: 302px of empty column inside the right edge of figure.example "Quiet rooms: one more unlock"`) and pass after it. Then `pnpm verify`: `exit 0`, with `platform/site test: Tests  502 passed (502)`, `platform/dispatcher test: Tests  688 passed (688)`, `platform/supabase test: Tests  309 passed (309)`, `PASS: gate tests passed=524`, functions `ok | 123 passed (202 steps) | 0 failed`, `GATE PASS folder=seed-1 lane=code`. The site e2e (`E2E_PORT=4451`): `5 skipped` `214 passed (4.0m)`. The branch's build with production's `/api/live` and `/api/cards` (200) measures each /how-it-works example frame (`/Users/kylesmith/peanutgallery-launch/shots/build/grid-boxes/r1-fix/`, screenshots at 375, 768, 1024 and 1440, looked at: the dashed edge sits one padding outside the card):
  ```
  375: card frames 335, inner 301, card 301
  768: card frames 402, inner 368, card 368 (the other four frames 704, inner 670)
  1024 and 1440: card frames 418, inner 368, card 368 (the other four frames 704, inner 654)
  ```

**Production (the ship stage, 26 Sep 2026).** Every Verification line is now run and quoted.
- Local gate on the pull request's head, from main's checkout (log `~/.local-gate/gate-logs/pr84-f67299d.log`): `LOCAL GATE PASS pr=84 head=f67299d9ae057066977f4c83e27f65305e96fe6e base=90be039ac4fde31596e99dab8be180cd7a1cd8a2 merge=93be26f2544e7a990e715f2e98a1124b6962c6d4 seed=false platform=true lane=code site=true functions=false`.
- Squash-merged as #84 at 2026-09-26T16:04:24Z, `747803aced9027b59c57ba8f09c454843c77d166`, the PASS line in the merge body; `launch/grid-boxes` deleted. No migration, no function, no board step.
- Deploy: `curl -s https://peanutgallery.games/version.json` → `{"sha":"747803aced9027b59c57ba8f09c454843c77d166","builtAt":"2026-09-26T16:04:44.990Z"}`; the board site's build was correctly cancelled (no change there).
- The headless measure of live production at 747803a (`/Users/kylesmith/peanutgallery-launch/shots/live/grid-boxes/live-measure.txt`):
  ```
  /team 375: width spread 0 | Running: 7 boxes, w 335 | Starts later: 8 boxes, w 335 | Planned: 1 boxes, w 335
  /team 768: width spread 0 | Running: 7 boxes, w 352, h 344.3 (h spread 0) | Starts later: 8 boxes, w 352, h 291.5 (h spread 0) | Planned: 1 boxes, w 352, h 237.2
  /team 1440: width spread 0 | Running: 7 boxes, w 368, h 317.1 (h spread 0) | Starts later: 8 boxes, w 368, h 269.1 (h spread 0) | Planned: 1 boxes, w 368, h 237.2
  / 768: ul.card-grid.fund-grid: 2 col × 352px, 6 items w 352, wider than a column: 0 | ul.team-strip: 3 col × 226.7px, 3 items w 226.7, wider than a column: 0
  / 1440: ul.card-grid.fund-grid: 3 col × 368px, 6 items w 368, wider than a column: 0 | ul.team-strip: 3 col × 368px, 3 items w 368, wider than a column: 0
  /contribute 375, 768, 1440: ul.choices 1 col, 6 items, wider than a column: 0
  /roadmap 375, 768, 1440: 0 grid list(s)
  /how-it-works 375: ul.card-grid 1 col × 301px, 1 item w 301; 768 and 1440: 1 col × 368px, 1 item w 368; wider than a column: 0
  MEASURE PASS
  ```
- Live screenshots, looked at: `/Users/kylesmith/peanutgallery-launch/shots/live/grid-boxes/team-375.png`, `team-1440.png`, `home-375.png`, `home-1440.png` (every box one width, the last row part-empty and left-aligned, the fund grid three to a row at 1440).
- `node platform/site/scripts/live-check.mjs` from main's checkout at 747803a: `PASS live-check https://peanutgallery.games passed=264 failed=0 skipped=0`.

## Decisions

- 2026-09-26: every grid of like items puts one item in each cell, with no spans and a part-empty last row allowed; /team members sit in identical boxes (board). It replaces the fill rule of `specs/home-and-design.md` and the gap audit (#76), and "never a bordered tile" in DESIGN.md.
- 2026-09-26: "one box size" means one width for every box on /team and equal heights within each section; equal heights across sections would leave an empty half-box in every role still to come (the board chose one box size for all; this is how it is measured).
- 2026-09-26, at build: the Paused tag sits under the facts line in a box's foot (it sat above it). A facts line wraps to two or three lines depending on its figures, so with the foot pinned to the bottom a tag above it moved with the wrap (measured on the paused fixture at 1440: 1209, 1209 and 1232px); last in the foot, the tags line up across every row.
- 2026-09-26, at build: a role still to come is the same component as a running one (`RoleRow`, with its avatar asleep and 56px), so the boxes share their parts; its name and description take the running box's type sizes, and only its avatar stays smaller (`.agent[data-status='starts'|'planned'] .avatar`).
- 2026-09-26, at build: `platform/agents/prompts/platform-director.md` said dead space includes "an empty grid cell", which a part-empty last row now is by design; it now names a grid item stretched across more than one cell instead.
- 2026-09-26, at review: capping the lone example card at `23rem` left its dashed frame at the full 704px measure, an empty column of about 290-300px beside the card inside the frame at 768, 1024 and 1440 (review finding, measured on the branch with production's documents). The frame now hugs the card (`.example:has(> .card-grid) { width: fit-content; max-width: 100%; }`), which keeps the card one cell wide as Behaviour 5 asks; widening the card back to the frame would have undone that. The layout audit's hollow check measures only vertical runs, so the audit gains a horizontal "frame" check (2px), and an e2e test measures the card against its frame. The guide's `.demo` has no frame, so its card needs no change.
- 2026-09-26, at build: the team grid takes one `--space-3` gap both ways (it was `--space-4` between rows), since the boxes' edges now separate them; the guide's demo card loses its old `max-width: 24rem` for the shared `minmax(0, 23rem)` track.
