# Mob Machine site style guide

The one source of truth for how the public site looks and moves. The board's own site (`platform/board`, docs/specs/board-site.md) keeps its own stylesheet and form rules. The approved direction behind this guide is `docs/specs/design-system.md`; the home page, the top bar, the bands on every page, the colour system and the layout audit are `docs/specs/home-and-design.md`.

Tokens live in `src/tokens.css`; the rules in `src/styles.css`, which imports it first. `src/styles.test.ts` enforces the rules marked **(tested)**, and the Playwright suite (`e2e/design.spec.ts`) the ones marked **(e2e)**.

## Brand, in one paragraph

A quiet, precise table (Teenage Engineering's precision) where real cards (Cards Against Humanity's card-as-object, never its tone) are funded with arcade coins and built by a cast of code-drawn aliens. The card is the object and the page is the table: cards carry the edge, the face and the motion, and everything else is quiet type on a white page. Every page opens on one cobalt plate, the studio's colour; below it full-bleed bands rotate white and black. Three motifs only: the card, the coin (money) and the mark, a small machine with two eyes, drawn in the text colour. All ages: no theatre or balcony imagery, no chips, dice or other gambling cues, no shock. The site publishes no origin story for its name.

## Principles

1. **One grid, readable lines.** The top bar, the page and the footer share one width (`--wrap`, 72rem), so every left edge lines up. Text never runs wider than `--measure` (44rem). Short, repeated items (cards, steps, figure groups) sit side by side on wide screens and stack on phones.
2. **Sentence case, upright.** Headings are bold, not shouting. Uppercase appears only in the wordmark, and italic nowhere: the one font file has no italic, and `font-synthesis-style: none` stops the browser inventing one **(tested)**.
3. **Show, don't hide.** Anything a reader needs to understand a figure or a card is written beside it. No tooltips and no icon that needs a tap. **A word and a glyph, never colour alone**: states, suits, pauses and money direction each carry a word.
4. **Measured contrast** **(tested)**, WCAG 2.x, on every ground: every pairing the site draws is listed in `src/lib/colour.ts` with its floor (7 for body text, 4.5 for other text, 3 for controls and marks) and checked against `tokens.css`; each banned pairing is checked to stay below its floor, and a rule keeps it off the page (Colour, below).
5. **Edges make objects.** Cards have a 2px ink edge and `--radius-card` corners, and no shadow: a white card on the white page measures 1.00, so the edge is what makes it read. Choices, buttons and fields use 1px and `--radius`, and so do `/team`'s boxes, in the hairline (`--hairline`), which never reads as a card. Everything else is separated by space and, in lists, by hairlines. `--radius-box` and the Right now panel are retired; home's status line says what the panel said.
6. **Things you can press look pressable.** Links are underlined, and buttons are filled or outlined boxes at least 44px tall **(tested)**. Buttons never set `nowrap`: a long label wraps inside its box.
7. **Every public string lives in `src/lib/copy.ts`, or in `src/lib/legal.ts`.** The words of each Terms version (the Terms and the Refunds page) live in `src/lib/terms-versions.ts`, kernel as well, and a posted version is never edited. `legal.ts` is kernel and holds the legal pages, the fixed rules and every statement of money: the money rules, the labels and descriptions of money and ledger figures (including a card's spec-row labels), the ledger's row words and the funding caption. Pages read it directly; `copy.ts` never repeats it. The unlisted guide's colour table keeps its words beside the data they describe, in `src/lib/colour.ts`.
8. **Three text styles to a block, four on a card.** A block uses at most a heading, body text and one small muted line, plus its button. A card has four: the index row, the title, the summary and the spec rows, because the spec rows are the precision the table asks for.
9. **Headings balance their lines** (`text-wrap: balance`) **(tested)**.
10. **One colour, one meaning.** Coin amber means money, signal (ink, since the board's call of 23 September 2026) means the studio, green means Live. No colour is ever a text colour **(tested)**, and every coin shape has an ink edge on paper (coin on paper is 2.25).
11. **Motion records a real change or answers a press.** First paint is still. Nothing a viewer might tap moves while they look (see Motion).
12. **No dead space.** Side-by-side blocks balance or stack; nothing leaves an empty column or a hollow in a band. A grid of like items puts one item in each cell, every item one width, and its last row may be part-empty: nothing is stretched to fill a row (the board, 26 September 2026). The layout audit checks it on every page, and every mockup passes it before anyone sees it **(e2e: layout balance)**.

## Tokens

Colours are written only in `tokens.css`, and there only in `:root` **(tested)**. v1 is light only (`color-scheme: light`); dark mode is a backlog card. Every colour token is listed with its one job in `src/lib/colour.ts`, which the guide draws and `styles.test.ts` checks against `tokens.css` **(tested)**.

| Token | Value | Job | Measured |
|---|---|---|---|
| `--paper` | `#ffffff` | The page ground and paper bands; card faces and fields; text, glyphs, edges and the focus ring on signal and ink | ink on it 18.88; on signal 9.19 |
| `--ink` | `#111111` | Text on paper and work; card edges, the bar's outline and rule; the ground of ink bands | on paper 18.88, work 14.71, coin 8.40 |
| `--muted` | `#5c5c5c` | Secondary text on paper and work | paper 6.69, work 5.21 |
| `--field` | `#7d7d7d` | Field, chip and quiet edges on paper, work and ink | paper 4.12, work 3.21, ink 4.59 |
| `--line` | `#d6d6d6` | Hairlines on paper (decorative); the outline press fill on paper | 1.45; ink on it 12.99 |
| `--paper-hover` | `#eeeff0` | Outline hover on paper; primary hover and press on signal and ink. Never a ground | ink on it 16.40 |
| `--ink-hover` | `#333333` | Outline hover and press on ink | paper on it 12.63 |
| `--muted-on-ink` | `#a3a3a3` | Secondary text on ink | on ink 7.49 |
| `--line-on-ink` | `#333333` | Hairlines on ink (decorative) | 1.49 |
| `--signal` | `#111111` | The studio: band 1 and the top bar; on paper the primary fill, the focus ring and the Picked ribbon; the studio suit | paper on it 18.88; coin on it 8.40 |
| `--signal-deep` | `#333333` | Hover of every signal fill | paper on it 12.63 |
| `--signal-press` | `#333333` | Press of every signal fill | paper on it 12.63 |
| `--muted-on-signal` | `#a3a3a3` | Secondary text on signal; the quiet label and edge there | on signal 7.49 |
| `--line-on-signal` | `#333333` | Hairlines on signal (decorative) | 1.49 |
| `--work` | `#d4e1ee` | The Building and Being checked face: a pale blue | ink 14.21, muted 5.03 |
| `--suit-game` | `#b0226a` | The Dust suit tile, on paper and work only | paper glyph on it 6.40 |
| `--suit-studio` | `var(--signal)` | The studio suit tile | paper glyph on it 9.19 |
| `--live` | `#16701f` | Live only: its glyph and the stamp edge, on paper | on paper 6.23 |
| `--coin` | `#d9a441` | Money only: Contribute, the funding bar's fill, the coin mark, the Funded glyph | ink on it 8.40; on signal 4.09; on ink 8.40 |
| `--coin-down` | `#b8862f` | Contribute hover and press on paper and ink | ink on it 5.84 |
| `--coin-up` | `#ecc36e` | Contribute hover and press on signal | ink on it 11.33; on signal 5.51 |
| `--creature-*` | eleven fills | Avatar fills only; every avatar shape has an ink outline | |

Retired: `--accent`, `--track`, `--radius-box`, and `--ground` as a background (its value lives on as `--paper-hover`) **(tested)**.

**Roles.** Components read role tokens, never grounds: `--text-muted`, `--hairline`, `--focus-colour`, `--primary-bg/-fg/-hover/-press`, `--outline-bg/-fg/-hover/-press`, `--coin-hover`, `--quiet-fg`, `--quiet-edge`, `--suit-tile-game`, `--suit-tile-studio` and `--live-mark`. `:root` sets them for paper; the signal plate and the ink bands reset them from their position (Bands). So nothing needs a band class to draw correctly on any ground.

| Role | Paper (`:root`) | Signal (band 1, top bar) | Ink (odd bands from 3) |
|---|---|---|---|
| `--text-muted` / `--hairline` | muted / line | muted-on-signal / line-on-signal | muted-on-ink / line-on-ink |
| `--focus-colour` | signal | paper | paper |
| `--primary-bg` / `-fg` | signal / paper | paper / ink | paper / ink |
| `--primary-hover` / `-press` | signal-deep / signal-press | paper-hover | paper-hover |
| `--outline-bg` / `-fg` | paper / ink | signal / paper | ink / paper |
| `--outline-hover` / `-press` | paper-hover / line | signal-deep / signal-press | ink-hover |
| `--coin-hover` | coin-down | coin-up | coin-down |
| `--quiet-fg` / `--quiet-edge` | muted / field | muted-on-signal | muted-on-ink / field |
| `--suit-tile-game` / `-studio` | suit-game / suit-studio | transparent | transparent |
| `--live-mark` | live | currentColor | currentColor |

**Type.** One family, one file: Atkinson Hyperlegible Next (SIL OFL 1.1, `public/fonts/OFL.txt`), `public/fonts/atkinson-hyperlegible-next-400-700.woff2`, 18,208 bytes, weights 400 to 700, features `kern`, `tnum`, `case` and `locl`, characters U+0020–007E, U+00A0–00FF, U+2010–2027 and U+2212. `scripts/fonts.sh` cuts it from `brand/fonts/AtkinsonHyperlegibleNext-VF.ttf` and pins the features (pyftsubset's defaults drop `tnum`) **(tested: `tnum` is in the file's GSUB; the file is at most 18,208 bytes)**. It loads same-origin under `/fonts/` with `font-display: swap` **(tested)**, preloaded from `index.html` **(tested)**; the CSP stays `font-src 'self'` **(e2e: font requests are same-origin)**. While it loads, text sets in Arial scaled by fallback metrics computed from the file by `scripts/font-metrics.py`, never guessed **(tested)**. `--font-mono` stays the system stack for commit shas.

| Token | Value | Use |
|---|---|---|
| `--weight-body` / `--medium` / `--strong` / `--bold` | 400 / 500 / 600 / 700 | Body / nav / labels, buttons, figures / headings, card titles, wordmark. Nothing below 400 **(tested)** |
| `--leading-body` / `--leading-heading` / `--leading-display` | 1.6 / 1.2 / 1.1 | Text / `h2` and `h3` / the page heading |

**The type scale** (the board's call, 23 September 2026: the page heading read small and the top of every page cramped). Five sizes. Text holds still; the two headings grow with the viewport through `clamp()` (fluid type), from a 390px phone to a 1440px screen, with no breakpoint. Every font-size in `styles.css` is a `--size-*` token that `tokens.css` defines, with one exception: `code` is 0.9em of the text around it **(tested)**.

| Token | Size | Roles |
|---|---|---|
| `--size-small` | 14px | Meta lines, the card's index row and spec rows, a row's date, rail and meta line, the footer, captions. Nothing smaller but `code`, which is 0.9em of its text: about 12.6px inside a small line, such as the design guide's token names |
| `--size-body` | 17px | Paragraphs, nav, buttons, the wordmark, a row's title and text |
| `--size-lead` | 20px | The lede, figures, every `h3` and card title (700, balanced) |
| `--size-h2` | 24px to 32px | Section headings (`h2`): `clamp(1.5rem, 1.25rem + 1vw, 2rem)` |
| `--size-h1` | 33px to 56px | The page heading (`h1`), once per page: `clamp(2rem, 1.5rem + 2.25vw, 3.5rem)` |

Money and counts use tabular figures.

**Space and shape.** `--space-1` … `--space-5` (0.5 / 1 / 1.5 / 2.5 / 4rem), `--gutter` 1.25rem, `--measure` 44rem, `--wrap` 72rem. Every margin, padding and gap of 0.5rem or more is a token; smaller values are optical nudges inside a component, and em values scale a control's padding with its own text **(tested)**. `--band-pad` is the block padding inside a band, band 1's included, and the space between sections in one band: `clamp(3rem, 9vw, 6rem)`, 48px on a phone, about 69px at 768px and 96px from about 1070px (raised twice on 23 September 2026 at the board's call that sections sat too close). Headings keep more space above than below: a section's `h2` has `--band-pad` above it and `--space-3` under it. `--rail` 9rem is the time column of a row from 48rem. `--radius` 0.375rem (buttons, fields, chips, choices), `--radius-card` 1rem, `--radius-tile` 0.25rem (the funding bar and the suit tile). `--target` 2.75rem, the 44px minimum. Card inset and grid gap are `--space-3`. Running text sets `text-wrap: pretty`, so a paragraph never ends on a lone word.

**Focus.** `:focus-visible` is a 3px solid outline in `--focus-colour` at a 2px offset **(tested)**: signal on paper (9.19; 7.16 on the work face), paper on the signal plate (9.19) and in an ink band (18.88) **(e2e)**. The offset gap, which shows the ground, keeps a paper ring apart from a paper-filled button or Contribute.

**Motion tokens.** `--dur-quick` 150ms, `--dur-move` 240ms, `--dur-flip` 400ms (two 200ms halves), `--stagger` 50ms, `--ease-out` `cubic-bezier(0.2,0,0,1)`, `--ease-in` `cubic-bezier(0.55,0,1,0.45)` **(tested)**.

## Colour

**The board's decision (23 September 2026):** the site takes real colour. The colour system (`docs/specs/home-and-design.md`, Decisions) replaces the direction's black-and-white-only rule: the page stays white with black bands and cards stay on white, every page opens on one signal plate, and each colour has one meaning. **Later the same day** the board judged the cobalt signal to read as MS-DOS and set it to ink (`#111111`) for now: the top bar and band 1 are black, the primary button and focus ring on paper are black, and pulling past the top of the page shows black, not white: browsers fill the overscroll with the root's solid background colour, so `html` paints `--signal`, `body` paints nothing (WebKit blends body's colour over the root's) and `.page` paints the paper. Pulling past the bottom shows black too **(tested)**.

**One colour, one meaning.**
- **Amber is money**: Contribute, the funding bar's fill, the coin mark and the Funded glyph's fill. Every amber shape keeps an ink edge on paper **(tested: `--coin` appears only in those rules)**.
- **Signal is the studio**: the band-1 plate and top bar, the primary action and focus ring on paper and work, the Picked ribbon, the studio suit tile and, as `--work`, the face of a card the agents hold.
- **Green is Live**: the Live glyph and the stamp's edge on paper. The word stays in the text colour.
- **Suits** are a tile in the suit's colour (Dust magenta, the studio signal) holding the glyph in paper, beside the label in the text colour.

**Do**
- Give every coloured thing a word or a glyph: suits, states, the ribbon.
- Read colours through roles, so a part draws correctly on any ground without a band class.
- Measure every new pairing before using it and add it to `src/lib/colour.ts`: body text at least 7, other text 4.5, controls and marks 3 **(tested)**. A new suit also passes the colour-vision gate: at least 25 delta-E from every other mark (the suits, `--live`, `--coin`) under normal vision, protanopia, deuteranopia and tritanopia (Machado 2009, CIE76) **(tested)**.

**Do not**
- Give text a colour. Text is ink or paper plus one muted tone per ground, and links are the text colour, underlined **(tested)**.
- Put signal next to ink (2.05): band 2 is always paper. Draw a second signal band or a signal footer.
- Put `--field`, `--muted`, `--coin-down`, a suit tile or live green on signal, or a suit tile or live green on ink: the roles reset them there **(tested)**.
- Make a card face signal, ink, a suit colour or any saturated colour, or put a card outside band 2.
- Use red anywhere (errors, Not built and money out included), gradients (but the Paused hatch), glows, shadows (but the change marker), neon, metallic or gold effects, or felt-green grounds **(tested)**. Not a casino.
- Use a creature fill outside an avatar, or a UI colour inside one.

**Charts** follow the funding bar: money is coin with 2px ink rules, held money is ink hatching over coin (never a second hue), other series are ink, and signal, suit and live colours never encode a quantity.

## Bands

Every public page is a stack of full-bleed bands:

1. A band's colour comes only from its position among the bands actually drawn: band 1 is the **signal** plate (the top bar shares it), even bands are **paper**, and odd bands from the third are **ink**. The footer takes the next position: ink after an even last band, paper after an odd one, never signal. Band 2 is always paper, so signal never touches ink. The change of ground is the only divider; nothing inside a band changes it.
2. Cards, funding bars, card-like choices and `/team`'s agent boxes sit only in band 2, which is always drawn (it shows its empty state rather than disappearing). A later band with nothing to show is not drawn, and the bands after it take their colour from their new position **(e2e: no `.card`, `.funding-bar`, `.choice` or `.agent` outside band 2, on every route and with empty data)**.
3. On signal and on ink, only the role values: paper for text, links, glyphs, edges, the pressed border, the change marker and the focus ring; the band's muted tone for secondary text; its hairline. Suit tiles and the Live mark reset to the text colour. The coin and Contribute stay as they are; avatars sit only on paper and ink (on a paper disc there), never on the signal plate.

**Set once, never per page** **(tested)**. Every direct child of `main` is a `.band`, `display: flow-root`, so no child margin opens a strip of page ground between two grounds **(e2e: every seam measures 0)**. `main > .band:first-child` and `.page:has(> main > .band:first-child) > .topbar` are signal; `main > .band:nth-child(even)` is paper; `main > .band:nth-child(2n + 3)` is ink; the footer is paper when `main`'s last band is odd and ink when it is even. The role resets hang off the same positional selectors, and no class names a band colour. A band holds one or more `h2` sections, `--band-pad` apart, with `--band-pad` above and below; band 1 takes the same `--band-pad` under the top bar, so the headline never sits jammed under it **(e2e: bands in order on every route)**. In band 1 the page heading has `--space-3` under it; on home the lede has `--space-4` before Play Dust, which has `--space-4` before the status line. On a page shorter than the window, band 1 takes the spare height and sets its heading at its foot. While any part of the page is loading, the last band takes it instead, so the heading never drops to the plate's foot and jumps back when the data arrives; every loading line carries `aria-busy="true"`, which is how the rule knows **(e2e: every title holds still while the data loads)**.

| Page | Bands, top to bottom |
|---|---|
| Home | **signal** (top bar, what it is, status line) · **paper** (Building now, Fund what's next, Queued) · **ink** (the team strip) · **paper** (Shipped, Planned next) · **ink** (Where the money goes) · **paper** footer |
| Home, no team roles loaded | signal · paper · **ink** (Shipped, Planned next) · **paper** (Where the money goes) · **ink** footer |
| `/contribute` | signal (intro, paused notice) · paper (Fund the next card in line, the choices, the split, the USD note) · ink footer |
| `/how-it-works` | signal (intro, paused notice) · paper (the video, then the six steps, each beside its example from 64rem) · ink (Where the money goes beside Holds and refunds and Rules that never change, from 64rem) · paper (Who runs it beside What code does and what the agents do, from 64rem) · ink footer |
| `/team` | signal · paper (Running, with the paused rows while the studio or a role is paused; Starts later; Planned) · ink (Who runs it) · paper footer |
| `/card/:id` | signal (the back link, the title as `h1`, the summary) · paper, one column at the reading measure at every width (the face and Play, or a planned card's roadmap state; the facts; What changed; Why it stopped; Supporters; What the agents did) · ink footer |
| `/thanks` | signal (Thank you, the supporter number, the paused notice) · paper (Where your money went, the held, waiting or reversed line, the terms line, Follow along) · ink footer |
| `/roadmap` | signal · paper (Next: For players, The studio, then board work closed, or open when it is the only group) · ink (Later, the same groups) · paper footer |
| `/ledger` | signal · paper (Funding) · ink (Money in) · paper (Stopped cards, only while there are any) · then Agent work and Deploys by position, ink and paper in turn · the footer on the ground after the last band |
| Terms, Privacy, Refunds, Contact | signal (title, lede) · paper (the text and its last-changed line) · ink footer |
| Not found | signal (title) · paper (the message and the Home button) · ink footer |

**The order trap.** Links inherit the band's colour. Contribute is an `<a>` with its own `color: var(--ink)` on `.button.btn-coin`, after the link rules, and no band rule repaints links, so Contribute stays ink on coin on every ground **(tested, e2e)**.

**Controls per ground.**

| Control | Paper and the work face | Signal | Ink |
|---|---|---|---|
| Primary | signal fill, paper label; hover signal-deep, press signal-press | paper fill, ink label; hover and press paper-hover | paper fill, ink label; hover and press paper-hover |
| Outline | paper fill, 1px ink edge and label; hover paper-hover, press line | signal fill, paper edge and label; hover signal-deep, press signal-press | ink fill, paper edge and label; hover and press ink-hover |
| Contribute | coin, ink edge and label; hover and press coin-down | coin, ink label; hover and press **coin-up** | coin; hover and press coin-down |
| Pressed | 3px currentColor border and the check glyph, in every mode | the same (paper) | the same (paper) |
| Links, change marker | ink | paper | paper |
| The mark | ink | paper | paper |

**Forced colours.** Every ground becomes Canvas, so each band after the first, and the footer, gets a 1px CanvasText top border; the mark, drawn in the text colour, becomes CanvasText; the Funded glyph's coin fill falls back to CanvasText and each suit tile gets a 1px CanvasText edge; the Picked ribbon and the Paused hatch are backgrounds and drop, and the word and glyph carry the state **(tested, e2e)**.

## Components

**The card** (`components/Card.tsx`, `CardFace`). An `li.card` with `data-face`: a white face, 2px ink edge, `--radius-card`, no shadow, natural height (no aspect floor, clamp or `overflow: hidden`).
1. The **index row** (small, 600, an 8px gap so the widest pair fits a three-column card): the suit tile and label at the start, the state glyph and word at the end. No pill and no border.
2. The **title** (`h3`, 20px, 700, balanced).
3. The **summary** (body), and on a card an agent wrote, the **byline** under it (small, muted): "Written by the <role>, an AI agent", the drafting role's title from the roles already loaded. It appears beside agent-written card text and nowhere else **(tested)**. The two share one block (`.card-text`) in the summary's place, so a card no agent wrote keeps its four parts as they were.
4. The **bottom block**, pinned so bars and buttons align across a row (from 48rem the card's four parts, index, title, summary with its byline, and bottom block, share their row's tracks by CSS subgrid, so the byline never sits on the bar and every card keeps 16px from its summary to its bottom block at every width; a fifth, empty track would still add a 24px grid gap above every bar **(e2e: agent card)**): the funding bar; the **spec rows** (`dl.spec-rows`, small, tabular, hairlines: "Funded $1.50 of $3.00" and "Contributors 2"; label muted, value ink); "Fund this card" (outlined, full width, 44px, described by the title), with the agreement line under it (small, muted: the Terms, the Refunds page and the age condition, drawn by `Funding.tsx` so no card layout can drop it; a live link only, never on a sample or example card); the native "What the agents are told" disclosure, or on a card with no brief an empty line of the same height, so its bar still lines up with the cards beside it **(e2e: layout balance)**.

The money in the bottom block comes from `Funding.tsx` (kernel). Modes: `live` (real links), `example` (`/how-it-works`: no link, button or disclosure at all), `sample` (the guide: the buttons drawn, `aria-disabled`, linking nowhere).

| Face | Stage | Look | Word and glyph | Bottom |
|---|---|---|---|---|
| open | proposed, designing | paper | Open for funding, coin outline | bar, rows, Fund this card |
| picked | voted | paper, a 6px signal ribbon inside the top edge | Picked by the board, flag | as open |
| funded | funded | paper | Funded, a tiny full bar filled with the coin | full bar, rows, "Waiting for the agents" (plain muted, 44px) |
| building | building | `--work` (the signal at 14%) | Building, gear | "Builder A is building this · $0.42 spent so far" (the role when the roles loaded, else who filed it); no bar |
| checks | gated | `--work` | Being checked, checklist | the role and spend; no per-check pips (no public per-check record) |
| live | live | paper | Live, checked stamp; the glyph in `--live-mark` | the shipped line, Play the game on a Dust card. The stamp (2px `--live-mark` border, turned −3°) only where asked; rows use the plain tag |
| paused | (guide only) | paper, a 6px hatched strip inside the top edge | Paused, two bars | bar and rows |
| rejected | (guide only) | paper, dashed edge | Not built, crossed card | the public reason and where its unspent money went |

No face is ever signal, ink or a suit colour, and no card sits outside band 2. The state word and glyph are ink in every state; colour only adds to them, through the face, the ribbon, the stamp or the Funded glyph's fill. Each state renders its word and a glyph of its own **(tested)**.

**Suits** (`Glyph.tsx`, `SUITS`, `SuitTag`). Two, from the card's folder (`categoryOf` in `lib/payment.ts`): the game ("Dust", a cartridge, on a `--suit-game` tile) and the studio ("The studio", a browser window, on a `--suit-studio` tile). A tile is 20px (`--radius-tile`) holding the 14px glyph in paper, beside the label in the text colour; on signal and ink the tile resets to transparent, so the suit is the paper glyph and label. The tile appears in the card index, the filter chips, and the Queued, Shipped and roadmap rows. The cartridge appears only on the game suit and on Play buttons **(tested: each folder has a suit with a label; no two share a glyph; e2e: the tile resets on signal and ink)**.

**Glyphs** (`Glyph.tsx`). 16px SVG, strokes and fills in `currentColor`, `aria-hidden` beside a word that says the same: the two suits, the eight state glyphs (each unique **(tested)**), the check (pressed), the pause (the status line), and the arrows (the font has none). The one fixed fill is the Funded glyph's coin (`.glyph-money`), because the bar it draws is money **(tested)**.

**The coin mark** (`CoinMark` in `Funding.tsx`, kernel, because it marks money). A 16px circle: 1.5px ink rim, the coin fill, one inner 1px ink ring. No notches, stripes or edge marks, never stacked. Only on Contribute and beside a dollar figure.

**The funding bar** (`FundingBar` in `Funding.tsx`). A 0.625rem paper track with a 1px ink outline and `--radius-tile`, `overflow: hidden`, `role="progressbar"` labelled by the card title. The fill is a full-width strip ending in a 2px ink rule, placed with `transform: translateX(max(calc(var(--fill) - 100%), calc(2px - 100%)))`, so the rule never scales and any money shows at least 2px; with no money there is no fill at all. The spec rows and the state word carry empty and full. Forced colours: the fill takes `Highlight` with a CanvasText rule **(tested)**. Call it the funding bar, never a coin slot.

**Buttons.** `.button` is the primary (filled from `--primary-*`), `.button-secondary` the outline, `.button-block` full width, `.btn-coin` Contribute (coin fill, ink text and edge, `--coin-hover` on hover and press: coin-down on paper and ink, coin-up on signal). All 600, at least 44px, `--radius`. **Pressed** (`aria-pressed="true"`): a 3px `currentColor` border plus the check glyph, in every mode, never `var(--ink)` **(tested, e2e)**.

**Filter chips** (`FilterChip`). `role="group"` of `button.filter`: the suit tile and label (or All) and a muted count; the pressed chip adds the check glyph and a 3px border. The studio chip shows only while a card is in it; a pressed chip that empties falls back to All. Below 30rem three chips stack one to a line, each at its own width; two share a line.

**The change rule.** A changed figure or row gets `.changed`: `box-shadow: inset 3px 0 0 currentColor` until the next poll, no layout (rows keep a constant 0.5rem inset for it). `currentColor`, never ink: paper on signal and in an ink band, ink on paper and on the work face **(tested, e2e)**. Forced colours drop it; the announcer carries funded and shipped.

**Live updates** (`lib/live.ts`). There is no updates row and nothing to press or pause (PLAN §10 decision 58). Each new snapshot is drawn as it arrives: a card in the fund grid that gained money ticks its bar, one that reached its target flips to Funded, and a card that arrives is dealt in; everything else simply redraws. Motion follows the Motion rules (at most three per poll, none in a hidden tab).

**The announcer.** One polite live region (`Announcer`, `role="status"`): funded and shipped are said once.

**Rows.** `ul.rows`: the title and text at the body size, the date, the rail and the meta line small, hairlines between rows, a constant 0.5rem inset. Queued, Shipped, the roadmap and the ledger's rows are rows, never cards. **Rail rows** (`ul.rows.rail`): the rail cell (the time, or for Queued and planned cards the suit tag) on its own line below 48rem and in the 9rem `--rail` column from 48rem, so every list's text column lines up. A shipped row reads: the date in the rail; the title; then the suit tag, the Live tag and what it cost and who funded it (`.row-meta`). There is no card page yet, so no row links to one. The ledger shows the ten newest agent actions and "Show all *n* agent actions", which shows the rest and moves focus to the eleventh; home shows five.

**Status line and paused notice.** The status line is home's one true sentence from data, its figures at 600 (`p.status-line`): how many cards are open, how many are building, and, with the pause glyph before it, the paused sentence (`pausedSentence`: the reason's sentence, or the general line when none is given); home says the pause only here. The glyph is a marker beside the sentence, so the layout audit leaves the pair alone (`data-balance="ignore"`). The paused notice (`p.notice`, kernel `PausedNotice`) says the same sentence as the status line in one plain 600 line with the pause glyph drawn in CSS (two 3px bars in `currentColor`), no box, in the page header on the signal plate of pages without a status line (`/contribute`, `/how-it-works`). Neither glyph can wrap onto a line of its own.

**Avatar** (`Avatar.tsx`). Every agent drawn as inline SVG from its one-line species note, unchanged in construction; fills from `--creature-*`, ink outlines, the note as its text alternative. Poses come only from data: `asleep` (eyes closed) for a role still to come (Starts later, Planned) and for a role the board paused on its own; running agents are drawn awake, also while the studio is paused (the board, 23 Sep 2026) **(tested)**. They never speak, plead or react to money.

**The team** (`/team`). Every member, in Running, Starts later and Planned alike, is the same box (the board, 26 September 2026): `li.agent` in a `ul.team-grid`, a 1px `--hairline` edge, `--radius` and `--space-3` padding, never a card's 2px ink edge. The avatar sits beside the name and the "AI agent" line; the description and the foot (the facts line with the Paused tag last, or the line saying when the role starts) run the full width, and the foot is pinned to the bottom, so the last lines and the tags line up across a row **(e2e)**. The three sections share one grid, so every box on the page is one width at every breakpoint, and from 48rem every box in a section is as tall as the tallest in it (rows of `1fr`); heights match within a section, not across, since a role still to come holds about half a running box's lines **(e2e)**. A role still to come keeps its asleep pose and its smaller avatar. Each role's section comes from the roster's own status and trigger through `lib/roster.ts` `teamStatus` (docs/specs/supporter-pages.md): a running or paused row shows its model, "Spent from contributions $x, $y in the last 7 days" and "Worked on n shipped cards"; a paused row carries the Paused tag and, when the board paused that role, its reason; the studio's pause is said once, in Running's intro. Other rows show their trigger and no model or cost. The team strip (`.team-strip`, borderless `.member` links to `/team#agent-<id>`) is home's: the first three roles on the team (running or paused), three equal columns from 48rem whether it shows one, two or three (the avatar over the name from 48 to 64rem).

**Home** (`pages/Landing.tsx`), in the board's order, drawn from the newest snapshot (`lib/live.ts`):
1. **What it is** (signal): the pitch as `h1`, the lede, Play free (primary, the cartridge) and How it works, then the status line.
2. **Building now** (only while a card builds), **Fund what's next** (its sentence, the filters, the grid in the waterfall's order, the same cards in the same order as /contribute's choices; a phone shows three cards and "Show all *n* cards", which reveals the rest and focuses the fourth card's title; with the waterfall's order loaded, only the open cards in it, so a card that takes no money, such as a vetoed one, is neither counted by the status line nor drawn without its Fund this card in a row of cards that have one; with the order unread, every open card, none with Fund this card, in the roadmap's order: the board's rank, unranked last, then the oldest) and **Queued** (rows) (paper, the only band with cards).
3. **The team** (ink): the team strip.
4. **Shipped** (the latest three) and **Planned next** (the next three planned titles) as rail rows, side by side from 64rem (3:2) and `--band-pad` apart when they stack, like any two sections, each linking to `/roadmap`; one alone takes the row (paper).
5. **Where the money goes** (ink): the pool with the coin, the split sentence from the fixed constants in `payment.ts`, "These are contributions, not donations.", the five latest agent actions and Full ledger.

**The top bar** (`App.tsx`, kernel), on the signal plate: below 32rem the mark (inline SVG in the text colour, the link named "Mob Machine"), Play (outline, the cartridge), Contribute (the coin) and **Menu**, a real button with `aria-expanded` that opens the page links as an inline list inside `nav`; Escape closes it and returns focus to the button, and a route change closes it. Below 22.5rem Play moves into the list. The wordmark shows from 32rem, and from 64rem the links sit in the row and Menu goes. One 60px row from 320px up, not sticky, wrapping only at 200% text **(e2e: at most 61px at 320 to 390px)**.

**`/contribute`** (kernel): **Fund the next card in line** first (the primary fill), whose second line names the first card in the waterfall's order ("Next in line: *title*"), says the money waits in Not on a card yet when no card takes money, and names no card when the order did not load ("Your contribution funds whatever the agents build next."); then "Or pick a card" with a choice per card in the funding order, in that order (1px ink, `--radius`, a funding bar), "Anything beyond a card's target funds the next cards in line.", the split and the USD note. With the order unread, "Not available right now." stands in for the choices. Directly under that first choice, before any card, the agreement line (small, muted): the Terms and the Refunds page as links and the age condition. It sits `--space-1` under the choice, as its caption, and keeps the choice's `--space-4` before "Or pick a card" **(e2e: layout balance, rhythm)**. A card anywhere draws its live Fund this card only while it is in the funding order.

**`/how-it-works`**: six steps, each its heading and text with the real component that shows it under it, in a dashed `--field` frame labelled real or made up. On a phone each step stacks its text over its example. From 64rem the page uses its full width (the board, 27 September 2026: the right side was left empty): the video spans it, each step's text sits beside its example (2:3) and stays in view (`position: sticky`) while a tall example scrolls past, the steps' list is `data-balance="ignore"` since the example sets the row's height, and the text bands set their sections in pairs (money 5:6 with Holds and refunds over the rules on the right; Who runs it 3:2 beside what code does). The second step's example works $5.00 paid through Stripe's fee ("about"), the reserve, the studio's share, the emergency fund and the agent credit as figure rows, then the waterfall's order as a numbered list. The last band names the board, what it can do, what it files and its standing duties (`legal.whoRuns`, repeated at the foot of `/team`), then what code does and what the agents do (`docs/specs/copy-pass.md`).

**`/roadmap`**: in each horizon's band, the cards for players (seed-1), then the studio's (platform), each an `h3` group with one muted line that says planned once and its rail rows (`h4` titles), then board work (`cards.board_work`) in a native `<details>` closed until opened, its `h3` inside the summary, the only group that says it is not funded by cards. When board work is a horizon's only group it is drawn open, as a plain group, under one muted line ("No card for players or the studio is here yet. The cards below are board work."), so a band never holds one closed summary and nothing else **(unit, e2e and layout audit)**. An empty group is not drawn. A row shows a state only when it is "Approved, opens soon" or "Held by the board"; no bar, status or link (`docs/specs/copy-pass.md`).

**The legal pages** (`pages/Legal.tsx`, kernel): text pages on two bands. The Terms and the Refunds page carry their version under the lede on the signal plate ("Version 2, in force since 24 Sep 2026 at 11:00 Toronto time.", every time in Toronto time) and end with an **Earlier versions** section (`h2`, then a bulleted list of 44px links, "Version 1, in force from … until …"). `/terms/n` and `/refunds/n` are titled "Terms, version n" and carry the range and "Read the version in force now" under the lede, and their Terms and Refunds links go to version n's pages. While the versions read runs, the page is drawn whole with the words it expects (the newest bundled version, or version n) and "Loading the terms." under the lede in place of the version line, so only that line changes when the read answers **(e2e)**; when it cannot confirm the version, the notice (`p.notice`) sits under the lede. Privacy ends with its own date.

**`/ledger`** (kernel): Funding (with Not on a card yet, and one line each for the shortfall and the board's test payment while they are above zero), Money in (the figures, or "No contributions yet.", then exactly one reconciliation line), Stopped cards (only while there are any), Agent work and Deploys, stacked full width, a band each, so no short block sits beside a long list. Stopped cards are the one public list of paused and rejected cards: rail rows, never card faces, the date stopped in the rail, then the title, the reason in plain words and the money (a paused card's state tag and that its money stays on it; a card that didn't ship, who funded it and where its unspent money went), under Paused and Didn't ship, each list drawn only with rows. A part whose read failed says "Not available right now." instead of a figure.

**`/card/:id`** (card lane; its money only through the kernel's `CardFacts`, `Supporters` and `StoppedFacts`): stacked at the reading measure at every width, since the face's height has nothing to do with the facts' and side by side one column always ended far above the other. The card face (the Live stamp on a live card) with Play, then the facts as spec rows (Funded $x of $y and Contributors unless the face above already shows them, Cost from contributions, Start to live, Checks passed at a time) and "Merged as the studio's commit abc1234" with no link; What changed on a live config card, one `code` row per checked value; Why it stopped with the same words and money trail as the card's /ledger row; Supporters in newspaper columns, filled down then across (the first 24, then "and n more", or "No supporters yet."); What the agents did as rail rows, runs collapsed with a count. Play steps through at most five recorded milestones with the site's own motion at a fixed pace and one polite announcement each, then reads Replay; under reduced motion there is no Play. The face's slot holds a hidden copy of every face Play can show, so it is always as tall as the tallest and the face stretches to it: nothing under the card, the Play button included, moves during Play **(e2e)**. A card on the roadmap (next or later, not started) takes no money and draws no face: it says its roadmap state ("Planned and not built yet", "Approved, opens soon", or "Held by the board" with the reason) and links the roadmap **(e2e)**. The page's body arrives after first paint, so its signal plate never grows to a short window (`main.title-stays`; the paper band takes the height left over) and the title renders once, where it stays **(e2e)**. An unknown or malformed id is the not found page with "There is no card at this address." Building and checks faces carry "Watch how it's built", and home's shipped rows "Watch how it was built", both to the card's page.

**`/thanks`** (kernel): the thank-you and the supporter number on the signal plate; on paper the cards the money reached as rows (title linking its page, one state line, the bar while open), then the held, waiting or reversed line, the terms line and Follow along ("Watch this card", "Follow the studio on Discord" with the Discord age line). While the payment is recording the paper band holds one busy line; after 3 minutes, or with no session, a plain thank-you with Home and Contribute. No amount appears anywhere on the page. Like `/card/:id`, every state keeps the signal plate to its title (`main.title-stays`), so the title does not move when the answer comes **(e2e)**.

**Stale and missing figures** are unchanged: a failed refresh keeps the figures and says so in `p.status` (`role="status"`); a part that did not load says "Not available right now." instead of a zero.

**How fresh the figures are.** The site reads its own cached documents (`docs/specs/site-snapshot.md`): a visible tab reads the figures once a minute, and a hidden tab reads nothing until the reader comes back, when it reads at once. Figures and stages run up to about three minutes behind the database, and card text up to about fifteen minutes. Nothing on the page may promise more: no "live" or "real time" wording near a figure, and a figure's change marker lasts until the next read, a minute later.

## Motion

Only `transform` and `opacity` move. Every `transition` and `animation` lives inside `@media (prefers-reduced-motion: no-preference)`, uses the duration and easing tokens, and never runs forever; there are no `@keyframes`, view transitions, `@starting-style` or `linear()` **(tested)**. Static transforms (the Live stamp's −3°, the bar's fill position) are geometry and allowed anywhere. `lib/motion.ts` plays each moment with the Web Animations API and, under reduced motion (anything but no-preference), applies the end state at once, so `document.getAnimations()` stays empty **(tested, e2e)**.

- **The explainer video** (`ExplainerVideo.tsx`, docs/specs/explainer-video.md) answers a press: a still poster until the viewer presses it, no autoplay, nothing fetched before the press, then the browser's own controls. Its frame holds the cut's shape (16:9, or 4:5 below 48rem), so pressing moves nothing.
- **Fund tick** (`funded_usd` rose on a card on screen): the fill moves from old to new over `--dur-move`, `--ease-out`; the spec rows swap at once.
- **Flip in place** (a card on screen reaches its target): rotateY 0 to 90° in 200ms `--ease-in`, the face swaps, 90 to 0° in 200ms. Same slot and height **(e2e)**.
- **Deal** (only when the viewer presses Show updates): new cards from translateY(−12px) rotate(−3°) and opacity 0, over `--dur-move`, `--stagger` apart.
- **Slam** (shipped, replay only in v1): scale 1.04 and 8px up, to rest, over `--dur-move`.
- **Press**: `:active` changes the fill in every mode and scales to 0.97. Keyboard focus never animates. No hover motion.

**Live changes** (`lib/changes.ts`). Motion comes only from a snapshot diff: never on first load, never in a hidden tab, at most three per poll (the rest apply at once). A card that would arrive, leave or reorder is held behind "Show *n* updates", and so is any text change that would change its box's height: `changesHeight` swaps the text node, measures and puts it back in the same task, so no shift is ever painted **(tested)**. The live studio is paused at launch, so the motion a visitor sees is mostly the replay they start; the rest is still.

## Breakpoints

- Below 22.5rem: Play moves into the Menu. Below 30rem three or more filter chips stack one to a line at their own width, and the footer's links sit in equal columns of at least 6.5rem, one to a cell (three at 375px, two full rows of six; two at 320px; one with 200% text), so no link or chip is left alone on a wrapped line. Below 32rem the wordmark is read out but not drawn; the mark stands for it.
- Fluid, with no breakpoint: `--size-h1`, `--size-h2` and `--band-pad` grow with the viewport.
- From 48rem: two-column card and team grids and the guide's demo grids; rail rows put their time in the rail; the team strip is three equal columns.
- From 64rem: the page links sit in the top bar and Menu goes; home's Shipped and Planned next sit side by side.
- From 72rem: three-column card and team grids. Below 72rem a third column squeezes card text until a short card is left hollow beside a long one (measured at 1024px on the launch cards: a 95px hollow), so two columns hold to 72rem.

## No dead space

**Side-by-side blocks balance or stack; nothing leaves an empty column; a grid puts one item in each cell.** The board caught two such gaps by eye (home's pitch beside a tall panel, the ledger's Funding beside a long Ledger); the site now catches them itself. `scripts/layout-audit.mjs` holds the checks, the layout balance e2e test (`e2e/layout-balance.spec.ts`) runs them on every public route and the guide at 320, 375, 768, 1024 and 1440px with the launch-shaped fixture (long lists), the default fixture, empty data and home with 1, 2, 4, 5 and 7 open cards, and it fails the gate on any finding **(e2e)**:

- **Balance:** two blocks side by side in one row (grid cells or flex items) differ in the height of what they draw by at most max(160px, 35% of the taller); what a closed `details` holds (a card's What the agents are told) is laid out but not drawn, so it is not counted. A block that must break this is marked `data-balance="ignore"` with a comment in the code saying why; none is today.
- **Hollow:** inside a band, no run of empty space between two blocks is longer than 240px (the last band's tail, which meets the footer on a short page, is not a hollow).
- **Overflow:** no element reaches past the viewport once its clipping ancestors apply, and the page never scrolls sideways.
- **Seams:** the top bar, every band and the footer touch exactly.
- **Grid cells** (the board, 26 September 2026; `docs/specs/grid-boxes.md`): a grid of like items puts one item in each cell. Card grids, the team grid and `.fill-grid` are one column on a phone, two equal columns from 48rem and three from 72rem; every item is one column wide, so every item in a grid is one width. Rows fill from the left and the last row may be part-empty; nothing spans two columns, and a lone item is one cell wide, not the reading measure. A lone example card (`/how-it-works`, the guide's demos) is one three-column cell wide (`23rem`), and the dashed example frame around it hugs it (`width: fit-content`). The audit finds an item wider than one column and a row that starts inside the grid's edge. No real card is ever hidden, and the order never changes.
- **Frames:** a box with an edge on every side that holds a card, a row or a box is filled by it: what it holds reaches within 2px of its inner right edge, so no empty column runs down beside a card inside a dashed example frame (the hollow check measures only vertical runs). A box that holds only text is not checked, and neither is a chip or swatch under 96px wide.
- **Card rows**, from 768px: bottoms, titles and funding bars line up, the hollow above a card's bottom block is at most 80px, and the corner index never wraps.
- **Rhythm:** a heading sits at least as far below the block before it as that block sits below its own predecessor, so a caption line stays with what it captions and never reads as the start of the next section.
- **Buttons** keep their label on one line; no glyph under 32px wide is left alone on a wrapped line; the top bar is one row of at most 61px from 360 to 390px.
- **Orphans** (the review of 26 September 2026: the footer's Discord link alone on a line at 330 to 440px): at any width, no list item, link or button sits alone on a wrapped line of a row whose other lines hold two or more. A row stacked one to a line is a column, and a meta line of text pieces wraps as prose does. The fix is a grid, one item to a cell, or a column, never a stretched item.

The audit bites: `e2e/layout-balance.spec.ts` plants each kind of gap in a page and expects a finding for each, and run on the site before this change it finds the pitch beside the Right now panel 166px apart and Funding beside the Ledger 1,414px apart.

The whole end-to-end folder, this suite and its fixtures with it, is kernel (`docs/specs/design-review.md`), so no card can switch a check off, and it runs in the gate's platform job on every site change. Its routes come from one list, `e2e/routes.ts`, and a unit test fails when a page in `src/routes.tsx` is missing from it.

## Mockups

Mockup and design-system cards are not built yet (`docs/BACKLOG.md`, Mockup and design-system cards): until they are, a new page, a new screen or a design-system change is a board pull request, since the files that set the look are board-only (Design files and review, below). A design change ships with a mockup built from the real components, not a picture of one, and **every preview, mockup and design sync passes the gap audit before anyone sees it**: `node scripts/gap-audit.mjs <url-or-html-file>` runs the same checks at 1440, 1024, 768, 375 and 320px and prints "gap audit clean at 1440, 1024, 768, 375, 320", which is quoted beside the mockup when it is shown to the board. Findings are fixed first, never explained away.

- **The design guide** is the design system's mockup: an unlisted route, `/design-kit-7q4m` (in `routes.tsx`, with no top bar link, linked from nowhere, and `noindex, nofollow` while open). On the signal plate: the controls, the status line, the notice, rows with the change marker and the mark. On paper: all eight faces in two groups by anatomy, the bar at 5, 50 and 100%, the coin, glyphs, suit tiles and chips, the controls, rows, empty, loading and error lines, **every colour token and every pairing measured on the page from `tokens.css`, and the colour rules**, and Play buttons for the deal, the fund tick, the flip and the slam. On ink: the controls (Contribute as a link, for the order trap), rows with the tiles reset, and the team strip asleep and awake. Everything made up for it is labelled Sample; the team strip draws the real roles.
- **The home page** is the home-and-design pull request's mockup.
- Screenshots of every route in `e2e/routes.ts` at 375, 768 and 1440px with reduced motion, full page, named `<route>-<width>.png`, come from `E2E_ROUTE_SHOTS=<folder> E2E_PORT=<port> pnpm --filter @backseat/site exec playwright test e2e/route-shots.spec.ts` (the launch-shaped fixture); the run fails on a request to any origin but the preview, and on a data route still loading or showing its unavailable or stale line. The guide and home at 375 and 1440 come from `E2E_SCREENSHOTS=<folder>` (`e2e/design.spec.ts`).

## Design files and review

**The files that set the look are board work; a Director looks at every visual card before it merges** (`docs/specs/design-review.md`, PLAN §4 Work).

- **Board-only design files** (`platform/gate/design-paths.txt`): `src/tokens.css`, `src/components/Card.tsx`, `src/components/Glyph.tsx`, `src/lib/motion.ts`, `src/routes.tsx`, `public/`, `brand/` and the game's `seed-1/render/favicon.svg`. No card may change one: the dispatcher refuses the card before any gate run and the gate's kernel guard fails a card branch that does. They are not kernel, so the kernel import rule does not bind them; a board pull request changes them, which the board sees before it merges.
- **Frames.** A change to a render path (a non-test file under `src/`, or anything under `public/`, `e2e/`, `seed-1/render/` or `seed-1/e2e/`, or either `index.html`, or the game's `content/strings.json`) runs the gate's `frames` job: the route screenshots above and the game's canvas at four fixed states and its page at 375, drawn on the base and on the change, the ones that differ byte for byte kept as before and after pairs. Frames are pictures for a reviewer, not a pass or fail test: the design suite is that.
- **The review.** After the card's gate passes, the Platform Director (a site card) or the Game Director (a game card) compares each pair against `platform/agents/rubrics/visual.md`: intent, fit with this document and the card metaphor, legibility at each width (no dead space, stray gaps or unbalanced columns; nothing cramped, overlapping or cut off) and all ages. It never measures sizes, spacing or counts; the design suite does. A revise goes back to the builder as the criterion, the frame and a reason code, at most twice.

## Rules changed

By the design system: italic nowhere (was: the wordmark only); the contrast test covers every ground (was: white only); cards have a 2px ink edge and `--radius-card`, choices 1px ink and `--radius` (was: `--line` boxes with `--radius-box`); a card has four text styles; card `h3` moves from body to lead; `--paper` is the page ground; `--accent`, `--track` and `--radius-box` retire; the paused notice has no box; `/team` rows are `li.agent`, not `li.card.role`.

By home and design (`docs/specs/home-and-design.md`): black and white only becomes the colour system (the board's decision); principle 10 becomes one colour, one meaning; band 1 is signal (was: odd bands ink from the first); "No suit fills" becomes the suit tile; the focus ring on paper is signal (was: ink); the primary button on paper is signal (was: ink); `--work` is `#dfe2f7` (was `#d4e1ee`); the top bar's 30rem rule becomes the Menu; the landing order becomes the board's; the Right now panel goes; three-column grids start at 72rem (was: 64rem); `/how-it-works` stacks each step (was: text beside its example; the board put the text back beside its example from 64rem on 27 September 2026); the ledger stacks its bands (was: Funding beside the Ledger); No dead space is a rule, checked in the gate.

By the type scale (the board's call, 23 September 2026): the page heading is 33px to 56px with the viewport (was 30px), section headings 24px to 32px (was 24px), every `h3` 20px and bold (was 17px and 600 but on cards); `--size-large` and `--size-display` become `--size-h2` and `--size-h1`; `--band-pad` is fluid, 48px to 96px (was 40px, then 64px from 48rem), and band 1 takes it under the top bar (was 40px); a row's title and text take the body size (was 14px), so the roadmap and home's Shipped and Planned next no longer read as fine print; home's Shipped and Planned next stack `--band-pad` apart (was `--space-4`); the test pinning five exact sizes on a 1.2 ratio becomes the check that every font-size and every spacing value comes from a token; the roadmap's old `h4` rule goes, and `h4` (the ledger's stopped-card titles) takes the heading rule with `h1` to `h3`; the text pages' section margin, the `.hero` and `.section` bottom margins and their resets go, since the band rule overrode them on every route (checked by deleting them from the live stylesheet on every route at 375 to 1440px, with no element moving).

By grid boxes (`docs/specs/grid-boxes.md`, the board's order of 26 September 2026): the fill rule goes, and a grid puts one item in each cell with its last row part-empty (was: the last one to four items stretched to fill the row, a lone card at the reading measure); `/team`'s members are boxes with a hairline edge (was: plain rows, "never a bordered tile"), and the roles still to come sit in the same boxes (was: compact tiles down CSS columns); the Paused tag sits under the facts line (was: above it); the team strip is three equal columns (was: one column per member); the layout audit's grid fill check becomes grid cells.

## Copy rules

The full rules, including the voice rules (winks, coins never a currency, no chance words beside money, the minus sign, characters inside the font), are in `docs/COPY.md`; `src/lib/copy.test.ts` enforces the tested ones. In short: plain, short and declarative; "contributions", never "donations"; money is `$0.00`; never describe something that does not exist yet.

## Accessibility checklist

- One `h1` per page; headings never skip a level.
- The contrast set above; control edges at least 3:1.
- Every interactive element is reachable by keyboard and shows the focus ring (signal on paper and work, paper on signal and ink).
- Touch targets are at least 44px tall.
- No horizontal scroll at 320, 360, 375, 390, 768, 1024 and 1440px on every route, nor at 375px with 200% text **(e2e)**.
- axe finds no WCAG 2.2 AA violation on every route at 375 and 1440px, nor inside the guide's signal plate and ink band **(e2e)**.
- No dead space on any route at 320 to 1440px **(e2e: layout balance)**.
- Information is never carried by colour alone or hidden behind hover.
