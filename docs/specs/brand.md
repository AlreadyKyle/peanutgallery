# Brand and design pass

Status: agreed. Card: none. Owner: the board.

A spec is for a new feature or a change to the kernel, money, migrations or the gate; a bug fix, a small tooling change or a copy fix needs none, and its pull request description carries the Verification section instead (CLAUDE.md, Spec-driven development).

## Problem

The site held most blocks to a 44rem measure inside a 72rem page, so on a wide screen nearly every page left a hollow column on its right. Home opened on a video poster that repeated the top bar, which pushed the live studio, the thing that makes the studio worth watching, below the fold. The studio had a site style guide but no brand book saying what the studio is, how it sounds and how far its look reaches, and nothing said that the games keep their own.

## Scope

In: `docs/BRAND.md` (the brand book); the type scale, tracking and width tokens; the section index; the sheet, split and halves layouts; home's hero with the live studio; the card page's two columns; /contribute's first row; the Machine card's presets and wide layout; the footer; DESIGN.md and the tests that pin what changed.

Out: colour values, the card face, the funding bar, the money rules and their words, the nav's links, any game's look, and the board's own site.

## Behaviour

- **Brand book.** `docs/BRAND.md` states the idea, personality, voice, name and mark rules, colour, type, grid, objects, motion, imagery, where the brand applies, and that each game keeps its own brand.
- **Type.** The page heading grows to 72px and section headings to 40px, set tight (tracking tokens `--tracking-display`, `--tracking-heading`); home's pitch has its own size (`--size-hero`) so it keeps three lines beside the room. Letter-spacing comes only from the tracking tokens.
- **Width.** `--wrap` is 76rem.
- **The index.** Every section after the first band whose first child is its visible `h2` opens on a 2px rule in the text colour, with no number over the heading (the board, 18 October 2026). Blocks whose heading is not a section's first child (how it works' video and steps, home's first game, /contribute's two headings) take the same rule. Home's lane rings keep their two-digit mono numerals.
- **The split.** From 64rem a page's plate sets its `h1` in the left seven twelfths and the lede and its lines in the right five, both from the plate's top, so a line that arrives with the data never moves the heading. A card's page keeps a short one-column plate: its title at the section size and no lede (the face says the summary), so its Fund this card is in view at 1440 by 900.
- **The sheet.** On the legal pages, the ledger, the FAQ, goals, suggest, seeds and /thanks, from 64rem each section after the first band sets its `h2` in a sticky left column (5 of 12) and its content in the right (7 of 12).
- **Home.** The plate is one picture with one headline (the board, 18 October 2026): the pitch, the lede at the lead size, the two actions and the status line, and beside them from 64rem the live studio (the room standing on the plate with no screen around it, under a small label, its written facts for screen readers and the keyboard), with the pipe's newest row under the pitch from 80rem and across the plate's foot from 64rem to 80rem; the plate draws only what a first look needs, and how to read the room and what the pipe is are read out, not drawn (the board, 18 October 2026), so the whole room is in view at 1280 by 720 and 1440 by 810. Below 64rem the plate stacks. The explainer video moves to band 2, beside the first game. Under the open cards, "Fund the next card in line" and the Machine card share one row as halves (decision 73's second way to fund keeps its place under the cards). Where the money goes sets the pool and split beside the latest actions.
- **/card/:id.** From 64rem the face (with Play and the agreement) stays in view in the left five twelfths and the facts, What changed, Supporters, the agents' log and the brief run in the right seven.
- **/contribute.** From 64rem the split and the next card in line share the first row. The next card's panel shows a labelled paper button under its words ("Choose an amount →"), so the one-link panel looks pressable and never like a carousel control. The Machine card, given 44rem or more, sets what it is beside how to fund it.
- **Machine presets** are five outlined chips on one row at every width; pressed adds the 3px edge inside the same box. Beside the Machine card, Fund the next card in line takes the same card-title size and keeps its button at its foot.
- **Picked** is a short signal tab at the card's top left, clear of the rarity tab.
- **/reports** is a sheet: each week's heading on the left, its facts and rows on the right.
- **Cards in a row** line their buttons up: a card's bottom block fills its track and pins its button to the foot, so a line above one button (what is left to fund) never pushes it out of line.
- **Top bar.** How it works, Team, Suggest, FAQ and Ledger, then Play and Contribute: the pages a first visit needs. From 64rem to 80rem the links sit closer, so the bar stays one row at 1024px.
- **Footer.** The uppercase wordmark and the studio's line, then three labelled columns of links (Follow along; Take part, with Suggest, Seeds, Goals and Your profile; The fine print), labels in the sans, then the credit under a hairline.
- **Empty lists.** On goals, seeds and suggest a list that did not load or is empty is a dashed tile with the reason and the page's own next step; the sorts and filters are not drawn while the list is unavailable.
- **/thanks.** The reward block opens the paper band without a number; from 64rem the face, its share line and Share sit level with What happens next, and the current step carries a small Now stamp.

## Acceptance criteria

- [ ] `docs/BRAND.md` exists, names no outside brand, and says games keep their own brand.
- [ ] At 1440 by 900 the live studio's room is in view on home without scrolling; at 375 by 812 its top is.
- [ ] No page at 1440px leaves its text held to 44rem with the right of the band empty: the legal pages, the ledger, the FAQ, goals, suggest, seeds, /thanks and /card/:id use the sheet or the card page's columns.
- [ ] Letter-spacing appears only as a tracking token or 0 (`src/styles.test.ts`).
- [ ] The layout audit, the design suite, axe and every other e2e spec pass at the widths they already check.
- [ ] DESIGN.md describes the index, the sheet, the split, home's new order, the card page, the footer and the new tokens.

## Verification

- `pnpm --filter @backseat/site test`
- `E2E_PORT=<port> npx playwright test` in `platform/site`
- `E2E_ROUTE_SHOTS=<folder> E2E_PORT=<port> npx playwright test e2e/route-shots.spec.ts`, compared against the same run on main
- `pnpm verify`

## Evidence

Added when the status moves to built.

## Decisions

- 2026-10-17: the live studio moves onto home's plate, above the fold. It is the studio's product; the explainer video repeated the top bar.
- 2026-10-18: home's plate becomes one picture, the pitch beside the whole room with one headline, and the index's numbers go (the board: the heading is the label; the rule stays).- 2026-10-17: text keeps its reading measure by sitting in the sheet's right column, not by leaving the right of the page empty.
- 2026-10-17: the machine's labels use the system monospace face, so the one-font-file rule and the font budget stand.
- 2026-10-17: games keep their own brand; the studio's brand is the frame around them.
- 2026-10-17: after the pass merged, a creative director, product manager, CEO, web designer and visual designer reviewed the live site. Their layout, numbering, navigation and empty-state findings are in this spec; their money findings (prices, the Machine amount at checkout, figures on home) are the board's, and are not changed here.
- 2026-10-18: the production pass. Set against the best consumer-product pages, the site's headings were half their size against the same body text, so section headings grow to 28px to 56px, page headings to 96px, a section's intro becomes a lede, bands open to 144px on a wide screen, and the scroll reveal raises a section's heading and intro a beat apart and deals its cards. BRAND.md gains the production bar.
