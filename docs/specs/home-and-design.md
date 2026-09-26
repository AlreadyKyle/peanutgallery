# Home and design: the new home page, the colour system, the top bar and bands on every page

Status: done. Card: none. Owner: board.

The home-and-design pull request of the approved v1 design direction, with the colour system the board ordered on top of it, and a layout audit so the site catches its own dead space. This is a board pull request: it changes kernel files, listed under Scope. Its mockup is the home page, and the design guide at `/design-kit-7q4m` shows every part and every colour.

## Problem

Home still had the pitch beside a tall Right now panel, and Funding beside a Ledger that ran the length of the page, so both left a large empty area the board had to point out by eye. Only the guide was on bands, the top bar dropped its links under the mark on phones (165px tall at 375), home was 9,801px tall on a phone, and the site was black and white only. Nothing in the gate would have caught the gaps.

## Scope

In:
- **Home in the board's order** (`pages/Landing.tsx`, `lib/live.ts`): the pitch, Play Dust, How it works, a status line from the snapshot and the live-updates row on the signal plate; Building now (while a card builds), Fund what's next (a phone shows three and "Show all *n* cards") and Queued on paper; the team strip (the first three running roles, each linking to `/team#agent-<id>`) on ink; Shipped (the latest three) and Planned next (the next three planned) on paper; Where the money goes (the pool with the coin, the split sentence from the fixed constants, "These are contributions, not donations.", the five latest agent actions, Full ledger) on ink. The Right now panel, the three How it works lines and Fixed rules leave home (`/how-it-works` has them).
- **The top bar and Menu** (`App.tsx`): the peanut mark, Play, Contribute with the coin and a Menu button (`aria-expanded`, the links as an inline list inside `nav`, Escape closes it and returns focus, a route change closes it); Play moves into the Menu below 22.5rem; the links sit in the row from 64rem.
- **Bands on every public page** per the table in `platform/site/DESIGN.md` (Bands), rail rows on home, `/ledger` and `/roadmap`, `/ledger` as stacked full-width bands with the agent actions capped at ten and "Show all *n* agent actions", `/how-it-works` stacked step by step, the not found page's message and Home button together.
- **`/contribute`**: "Pick for me" becomes "Fund the next card in line", which names no card (Decisions).
- **The colour system** (`src/tokens.css`, `src/styles.css`, `src/lib/colour.ts`): the signal plate on band 1 and the top bar, `--signal`, `--signal-deep`, `--signal-press`, `--muted-on-signal`, `--line-on-signal`, `--coin-up`, `--suit-game`, `--suit-studio`, `--live`, `--work` changed to `#dfe2f7`, the role resets for signal and ink, suit tiles, the Picked ribbon, the Funded glyph's coin fill, the Live mark, Contribute's hover by ground, the forced-colours fallbacks, and the fill rule for grids.
- **The guide** (`pages/Guide.tsx`): three bands (signal, paper, ink), every colour token and every pairing measured on the page, the colour rules, the faces in two groups by anatomy, controls and rows on all three grounds.
- **The layout audit**: `scripts/layout-audit.mjs` (the checks), `e2e/layout-balance.spec.ts` (every public route and the guide, five widths, four data sets, and a page of planted gaps it must catch), `scripts/gap-audit.mjs` (the same checks on any preview or mockup), and the rule in `DESIGN.md` and in the Platform Builder's and Platform Director's prompts.
- **The 13 audited design fixes** (table below), `og.png` re-rendered, `scripts/live-check.mjs` for the new layout, `DESIGN.md`, this spec and its ROADMAP row.
- **Kernel files changed** (a board pull request): `platform/site/src/App.tsx` (the top bar, Menu, the not found page), `lib/legal.ts` (the home money lines, the Fund the next card in line label and its no-card line; no money statement changes meaning), `components/EventList.tsx`, `LedgerSummary.tsx`, `DeployList.tsx`, `Funding.tsx`, `PoolStat.tsx`, `Stat.tsx`, `TextPage.tsx` (rail rows, the capped actions, the pool line, the split sentence from the constants), `pages/Contribute.tsx`, `pages/Ledger.tsx`, `scripts/` (`layout-audit.mjs`, `gap-audit.mjs`, `live-check.mjs`, `og-image.mjs`), `platform/agents/prompts/platform-builder.md` and `platform-director.md`, and `docs/` (`PLAN.md`'s "Pick for me" label, `ROADMAP.md`).

Out, and what each waits on:
- The `/card/:id` replay route, and with it "Watch how it's built" and "Watch how it was built": the supporter-loop work. Nothing links to `/card/` until it exists.
- Naming the next card in line on `/contribute`, the operations share in its sentence, and home's grid in the waterfall's own order: money-logic, which must confirm that step 3 of the waterfall uses `cards.rank` or add a public read.
- The gate's design frames at 375, 768 and 1440 with reduced motion: the agent-system work that adds the gate's frame renderer. The layout balance test runs in the gate's site e2e now.
- Paused and rejected faces on public pages: an anon read that lists them with a public reason (backlog).
- Retitling the two live planned cards whose titles use "vote" words ("Voter identity for free votes", "Free voting on open cards"), which home's Planned next now shows: the board, as a data edit (Decisions).
- Dark mode, card backs, the hero spread, the traced SVG peanut and the other backlog cards of the direction.
- `/board` is out of scope.

## Behaviour

- Every page opens on one cobalt plate that the top bar shares; below it bands alternate white and black, and every card sits in the white second band. Amber still means money, the signal means the studio, and green appears only on the Live mark.
- On a phone the top bar is one 60px row: the peanut, Play, Contribute and Menu. Menu opens the page links under the row; Escape closes it.
- Home reads, top to bottom: what the studio is and one true sentence about its state, the cards to fund, the queue, the team, what shipped and what is planned next, and where the money goes. The pause is said once, in the status line. A phone shows three cards and a button for the rest.
- `/contribute` offers Fund the next card in line first ("Your contribution funds whatever the agents build next."), then each open card.
- `/ledger` shows Funding, Agent work and Deploys one under another; the agent work shows the ten newest actions and a button for the rest.
- Nothing on any page leaves dead space: side-by-side blocks end within max(160px, 35%) of each other, no band has an empty run over 240px, grids fill their rows, card rows line up with no hollow over 80px, and nothing reaches past a phone's screen. The gate fails a change that breaks any of these on any route at 320 to 1440px.

## The 13 audited design fixes

| # | Defect (the audit of the site at aba2fd3) | Outcome |
|---|---|---|
| 1 | How it works: the step list indented 40px | Fixed: `.how-steps` has no padding, and each step now stacks its text over its example at the reading measure |
| 2 | Home's Ledger listed all 20 actions beside a short Funding column (a 1,300px void); a 1,700px wall on phones | Fixed and superseded: home shows the five latest actions under Where the money goes; `/ledger` stacks its bands and caps the actions at ten with "Show all" |
| 3 | The paused notice sat with the content below instead of the page it qualifies | Fixed: it is a child of the page header on the signal plate of `/contribute` and `/how-it-works`; home says it in the status line |
| 4 | "Full ledger" touched the last hairline | Fixed: `.rows` keeps `--space-2` under it, and `p.more` links take one line of layout |
| 5 | Standalone links under 44px (Full ledger, More on how it works, Play the game, Home on the 404, the footer credit) | Fixed: `p.more` and `a.target` give a 44px target in one line of layout, footer links are 44px, Play the game and Home are buttons |
| 6 | Dead space under the pitch beside the Right now panel | Superseded: the panel is gone and the status line says what it said; the layout audit fails any such gap |
| 7 | Team facts lines at different heights across a row | Fixed: pinned to the bottom of each row from 48rem; on a phone the avatar floats beside the text |
| 8 | Event rows and deploy rows had different shapes | Fixed: both are rail rows with the time in the 9rem rail |
| 9 | The tokens line floated between two hairlines | Fixed: it is the Agent spend figure's second line |
| 10 | Home's How it works steps too loose on phones | Superseded: the steps left home for `/how-it-works` |
| 11 | Card bottoms uneven from the brief's 44px padding | Fixed: the brief's summary takes one line of layout; a card with no brief keeps the same line empty, so bars line up |
| 12 | The 404's Home link separated from its message | Fixed: the message and a Home button sit together in band 2 |
| 13 | Examples double-padded on narrow screens | Fixed: `.example` padding is `--space-2` below 64rem |

## The colour rules, in short

One colour, one meaning: amber is money (Contribute, the funding bar, the coin mark, the Funded glyph), signal is the studio (band 1, the primary action and focus ring on paper, the Picked ribbon, the studio suit, the work face), green is Live (its glyph and stamp edge on paper). No text is ever a colour. Signal never touches ink, because band 2 is always paper. Suit tiles and the Live mark reset to the text colour on signal and ink, where they would measure below 3:1. No red, gradients (but the Paused hatch), glows, shadows (but the change marker), neon, metal or gold. Every pairing is in `src/lib/colour.ts` with its floor and is tested, the banned ones below theirs; every pair of marks stays 25 delta-E apart under normal vision and three colour-vision simulations. The full rules are `platform/site/DESIGN.md`, Colour.

## Acceptance criteria

- [x] Home draws its h2 sections in the board's order from the snapshot, on five bands (four with no team roles), with the status line, the live-updates row, the team strip, three shipped, three planned, the pool with the coin, the split from the constants, "These are contributions, not donations.", five actions and Full ledger; nothing links to `/card/`.
- [x] A phone shows three open cards and "Show all *n* cards", which reveals the rest and focuses the fourth card's title.
- [x] The top bar is one row of at most 61px from 320 to 390px; Menu has `aria-expanded`, Escape closes it and returns focus, a route change closes it, and Play moves into it below 360px.
- [x] Every public page draws its bands signal, paper, then ink and paper in turn, with the footer continuing, also with empty data; no card, funding bar, choice or agent row sits outside band 2; every seam measures 0.
- [x] `/contribute` offers "Fund the next card in line" first, naming no card; `/ledger` stacks Funding, Agent work and Deploys and caps the actions at ten with "Show all".
- [x] Every colour token is in `tokens.css` and `src/lib/colour.ts`; every pairing meets its floor and every banned pairing stays below it; the marks pass the colour-vision gate; amber appears only in money rules; no rule gives text a colour but the Live mark.
- [x] The focus ring is 3px signal on paper and 3px paper on signal and ink, at a 2px offset; Contribute is ink on coin on every ground and hovers to coin-up on signal and coin-down on ink; the pressed border and the change marker are the text colour; suit tiles and the Live mark reset on signal and ink; forced colours keep the band rules, the Funded glyph and the tile edges.
- [x] The layout balance test passes on every public route and the guide with realistic data, and catches each planted gap.
- [x] The guide shows every colour token and every pairing measured on the page, and the colour rules.
- [x] `og.png` is re-rendered on the signal plate with the site's font.
- [x] Budgets against `main`: JavaScript growth at most 14KB gzipped, CSS at most 8KB gzipped.
- [x] The production live check passes after the deploy (Evidence, the close-out).

## Verification

- `pnpm verify` at the repository root.
- `E2E_PORT=4392 pnpm --filter @backseat/site e2e`
- `BOARD_E2E_PORT=4396 pnpm --filter @backseat/board e2e`
- The budgets: the site built from `main` and from the branch with the same values, each asset gzipped at level 9.
- Screenshots of every public route at 375, 768 and 1440px with reduced motion, on the fixture data (`E2E_ROUTE_SHOTS`) and on production data (a preview built with `netlify.toml`'s values), looked at.
- `node platform/site/scripts/live-check.mjs` against a local preview built with `netlify.toml`'s values, and against production after the deploy.

## Evidence

The branch's runs were quoted in its pull request's body and not copied here before the merge; they are recorded here at the close-out (26 September 2026), with the lines the body did not carry run then.

- Merged as 4e50e74, "Home and design: the new home page, colour system, top bar and bands on every page" (#64), `mergedAt=2026-09-23T19:26:22Z`, head 55aaf0c82c68bbdf80db6360eeeaf7b04ba7d16b.
- `pnpm verify`, from #64's body: "exit 0 (site 334, board 67, supabase 267, dispatcher 619, seed-1 77, gate 504, both GATE PASS)".
- `E2E_PORT=4442 pnpm --filter @backseat/site e2e`, from #64's body: "98 passed, 5 skipped (optional screenshot tests), layout balance included".
- The board e2e line: the Actions gate on #64's head (run 35908373469, `pull_request`, `head_sha=55aaf0c82c68bbdf80db6360eeeaf7b04ba7d16b`, `conclusion=success`) ran it. Its platform job reads `Typecheck and tests=success`, `Gate tests=success`, `Docs tests=success`, `Build the site for the end-to-end suite=success`, `Site end-to-end=success` and `Board site end-to-end=success`; its build job `Build the sites and scan the builds=success`; and `gate=success`.
- The budgets, measured at the close-out: the site built at 7540073 (#64's base, `4e50e74^`) and at 4e50e74, each with `netlify.toml`'s five public values, every file in `dist/assets` gzipped at level 9. JavaScript 161,241 to 167,291 bytes (+6,050, within 14KB); CSS 5,150 to 6,002 bytes (+852, within 8KB).
- The live check against a local preview built with `netlify.toml`'s values: 4e50e74's own `scripts/live-check.mjs` against `vite preview` of 4e50e74's build on port 4440, reading production's data of 26 September 2026: `PASS live-check http://localhost:4440 passed=186 failed=0 skipped=5`, the skips being the two board-address lines (`BOARD_SITE_URL` not set), `/board status 200: a local server has no redirect rules`, the og:image host and `www redirect: production only`. Among the passes, `PASS 375px / bands signal, paper, then ink and paper: rgb(26, 47, 200) / …` and `no dead space` on each of the 22 route and width pairs it checks.
- The live check against production after the deploy: every deploy since has passed it, and on `origin/main` at ed63326 (production's `version.json` serving that sha) `set -a; . ./.env; set +a; node platform/site/scripts/live-check.mjs` prints `PASS live-check https://peanutgallery.games passed=279 failed=0 skipped=0`, exit 0.
- Screenshots on production's data, looked at: the #64 branch's shots were not recorded, so at the close-out every public route (home, /contribute, /ledger, /how-it-works, /team, /roadmap, /reports, /terms, /privacy, /refunds, /contact, a live card's page, /thanks and a not found page) was drawn on production at 375, 768 and 1440 with reduced motion, 42 full-page shots, every page reading build ed6332648f4e7844aafe88c2a610a264cee91540 and none with sideways overflow. Looked at: each page opens on the black signal plate the top bar shares, the bands alternate, cards sit in the white second band in one, two and three columns, the team strip and Where the money goes sit on ink, and no page shows a hollow or an empty run beside a block. These are the pages as they stand after the later pull requests, which the live check and the layout audit hold to this spec's rules.
- What Scope left out has shipped: the `/card/:id` replay and its Watch links with supporter-pages (#82, `specs/supporter-pages.md`), and the next card in line on `/contribute` with money-surfaces (#71, fix-forward #78, `specs/money-surfaces.md`); both are on the live site in the check above. The gate's design frames are design-review's line (`specs/design-review.md`), which waits on GitHub Actions minutes; they are not this spec's criterion. The planned titles that say "vote" (four in production's `/api/cards` today) are allowed on /roadmap and home's Planned next by ROADMAP criterion 4 and stay the board's to edit.

Every Verification line is run and quoted. Status done.

## Decisions

- 2026-09-23: The board moved this pull request ahead of legal-copy, money-logic, agent-system and supporter-loop, so the pages those change are built on the new home and design.
- 2026-09-23: The board overrode the direction's black-and-white-only rule with the colour system (Signal plate, `--signal` `#1a2fc8`): every page opens on one cobalt plate that means the studio, amber still means money, and green means Live. `platform/site/DESIGN.md` (Colour) holds the rules.
- 2026-09-23: The board asked that the design process catch gaps like home's pitch beside the Right now panel and Funding beside the Ledger without the board seeing them. The layout audit runs in the gate on every route, `gap-audit.mjs` runs on every preview and mockup, and the Platform Builder's and Platform Director's prompts carry the rule. Its thresholds are the board's: side-by-side blocks within max(160px, 35% of the taller), no empty run over 240px in a band; the colour system's card checks (hollow at most 80px, bars and titles aligned, grids filled) run beside them.
- 2026-09-23: "Fund the next card in line" keeps the sentence the block had, "Your contribution funds whatever the agents build next.", instead of the direction's "to open cards in the order shown under Fund what's next". Money given with no card sits in the pool and funds later cards (PLAN.md §4); it does not fill an open card's bar today, so the direction's sentence would change the meaning of a money statement and describe what money-logic has not built. The label changes; the money statement does not.
- 2026-09-23: Three-column card and team grids start at 72rem, not 64rem. At 1024px the launch cards in three columns left a 95px hollow beside a long summary (the audit's card check); two columns hold to 72rem.
- 2026-09-23: `/how-it-works` stacks each step's text over its example at every width. Beside a 450px example card a two-line step floated in 300px of white, the same class of gap the board flagged.
- 2026-09-23: The ledger caps its agent actions at ten with "Show all *n* agent actions" (focus moves to the eleventh), and keeps its bands at the reading measure; every action stays one press away.
- 2026-09-23: On a phone an agent's avatar floats beside its name and the text wraps under it, and from 48 to 64rem a team strip member's avatar sits over its name, so no narrow column runs down beside the text.
- 2026-09-23: A card with no brief keeps the brief's one line empty, so its funding bar lines up with the cards beside it.
- 2026-09-23: Home's Planned next shows the next three planned titles as they are in the database, two of which say "vote". ROADMAP criterion 4 allows vote words only for planned items; home's Planned next lists the same planned items, so the criterion now names both places, and the titles are the board's to edit.
- 2026-09-23: The guide's colour table keeps its words with its data in `src/lib/colour.ts`, the one list the guide draws and `styles.test.ts` checks.
- 2026-09-23: `og.png` is drawn on the signal plate with the site's font inlined as a data URL, since a page set from a string has no origin to load `/fonts/` from; the script fails if the font did not load.
- 2026-09-23: The board judged the cobalt signal to read as MS-DOS and chose black for now. `--signal` is `#111111` (hover and press `#333333`, muted `#a3a3a3`), the work face returns to the direction's pale blue `#d4e1ee`, the banned-pairing tests that only made sense on cobalt are removed, and `html` paints a solid `--signal` background colour with `body` painting none (`.page` paints the paper), so an overscroll never shows white behind the black top bar; the overscroll is black past the bottom too, since browsers fill it with the root's one colour and never with a background image. `index.html` sets `theme-color` to `#111111`. Home's team strip gains "Meet the whole team" with an arrow (the same arrow now ends See the roadmap and Full ledger), and /team puts each agent's avatar beside its text and drops the repeated "Not running yet" line under that heading (the role descriptions in platform/agents lose their ", but is not running yet").
