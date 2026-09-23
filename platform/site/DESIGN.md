# Peanut Gallery site style guide

The one source of truth for how the public site looks and moves. The board's own site (`platform/board`, docs/specs/board-site.md) keeps its own stylesheet and form rules. The approved direction behind this guide is `docs/specs/design-system.md`; the home page, the top bar, the bands on every page, the colour system and the layout audit are `docs/specs/home-and-design.md`.

Tokens live in `src/tokens.css`; the rules in `src/styles.css`, which imports it first. `src/styles.test.ts` enforces the rules marked **(tested)**, and the Playwright suite (`e2e/design.spec.ts`) the ones marked **(e2e)**.

## Brand, in one paragraph

A quiet, precise table (Teenage Engineering's precision) where real cards (Cards Against Humanity's card-as-object, never its tone) are funded with arcade coins and built by a cast of code-drawn aliens. The card is the object and the page is the table: cards carry the edge, the face and the motion, and everything else is quiet type on a white page. Every page opens on one cobalt plate, the studio's colour; below it full-bleed bands rotate white and black. Three motifs only: the card, the coin (money) and the peanut mark. All ages: no theatre or balcony imagery, no chips, dice or other gambling cues, no shock. The site publishes no origin story for its name.

## Principles

1. **One grid, readable lines.** The top bar, the page and the footer share one width (`--wrap`, 72rem), so every left edge lines up. Text never runs wider than `--measure` (44rem). Short, repeated items (cards, steps, figure groups) sit side by side on wide screens and stack on phones.
2. **Sentence case, upright.** Headings are bold, not shouting. Uppercase appears only in the wordmark, and italic nowhere: the one font file has no italic, and `font-synthesis-style: none` stops the browser inventing one **(tested)**.
3. **Show, don't hide.** Anything a reader needs to understand a figure or a card is written beside it. No tooltips and no icon that needs a tap. **A word and a glyph, never colour alone**: states, suits, pauses and money direction each carry a word.
4. **Measured contrast** **(tested)**, WCAG 2.x, on every ground: every pairing the site draws is listed in `src/lib/colour.ts` with its floor (7 for body text, 4.5 for other text, 3 for controls and marks) and checked against `tokens.css`; each banned pairing is checked to stay below its floor, and a rule keeps it off the page (Colour, below).
5. **Edges make objects.** Cards have a 2px ink edge and `--radius-card` corners, and no shadow: a white card on the white page measures 1.00, so the edge is what makes it read. Choices, buttons and fields use 1px and `--radius`. Everything else is separated by space and, in lists, by hairlines. `--radius-box` and the Right now panel are retired; home's status line says what the panel said.
6. **Things you can press look pressable.** Links are underlined, and buttons are filled or outlined boxes at least 44px tall **(tested)**. Buttons never set `nowrap`: a long label wraps inside its box.
7. **Every public string lives in `src/lib/copy.ts`, or in `src/lib/legal.ts`.** `legal.ts` is kernel and holds the legal pages, the fixed rules and every statement of money: the money rules, the labels and descriptions of money and ledger figures (including a card's spec-row labels), the ledger's row words and the funding caption. Pages read it directly; `copy.ts` never repeats it. The unlisted guide's colour table keeps its words beside the data they describe, in `src/lib/colour.ts`.
8. **Three text styles to a block, four on a card.** A block uses at most a heading, body text and one small muted line, plus its button. A card has four: the index row, the title, the summary and the spec rows, because the spec rows are the precision the table asks for.
9. **Headings balance their lines** (`text-wrap: balance`) **(tested)**.
10. **One colour, one meaning.** Coin amber means money, signal (ink, since the board's call of 23 September 2026) means the studio, green means Live. No colour is ever a text colour **(tested)**, and every coin shape has an ink edge on paper (coin on paper is 2.25).
11. **Motion records a real change or answers a press.** First paint is still. Nothing a viewer might tap moves while they look (see Motion).
12. **No dead space.** Side-by-side blocks balance or stack; nothing leaves an empty column, a hollow in a band, or an empty grid cell. The layout audit checks it on every page, and every mockup passes it before anyone sees it **(e2e: layout balance)**.

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

**Roles.** Components read role tokens, never grounds: `--text-muted`, `--hairline`, `--focus-colour`, `--primary-bg/-fg/-hover/-press`, `--outline-bg/-fg/-hover/-press`, `--coin-hover`, `--quiet-fg`, `--quiet-edge`, `--mark-filter`, `--suit-tile-game`, `--suit-tile-studio` and `--live-mark`. `:root` sets them for paper; the signal plate and the ink bands reset them from their position (Bands). So nothing needs a band class to draw correctly on any ground.

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
| `--mark-filter` | none | `invert(1)` | `invert(1)` |
| `--suit-tile-game` / `-studio` | suit-game / suit-studio | transparent | transparent |
| `--live-mark` | live | currentColor | currentColor |

**Type.** One family, one file: Atkinson Hyperlegible Next (SIL OFL 1.1, `public/fonts/OFL.txt`), `public/fonts/atkinson-hyperlegible-next-400-700.woff2`, 18,208 bytes, weights 400 to 700, features `kern`, `tnum`, `case` and `locl`, characters U+0020–007E, U+00A0–00FF, U+2010–2027 and U+2212. `scripts/fonts.sh` cuts it from `brand/fonts/AtkinsonHyperlegibleNext-VF.ttf` and pins the features (pyftsubset's defaults drop `tnum`) **(tested: `tnum` is in the file's GSUB; the file is at most 18,208 bytes)**. It loads same-origin under `/fonts/` with `font-display: swap` **(tested)**, preloaded from `index.html` **(tested)**; the CSP stays `font-src 'self'` **(e2e: font requests are same-origin)**. While it loads, text sets in Arial scaled by fallback metrics computed from the file by `scripts/font-metrics.py`, never guessed **(tested)**. `--font-mono` stays the system stack for commit shas.

| Token | Value | Use |
|---|---|---|
| `--weight-body` / `--medium` / `--strong` / `--bold` | 400 / 500 / 600 / 700 | Body / nav / labels, buttons, figures / headings, card titles, wordmark. Nothing below 400 **(tested)** |
| `--leading-body` / `--leading-heading` | 1.6 / 1.25 | |

Five sizes on a 1.2 ratio from a 17px body; every font-size is one of them **(tested)**.

| Token | Size | Roles |
|---|---|---|
| `--size-small` | 14px | Meta lines, the card's index row and spec rows, rows, the footer, captions |
| `--size-body` | 17px | Paragraphs, nav, buttons, the wordmark |
| `--size-lead` | 20px | The lede, figures, **card titles (`.card h3`, 700, balanced)** **(tested)** |
| `--size-large` | 24px | Section headings (`h2`) |
| `--size-display` | 30px | The page heading (`h1`), once per page |

Money and counts use tabular figures.

**Space and shape.** `--space-1` … `--space-5` (0.5 / 1 / 1.5 / 2.5 / 4rem), `--gutter` 1.25rem, `--measure` 44rem, `--wrap` 72rem. `--band-pad` is the block padding inside a band: `--space-3` below 48rem, `--space-4` from 48rem. `--rail` 9rem is the time column of a row from 48rem. `--radius` 0.375rem (buttons, fields, chips, choices), `--radius-card` 1rem, `--radius-tile` 0.25rem (the funding bar and the suit tile). `--target` 2.75rem, the 44px minimum. Card inset and grid gap are `--space-3`. Running text sets `text-wrap: pretty`, so a paragraph never ends on a lone word.

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
2. Cards, funding bars, card-like choices and `/team`'s agent rows sit only in band 2, which is always drawn (it shows its empty state rather than disappearing). A later band with nothing to show is not drawn, and the bands after it take their colour from their new position **(e2e: no `.card`, `.funding-bar`, `.choice` or `.agent` outside band 2, on every route and with empty data)**.
3. On signal and on ink, only the role values: paper for text, links, glyphs, edges, the pressed border, the change marker and the focus ring; the band's muted tone for secondary text; its hairline. Suit tiles and the Live mark reset to the text colour. The coin and Contribute stay as they are; avatars sit only on paper and ink (on a paper disc there), never on the signal plate.

**Set once, never per page** **(tested)**. Every direct child of `main` is a `.band`, `display: flow-root`, so no child margin opens a strip of page ground between two grounds **(e2e: every seam measures 0)**. `main > .band:first-child` and `.page:has(> main > .band:first-child) > .topbar` are signal; `main > .band:nth-child(even)` is paper; `main > .band:nth-child(2n + 3)` is ink; the footer is paper when `main`'s last band is odd and ink when it is even. The role resets hang off the same positional selectors, and no class names a band colour. A band holds one or more `h2` sections, `--space-4` apart, with `--band-pad` above and below; band 1 sits `--space-2` under the top bar **(e2e: bands in order on every route)**.

| Page | Bands, top to bottom |
|---|---|
| Home | **signal** (top bar, what it is, status line, live-updates row) · **paper** (Building now, Fund what's next, Queued) · **ink** (the team strip) · **paper** (Shipped, Planned next) · **ink** (Where the money goes) · **paper** footer |
| Home, no team roles loaded | signal · paper · **ink** (Shipped, Planned next) · **paper** (Where the money goes) · **ink** footer |
| `/contribute` | signal (intro, paused notice) · paper (Fund the next card in line, the choices, the split, the USD note) · ink footer |
| `/how-it-works` | signal (intro, paused notice) · paper (the six steps, each over its example) · ink (Where the money goes, Holds and refunds, Rules that never change) · paper footer |
| `/team` | signal · paper (Running, then Not running yet) · ink footer |
| `/roadmap` | signal · paper (Next) · ink (Later) · paper footer |
| `/ledger` | signal · paper (Funding) · ink (Agent work) · paper (Deploys) · ink footer |
| Terms, Privacy, Refunds, Contact | signal (title, lede) · paper (the text and its last-changed line) · ink footer |
| Not found | signal (title) · paper (the message and the Home button) · ink footer |

**The order trap.** Links inherit the band's colour. Contribute is an `<a>` with its own `color: var(--ink)` on `.button.btn-coin`, after the link rules, and no band rule repaints links, so Contribute stays ink on coin on every ground **(tested, e2e)**.

**Controls per ground.**

| Control | Paper and the work face | Signal | Ink |
|---|---|---|---|
| Primary | signal fill, paper label; hover signal-deep, press signal-press | paper fill, ink label; hover and press paper-hover | paper fill, ink label; hover and press paper-hover |
| Outline | paper fill, 1px ink edge and label; hover paper-hover, press line | signal fill, paper edge and label; hover signal-deep, press signal-press | ink fill, paper edge and label; hover and press ink-hover |
| Contribute | coin, ink edge and label; hover and press coin-down | coin, ink label; hover and press **coin-up** | coin; hover and press coin-down |
| Quiet ("Up to date") | muted label, field edge | muted-on-signal label and edge | muted-on-ink label, field edge |
| Pressed | 3px currentColor border and the check glyph, in every mode | the same (paper) | the same (paper) |
| Links, change marker | ink | paper | paper |
| Peanut mark | as drawn | inverted | inverted |

**Forced colours.** Every ground becomes Canvas, so each band after the first, and the footer, gets a 1px CanvasText top border; the peanut's filter is dropped; the Funded glyph's coin fill falls back to CanvasText and each suit tile gets a 1px CanvasText edge; the Picked ribbon and the Paused hatch are backgrounds and drop, and the word and glyph carry the state **(tested, e2e)**.

## Components

**The card** (`components/Card.tsx`, `CardFace`). An `li.card` with `data-face`: a white face, 2px ink edge, `--radius-card`, no shadow, natural height (no aspect floor, clamp or `overflow: hidden`).
1. The **index row** (small, 600, an 8px gap so the widest pair fits a three-column card): the suit tile and label at the start, the state glyph and word at the end. No pill and no border.
2. The **title** (`h3`, 20px, 700, balanced).
3. The **summary** (body).
4. The **bottom block**, pinned so bars and buttons align across a row: the funding bar; the **spec rows** (`dl.spec-rows`, small, tabular, hairlines: "Funded $1.50 of $3.00" and "Contributors 2"; label muted, value ink); "Fund this card" (outlined, full width, 44px, described by the title); the native "What the agents are told" disclosure, or on a card with no brief an empty line of the same height, so its bar still lines up with the cards beside it **(e2e: layout balance)**.

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

**Buttons.** `.button` is the primary (filled from `--primary-*`), `.button-secondary` the outline, `.button-block` full width, `.btn-coin` Contribute (coin fill, ink text and edge, `--coin-hover` on hover and press: coin-down on paper and ink, coin-up on signal), `.button-quiet` the "Up to date" state. All 600, at least 44px, `--radius`. **Pressed** (`aria-pressed="true"`): a 3px `currentColor` border plus the check glyph, in every mode, never `var(--ink)` **(tested, e2e)**.

**Filter chips** (`FilterChip`). `role="group"` of `button.filter`: the suit tile and label (or All) and a muted count; the pressed chip adds the check glyph and a 3px border. The studio chip shows only while a card is in it; a pressed chip that empties falls back to All.

**The change rule.** A changed figure or row gets `.changed`: `box-shadow: inset 3px 0 0 currentColor` until the next poll, no layout (rows keep a constant 0.5rem inset for it). `currentColor`, never ink: paper on signal and in an ink band, ink on paper and on the work face **(tested, e2e)**. Forced colours drop it; the announcer carries funded and shipped.

**The live-updates row** (`LiveUpdates.tsx`). Laid out from first paint: "Pause live updates" (`aria-pressed`) first, then the updates button, which is always there. With nothing waiting it reads "Up to date" and is `aria-disabled` (never `disabled`, so it keeps focus); with changes waiting, "Show *n* updates", capped at 99+. Both labels share one grid cell with the longest one hidden, so its width never changes **(e2e: neither button moves when the label changes; focus stays after a press)**. While paused, the row says "Live updates are paused." The count is announced on none to some, at most once a minute.

**The announcer.** One polite live region (`Announcer`, `role="status"`): funded and shipped are said once.

**Rows.** `ul.rows`: small text, hairlines between rows, a constant 0.5rem inset. Queued, Shipped, the roadmap and the ledger's rows are rows, never cards. **Rail rows** (`ul.rows.rail`): the rail cell (the time, or for Queued and planned cards the suit tag) on its own line below 48rem and in the 9rem `--rail` column from 48rem, so every list's text column lines up. A shipped row reads: the date in the rail; the title; then the suit tag, the Live tag and what it cost and who funded it (`.row-meta`). There is no card page yet, so no row links to one. The ledger shows the ten newest agent actions and "Show all *n* agent actions", which shows the rest and moves focus to the eleventh; home shows five.

**Status line and paused notice.** The status line is home's one true sentence from data, its figures at 600 (`p.status-line`): how many cards are open, how many are building, and, with the pause glyph before it, whether the agents are paused; home says the pause only here. The paused notice (`p.notice`, kernel `PausedNotice`) is one plain 600 line with the pause glyph drawn in CSS (two 3px bars in `currentColor`), no box, in the page header on the signal plate of pages without a status line (`/contribute`, `/how-it-works`). Neither glyph can wrap onto a line of its own.

**Avatar** (`Avatar.tsx`). Every agent drawn as inline SVG from its one-line species note, unchanged in construction; fills from `--creature-*`, ink outlines, the note as its text alternative. Poses come only from data: `asleep` (eyes closed) while `public_studio.paused` is true and the studio row loaded; the default drawing otherwise **(tested)**. They never speak, plead or react to money.

**The team** (`/team`). Rows of `li.agent` (avatar, name, "AI agent", description, facts), never a bordered tile, which would read as a card. On a phone the avatar floats beside the name and the text wraps under it; from 48rem the avatar sits on top and the facts line is pinned to the bottom, so it lines up across a row. The team grid follows the card grid's fill rule. The team strip (`.team-strip`, borderless `.member` links to `/team#agent-<id>`) is home's: the first three running roles, one row with one column per member from 48rem (the avatar over the name from 48 to 64rem).

**Home** (`pages/Landing.tsx`), in the board's order, drawn from one snapshot held still while the page is open (`lib/live.ts`):
1. **What it is** (signal): the pitch as `h1`, the lede, Play Dust (primary, the cartridge) and How it works, the status line, then the live-updates row.
2. **Building now** (only while a card builds), **Fund what's next** (its sentence, the filters, the grid in funding order; a phone shows three cards and "Show all *n* cards", which reveals the rest and focuses the fourth card's title) and **Queued** (rows) (paper, the only band with cards).
3. **The team** (ink): the team strip.
4. **Shipped** (the latest three) and **Planned next** (the next three planned titles) as rail rows, side by side from 64rem (3:2), each linking to `/roadmap`; one alone takes the row (paper).
5. **Where the money goes** (ink): the pool with the coin, the split sentence from the fixed constants in `payment.ts`, "These are contributions, not donations.", the five latest agent actions and Full ledger.

**The top bar** (`App.tsx`, kernel), on the signal plate: below 32rem the peanut mark (named "Peanut Gallery"), Play (outline, the cartridge), Contribute (the coin) and **Menu**, a real button with `aria-expanded` that opens the page links as an inline list inside `nav`; Escape closes it and returns focus to the button, and a route change closes it. Below 22.5rem Play moves into the list. The wordmark shows from 32rem, and from 64rem the links sit in the row and Menu goes. One 60px row from 320px up, not sticky, wrapping only at 200% text **(e2e: at most 61px at 320 to 390px)**.

**`/contribute`** (kernel): **Fund the next card in line** first (the primary fill), which names no card: money given with no card funds later cards (PLAN.md §4), and the block says so in the words it had, "Your contribution funds whatever the agents build next.", until the waterfall's order is public; then "Or pick a card" with a choice per open card (1px ink, `--radius`, a funding bar), the split and the USD note.

**`/how-it-works`**: six steps, each its heading and text with the real component that shows it under it, in a dashed `--field` frame labelled real or made up, all held to the reading measure: stacked at every width, so a short text never floats beside a tall example.

**`/ledger`** (kernel): Funding, Agent work and Deploys stacked full width, a band each, so no short block sits beside a long list.

**Stale and missing figures** are unchanged: a failed refresh keeps the figures and says so in `p.status` (`role="status"`); a part that did not load says "Not available right now." instead of a zero.

## Motion

Only `transform` and `opacity` move. Every `transition` and `animation` lives inside `@media (prefers-reduced-motion: no-preference)`, uses the duration and easing tokens, and never runs forever; there are no `@keyframes`, view transitions, `@starting-style` or `linear()` **(tested)**. Static transforms (the Live stamp's −3°, the bar's fill position) are geometry and allowed anywhere. `lib/motion.ts` plays each moment with the Web Animations API and, under reduced motion (anything but no-preference), applies the end state at once, so `document.getAnimations()` stays empty **(tested, e2e)**.

- **Fund tick** (`funded_usd` rose on a card on screen): the fill moves from old to new over `--dur-move`, `--ease-out`; the spec rows swap at once.
- **Flip in place** (a card on screen reaches its target): rotateY 0 to 90° in 200ms `--ease-in`, the face swaps, 90 to 0° in 200ms. Same slot and height **(e2e)**.
- **Deal** (only when the viewer presses Show updates): new cards from translateY(−12px) rotate(−3°) and opacity 0, over `--dur-move`, `--stagger` apart.
- **Slam** (shipped, replay only in v1): scale 1.04 and 8px up, to rest, over `--dur-move`.
- **Press**: `:active` changes the fill in every mode and scales to 0.97. Keyboard focus never animates. No hover motion.

**Live changes** (`lib/changes.ts`). Motion comes only from a snapshot diff: never on first load, never in a hidden tab, at most three per poll (the rest apply at once). A card that would arrive, leave or reorder is held behind "Show *n* updates", and so is any text change that would change its box's height: `changesHeight` swaps the text node, measures and puts it back in the same task, so no shift is ever painted **(tested)**. The live studio is paused at launch, so the motion a visitor sees is mostly the replay they start; the rest is still.

## Breakpoints

- Below 22.5rem: Play moves into the Menu. Below 30rem the live-updates row stacks full width. Below 32rem the wordmark is read out but not drawn; the peanut stands for it.
- From 48rem: two-column card and team grids and the guide's demo grids; rail rows put their time in the rail; the team strip is one row; `--band-pad` grows.
- From 64rem: the page links sit in the top bar and Menu goes; home's Shipped and Planned next sit side by side.
- From 72rem: three-column card and team grids. Below 72rem a third column squeezes card text until a short card is left hollow beside a long one (measured at 1024px on the launch cards: a 95px hollow), so two columns hold to 72rem.

## No dead space

**Side-by-side blocks balance or stack; nothing leaves an empty column.** The board caught two such gaps by eye (home's pitch beside a tall panel, the ledger's Funding beside a long Ledger); the site now catches them itself. `scripts/layout-audit.mjs` holds the checks, the layout balance e2e test (`e2e/layout-balance.spec.ts`) runs them on every public route and the guide at 320, 375, 768, 1024 and 1440px with the launch-shaped fixture (long lists), the default fixture, empty data and home with 1, 2, 4, 5 and 7 open cards, and it fails the gate on any finding **(e2e)**:

- **Balance:** two blocks side by side in one row (grid cells or flex items) differ in the height of what they draw by at most max(160px, 35% of the taller). A block that must break this is marked `data-balance="ignore"` with a comment in the code saying why; none is today.
- **Hollow:** inside a band, no run of empty space between two blocks is longer than 240px (the last band's tail, which meets the footer on a short page, is not a hollow).
- **Overflow:** no element reaches past the viewport once its clipping ancestors apply, and the page never scrolls sideways.
- **Seams:** the top bar, every band and the footer touch exactly.
- **Grid fill:** a grid of like items fills every row it draws. Card grids, the team grid and `.fill-grid` follow the fill rule: two columns are four tracks and an odd last card takes the row; three columns are six tracks and the last two or four cards share their rows in halves; one card keeps the reading measure. No real card is ever hidden, and the order never changes.
- **Card rows**, from 768px: bottoms, titles and funding bars line up, the hollow above a card's bottom block is at most 80px, and the corner index never wraps.
- **Buttons** keep their label on one line; no glyph under 32px wide is left alone on a wrapped line; the top bar is one row of at most 61px from 360 to 390px.

The audit bites: `e2e/layout-balance.spec.ts` plants each kind of gap in a page and expects a finding for each, and run on the site before this change it finds the pitch beside the Right now panel 166px apart and Funding beside the Ledger 1,414px apart.

## Mockups

A design change ships with a mockup built from the real components, not a picture of one, and **every preview, mockup and design sync passes the gap audit before anyone sees it**: `node scripts/gap-audit.mjs <url-or-html-file>` runs the same checks at 1440, 1024, 768, 375 and 320px and prints "gap audit clean at 1440, 1024, 768, 375, 320", which is quoted beside the mockup when it is shown to the board. Findings are fixed first, never explained away.

- **The design guide** is the design system's mockup: an unlisted route, `/design-kit-7q4m` (in `routes.tsx`, with no top bar link, linked from nowhere, and `noindex, nofollow` while open). On the signal plate: the controls, the live-updates row, the status line, the notice, rows with the change marker and the mark. On paper: all eight faces in two groups by anatomy, the bar at 5, 50 and 100%, the coin, glyphs, suit tiles and chips, the controls, rows, empty, loading and error lines, **every colour token and every pairing measured on the page from `tokens.css`, and the colour rules**, and Play buttons for the deal, the fund tick, the flip and the slam. On ink: the controls (Contribute as a link, for the order trap), rows with the tiles reset, and the team strip asleep and awake. Everything made up for it is labelled Sample; the team strip draws the real roles.
- **The home page** is the home-and-design pull request's mockup.
- Screenshots of every public route at 375, 768 and 1440px with reduced motion come from `E2E_ROUTE_SHOTS=<folder> E2E_PORT=<port> pnpm --filter @backseat/site e2e` (`e2e/route-shots.spec.ts`, the launch-shaped fixture); the guide and home at 375 and 1440 from `E2E_SCREENSHOTS=<folder>` (`e2e/design.spec.ts`).

## Rules changed

By the design system: italic nowhere (was: the wordmark only); the contrast test covers every ground (was: white only); cards have a 2px ink edge and `--radius-card`, choices 1px ink and `--radius` (was: `--line` boxes with `--radius-box`); a card has four text styles; card `h3` moves from body to lead; `--paper` is the page ground; `--accent`, `--track` and `--radius-box` retire; the paused notice has no box; `/team` rows are `li.agent`, not `li.card.role`.

By home and design (`docs/specs/home-and-design.md`): black and white only becomes the colour system (the board's decision); principle 10 becomes one colour, one meaning; band 1 is signal (was: odd bands ink from the first); "No suit fills" becomes the suit tile; the focus ring on paper is signal (was: ink); the primary button on paper is signal (was: ink); `--work` is `#dfe2f7` (was `#d4e1ee`); the top bar's 30rem rule becomes the Menu; the landing order becomes the board's; the Right now panel goes; three-column grids start at 72rem (was: 64rem); `/how-it-works` stacks each step (was: text beside its example); the ledger stacks its bands (was: Funding beside the Ledger); No dead space is a rule, checked in the gate.

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
