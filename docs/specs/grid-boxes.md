# Grid boxes: one size for every item in a grid

Status: agreed. Card: none. Owner: board.

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
2. **Team boxes.** Each `li.agent` is a box: a 1px hairline edge (`--hairline`), the standard radius (`--radius`) and `--space-3` padding. It is not a game card: a card keeps its 2px ink edge and `--radius-card`. The avatar sits beside the name and the "AI agent" line; the description and the foot (the Paused tag and the facts line, or the line saying when the role starts) run the full width of the box, and the foot is pinned to the bottom.
3. **One box size.** All three sections of /team use the same grid, so every box on the page has the same width at every breakpoint. From 48rem every box in a section is as tall as the tallest box in that section (grid rows of `1fr`), so boxes in a section are identical in size. Heights are equal within a section, not across sections: a role still to come holds about half the lines of a running agent, and making it as tall would leave an empty half-box. Roles still to come keep the asleep pose and their smaller avatar.
4. **The team strip** on home is three equal columns from 48rem, whether one, two or three members are shown.
5. **Examples.** A lone example card (the design guide's `.example` and `.demo` grids) is one three-column cell wide (`minmax(0, 23rem)`).

## Acceptance criteria

- [ ] No rule in `styles.css` whose selector names `.card-grid`, `.team-grid` or `.fill-grid` sets `grid-column: span …` or uses `:only-child`; the tracks are `repeat(2, minmax(0, 1fr))` from 48rem and `repeat(3, minmax(0, 1fr))` from 72rem (unit test).
- [ ] `grid-auto-rows: 1fr` is set on `.team-grid` only, never on `.card-grid` (unit test).
- [ ] The team strip uses `repeat(3, minmax(0, 1fr))` from 48rem (unit test).
- [ ] The `.pair:has(> :only-child)` rule is unchanged (unit test kept).
- [ ] /team renders every section as a `ul.team-grid` of `li.agent` boxes; `.team-coming` and `.agent-coming` no longer exist.
- [ ] On the default fixture, every `li.agent` on /team has the same width (±1px) at 375, 768 and 1440 (e2e).
- [ ] At 768 and 1440, every `li.agent` in a section has the same height (±1px) (e2e).
- [ ] The foot of every box lines up across a row (the existing foot-alignment e2e, now covering all three sections).
- [ ] The layout audit's "grid fill" check is replaced by "grid cells": it flags an item wider than one column (+1px) and a row whose first item starts more than 2px from the grid's content edge; a part-empty last row passes. Its self-test plants both violations and expects `grid cells:`, and a control page with four items in three columns yields no finding (e2e).
- [ ] The layout audit passes on home and /contribute with 1, 2, 4, 5 and 7 open cards at 768, 1024 and 1440 (existing e2e matrix).
- [ ] `DESIGN.md`, `platform/agents/prompts/platform-builder.md` and the code comments state the new rule and no longer state the fill rule or "never a bordered tile".
- [ ] PLAN.md §10 records the board's order as decision 49.
- [ ] `pnpm verify` exits 0; the site e2e passes.

## Verification

- `pnpm verify`
- `E2E_PORT=<your port> pnpm --filter @backseat/site e2e`
- After the deploy: a headless measure of live /team at 375, 768 and 1440 (every `li.agent` one width; equal heights within each section from 768) and of /, /contribute and /roadmap (no item wider than one column), quoted.
- Live screenshots of /team and / at 375 and 1440, looked at.
- `node platform/site/scripts/live-check.mjs` → PASS failed=0.

## Evidence

## Decisions

- 2026-09-26: every grid of like items puts one item in each cell, with no spans and a part-empty last row allowed; /team members sit in identical boxes (board). It replaces the fill rule of `specs/home-and-design.md` and the gap audit (#76), and "never a bordered tile" in DESIGN.md.
- 2026-09-26: "one box size" means one width for every box on /team and equal heights within each section; equal heights across sections would leave an empty half-box in every role still to come (the board chose one box size for all; this is how it is measured).
