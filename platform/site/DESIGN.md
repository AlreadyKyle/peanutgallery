# Peanut Gallery site style guide

The one source of truth for how the public site looks and moves. The board's own site (`platform/board`, docs/specs/board-site.md) keeps its own stylesheet and form rules. The approved direction behind this guide, and the order its parts land in, is `docs/specs/design-system.md`.

Tokens live in `src/tokens.css`; the rules in `src/styles.css`, which imports it first. `src/styles.test.ts` enforces the rules marked **(tested)**, and the Playwright suite (`e2e/design.spec.ts`) the ones marked **(e2e)**.

## Brand, in one paragraph

A quiet, precise table (Teenage Engineering's precision) where real cards (Cards Against Humanity's card-as-object, never its tone) are funded with arcade coins and built by a cast of code-drawn aliens. The card is the object and the page is the table: cards carry the edge, the face and the motion, and everything else is quiet type on a white page whose full-bleed bands rotate black and white. Three motifs only: the card, the coin (money) and the peanut mark. All ages: no theatre or balcony imagery, no chips, dice or other gambling cues, no shock. The site publishes no origin story for its name.

## Principles

1. **One grid, readable lines.** The top bar, the page and the footer share one width (`--wrap`, 72rem), so every left edge lines up. Text never runs wider than `--measure` (44rem). Short, repeated items (cards, steps, figure groups) sit side by side on wide screens and stack on phones.
2. **Sentence case, upright.** Headings are bold, not shouting. Uppercase appears only in the wordmark, and italic nowhere: the one font file has no italic, and `font-synthesis-style: none` stops the browser inventing one **(tested)**.
3. **Show, don't hide.** Anything a reader needs to understand a figure or a card is written beside it. No tooltips and no icon that needs a tap. **A word and a glyph, never colour alone**: states, suits, pauses and money direction each carry a word.
4. **Measured contrast** **(tested)**, WCAG 2.x, on both grounds:
   - on `--paper` and `--work`: ink at least 7, muted at least 4.5, field at least 3; ink on `--coin` at least 7;
   - on `--ink`: paper at least 7; `--muted-on-ink` at least 4.5 on `--ink` and on `--ink-hover`; `--field` at least 3; `--coin` and `--coin-down` at least 3; ink on `--paper-hover` at least 7 and paper on `--ink-hover` at least 7 (the press fills);
   - the change marker at least 3 on paper, work and ink.
5. **Edges make objects.** Cards have a 2px ink edge and `--radius-card` corners, and no shadow: a white card on the white page measures 1.00, so the edge is what makes it read. Choices, buttons and fields use 1px and `--radius`. Everything else is separated by space and, in lists, by hairlines. `--radius-box` and the Right now panel's box are retired as the home page is rebuilt.
6. **Things you can press look pressable.** Links are underlined, and buttons are filled or outlined boxes at least 44px tall **(tested)**. Buttons never set `nowrap`: a long label wraps inside its box.
7. **Every public string lives in `src/lib/copy.ts`, or in `src/lib/legal.ts`.** `legal.ts` is kernel and holds the legal pages, the fixed rules and every statement of money: the money rules, the labels and descriptions of money and ledger figures (including a card's spec-row labels), the ledger's row words and the funding caption. Pages read it directly; `copy.ts` never repeats it.
8. **Three text styles to a block, four on a card.** A block uses at most a heading, body text and one small muted line, plus its button. A card has four: the index row, the title, the summary and the spec rows, because the spec rows are the precision the table asks for.
9. **Headings balance their lines** (`text-wrap: balance`) **(tested)**.
10. **One accent, one meaning.** Coin amber means money. It is never a text colour **(tested)**, and every coin shape has an ink edge (coin on paper is 2.25).
11. **Motion records a real change or answers a press.** First paint is still. Nothing a viewer might tap moves while they look (see Motion).

## Tokens

Colours are written only in `tokens.css`, and there only in `:root` **(tested)**. v1 is light only (`color-scheme: light`); dark mode is a backlog card.

| Token | Value | Use | Measured |
|---|---|---|---|
| `--paper` | `#ffffff` | The page ground and paper bands; card faces and fields | ink 18.88, muted 6.69 |
| `--ink` | `#111111` | Text, card edges, the bar's outline and rule, the focus ring on paper; the ground of ink bands | |
| `--muted` | `#5c5c5c` | Secondary text on paper and work | paper 6.69, work 5.03 |
| `--work` | `#d4e1ee` | The Building and Being checked face | ink 14.21, muted 5.03 |
| `--coin` | `#d9a441` | Money only: the Contribute fill, the funding bar's fill, the coin mark | ink on coin 8.40; coin on ink 8.40 |
| `--coin-down` | `#b8862f` | Contribute on hover and press | ink on it 5.84 |
| `--field` | `#7d7d7d` | Field and chip borders, on paper and on ink | paper 4.12, work 3.10, ink 4.59 |
| `--line` | `#d6d6d6` | Hairlines on paper (decorative) | 1.45 |
| `--paper-hover` | `#eeeff0` | Hover fill only (outline on paper, primary on ink); never a page or section ground | ink on it 16.40 |
| `--ink-hover` | `#333333` | Primary hover on paper; outline hover and press on ink | paper on it 12.63 |
| `--muted-on-ink` | `#a3a3a3` | Secondary text in ink bands | ink 7.49, ink-hover 5.01 |
| `--line-on-ink` | `#333333` | Hairlines in ink bands (decorative) | 1.49 |
| `--creature-*` | eleven fills | Avatar fills only; every avatar shape has an ink outline | |

Retired: `--accent`, `--track`, `--radius-box`, and `--ground` as a background (its value lives on as `--paper-hover`) **(tested)**.

**Roles.** Components read role tokens, not grounds: `--text-muted`, `--hairline`, `--focus-colour`, `--primary-bg/-fg/-hover/-press`, `--outline-bg/-fg/-hover/-press`, `--quiet-fg` and `--mark-filter`. `:root` sets them for paper; an ink band resets them from its position (Bands). So nothing needs a band class to draw correctly on ink.

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

**Space and shape.** `--space-1` … `--space-5` (0.5 / 1 / 1.5 / 2.5 / 4rem), `--gutter` 1.25rem, `--measure` 44rem, `--wrap` 72rem. `--band-pad` is the block padding inside a band: `--space-3` below 48rem, `--space-4` from 48rem. `--rail` 9rem is the time column of a row from 48rem. `--radius` 0.375rem (buttons, fields, chips, choices), `--radius-card` 1rem, `--radius-tile` 0.25rem (the funding bar). `--target` 2.75rem, the 44px minimum. Card inset and grid gap are `--space-3`.

**Focus.** `:focus-visible` is a 3px solid outline in `--focus-colour` at a 2px offset **(tested)**: ink on paper (18.88; 14.21 on the work face), paper in an ink band (18.88) **(e2e)**. The ink offset gap keeps a paper ring apart from a paper-filled button or Contribute.

**Motion tokens.** `--dur-quick` 150ms, `--dur-move` 240ms, `--dur-flip` 400ms (two 200ms halves), `--stagger` 50ms, `--ease-out` `cubic-bezier(0.2,0,0,1)`, `--ease-in` `cubic-bezier(0.55,0,1,0.45)` **(tested)**.

## Bands

Every public page becomes a stack of full-bleed bands (the pages move onto them in the home-and-design pull request; the guide is on them now):

1. A band's colour comes only from its position among the bands actually drawn: odd ink, even paper, starting with ink. The top bar shares the first band's ink and the footer is the opposite of the last band. The change of ground is the only divider; nothing inside a band changes it.
2. Cards, funding bars, card-like choices and `/team`'s agent rows sit only in band 2, which is paper and always drawn (it shows its empty state rather than disappearing). A later band with nothing to show is not drawn, and the bands after it take their colour from their new position **(e2e: no `.card`, `.funding-bar`, `.choice` or `.agent` in an ink band)**.
3. On ink, only the on-ink roles: paper for text, links, glyphs, control edges, the pressed border, the change marker and the focus ring; `--muted-on-ink` for secondary text; `--line-on-ink` for hairlines. The coin, Contribute and the avatars stay as they are.

**Set once, never per page** **(tested)**. Every direct child of `main` is a `.band`. `main > .band:nth-child(odd)` is ink and `:nth-child(even)` paper; `.page:has(> main > .band:first-child) > .topbar` shares the ink; the footer is paper when `main`'s last band is odd and ink when it is even. The on-ink role resets hang off the same positional selectors, and no class names a band colour. A band holds one or more `h2` sections, `--space-4` apart, with `--band-pad` above and below **(e2e: bands alternate from ink and the footer continues)**.

**The order trap.** Links inherit the band's colour. Contribute is an `<a>` with its own `color: var(--ink)` on `.button.btn-coin`, after the link rules, and no band rule repaints links, so Contribute stays ink on coin in an ink band **(tested, e2e)**.

**On ink, specifically.** Primary buttons invert to a paper fill with ink text (hover `--paper-hover`); outline buttons are an ink fill with a paper edge and text (hover `--ink-hover`); the quiet "Up to date" state is `--muted-on-ink` text with a `--field` edge. A press lightens on ink (outline to `--ink-hover`, primary to `--paper-hover`) and darkens on paper. The peanut mark takes `filter: invert(1)`. An avatar sits on a paper disc and draws unchanged. The funding bar never sits on ink.

**Forced colours.** Both grounds become Canvas, so each band after the first, and the footer, gets a 1px CanvasText top border; the peanut's filter is dropped **(tested, e2e)**.

## Components

**The card** (`components/Card.tsx`, `CardFace`). An `li.card` with `data-face`: a white face, 2px ink edge, `--radius-card`, no shadow, natural height (no aspect floor, clamp or `overflow: hidden`).
1. The **index row** (small, 600): the suit glyph and label at the start, the state glyph and word at the end. No pill and no border.
2. The **title** (`h3`, 20px, 700, balanced).
3. The **summary** (body).
4. The **bottom block**, pinned so bars and buttons align across a row: the funding bar; the **spec rows** (`dl.spec-rows`, small, tabular, hairlines: "Funded $1.50 of $3.00" and "Contributors 2"; label muted, value ink); "Fund this card" (outlined, full width, 44px, described by the title); the native "What the agents are told" disclosure.

The money in the bottom block comes from `Funding.tsx` (kernel). Modes: `live` (real links), `example` (`/how-it-works`: no link, button or disclosure at all), `sample` (the guide: the buttons drawn, `aria-disabled`, linking nowhere).

| Face | Stage | Look | Word and glyph | Bottom |
|---|---|---|---|---|
| open | proposed, designing | paper | Open for funding, coin outline | bar, rows, Fund this card |
| picked | voted | paper | Picked by the board, flag | as open |
| funded | funded | paper | Funded, full bar | full bar, rows, "Waiting for the agents" (plain muted, 44px) |
| building | building | `--work` | Building, gear | "Builder A is building this · $0.42 spent so far" (the role when the roles loaded, else who filed it); no bar |
| checks | gated | `--work` | Being checked, checklist | the role and spend; no per-check pips (no public per-check record) |
| live | live | paper | Live, checked stamp | the shipped line, Play the game on a Dust card. The stamp (2px border, turned −3°) only where asked; rows use the plain tag |
| paused | (guide only) | paper, a 6px hatched strip inside the top edge | Paused, two bars | bar and rows |
| rejected | (guide only) | paper, dashed edge | Not built, crossed card | the public reason and where its unspent money went |

No face is ever black, and no card sits on an ink band. Each state renders its word and a glyph of its own **(tested)**.

**Suits** (`Glyph.tsx`, `SUITS`). Two, from the card's folder (`categoryOf` in `lib/payment.ts`): the game ("Dust", a cartridge) and the studio ("The studio", a browser window). The cartridge appears only on the game suit and on Play buttons. No suit fills **(tested: each folder has a suit with a label; no two share a glyph)**.

**Glyphs** (`Glyph.tsx`). 16px SVG, strokes and fills in `currentColor`, `aria-hidden` beside a word that says the same: the two suits, the eight state glyphs (each unique **(tested)**), the check (pressed), and the arrows (the font has none).

**The coin mark** (`CoinMark` in `Funding.tsx`, kernel, because it marks money). A 16px circle: 1.5px ink rim, the coin fill, one inner 1px ink ring. No notches, stripes or edge marks, never stacked. Only on Contribute and beside a dollar figure.

**The funding bar** (`FundingBar` in `Funding.tsx`). A 0.625rem paper track with a 1px ink outline and `--radius-tile`, `overflow: hidden`, `role="progressbar"` labelled by the card title. The fill is a full-width strip ending in a 2px ink rule, placed with `transform: translateX(max(calc(var(--fill) - 100%), calc(2px - 100%)))`, so the rule never scales and any money shows at least 2px; with no money there is no fill at all. The spec rows and the state word carry empty and full. Forced colours: the fill takes `Highlight` with a CanvasText rule **(tested)**. Call it the funding bar, never a coin slot.

**Buttons.** `.button` is the primary (filled from `--primary-*`), `.button-secondary` the outline, `.button-block` full width, `.btn-coin` Contribute (coin fill, ink text and edge, `--coin-down` on hover and press), `.button-quiet` the "Up to date" state. All 600, at least 44px, `--radius`. **Pressed** (`aria-pressed="true"`): a 3px `currentColor` border plus the check glyph, in every mode, never `var(--ink)` **(tested, e2e)**.

**Filter chips** (`FilterChip`). `role="group"` of `button.filter`: the suit glyph and label (or All) and a muted count; the pressed chip adds the check glyph and a 3px border. The studio chip shows only while a card is in it; a pressed chip that empties falls back to All.

**The change rule.** A changed figure or row gets `.changed`: `box-shadow: inset 3px 0 0 currentColor` until the next poll, no layout (rows keep a constant 0.5rem inset for it). `currentColor`, never ink: paper in an ink band, ink on paper and on the work face **(tested, e2e)**. Forced colours drop it; the announcer carries funded and shipped.

**The live-updates row** (`LiveUpdates.tsx`). Laid out from first paint: "Pause live updates" (`aria-pressed`) first, then the updates button, which is always there. With nothing waiting it reads "Up to date" and is `aria-disabled` (never `disabled`, so it keeps focus); with changes waiting, "Show *n* updates", capped at 99+. Both labels share one grid cell with the longest one hidden, so its width never changes **(e2e: neither button moves when the label changes; focus stays after a press)**. While paused, the row says "Live updates are paused." The count is announced on none to some, at most once a minute.

**The announcer.** One polite live region (`Announcer`, `role="status"`): funded and shipped are said once.

**Rows.** `ul.rows`: small text, hairlines between rows, a constant 0.5rem inset. Queued, Shipped and the ledger rows are rows, never cards. Rail rows (the time in `--rail` from 48rem) land with the home-and-design pull request.

**Status line and paused notice.** The status line is one true sentence from data, its figures at 600 (`p.status-line`, `.is-paused` adds the pause glyph). The paused notice (`p.notice`, kernel `PausedNotice`) is one plain 600 line with the pause glyph drawn in CSS (two bars in `currentColor`), no box, on pages without a status line.

**Avatar** (`Avatar.tsx`). Every agent drawn as inline SVG from its one-line species note, unchanged in construction; fills from `--creature-*`, ink outlines, the note as its text alternative. Poses come only from data: `asleep` (eyes closed) while `public_studio.paused` is true and the studio row loaded; the default drawing otherwise **(tested)**. They never speak, plead or react to money.

**The team** (`/team`). Rows of `li.agent` (avatar, name, "AI agent", description, facts), never a bordered tile, which would read as a card. The team strip (`.team-strip`, borderless `.member` links) is the home page's; it is on the guide now.

**Everything else** keeps its current behaviour until its page moves onto bands: the landing's intro and Right now panel, the Contribute chooser (choices are 1px ink with `--radius`; Pick for me takes the primary fill), the text pages, the ledger's figure rows (`Stat`), the event and deploy rows, the brief disclosure, stale and missing figures, `/how-it-works` (examples in a dashed `--field` frame), the roadmap (groups headed by suit), and the footer. The Stale and missing figures rules are unchanged: a failed refresh keeps the figures and says so in `p.status` (`role="status"`); a part that did not load says "Not available right now." instead of a zero.

## Motion

Only `transform` and `opacity` move. Every `transition` and `animation` lives inside `@media (prefers-reduced-motion: no-preference)`, uses the duration and easing tokens, and never runs forever; there are no `@keyframes`, view transitions, `@starting-style` or `linear()` **(tested)**. Static transforms (the Live stamp's −3°, the bar's fill position) are geometry and allowed anywhere. `lib/motion.ts` plays each moment with the Web Animations API and, under reduced motion (anything but no-preference), applies the end state at once, so `document.getAnimations()` stays empty **(tested, e2e)**.

- **Fund tick** (`funded_usd` rose on a card on screen): the fill moves from old to new over `--dur-move`, `--ease-out`; the spec rows swap at once.
- **Flip in place** (a card on screen reaches its target): rotateY 0 to 90° in 200ms `--ease-in`, the face swaps, 90 to 0° in 200ms. Same slot and height **(e2e)**.
- **Deal** (only when the viewer presses Show updates): new cards from translateY(−12px) rotate(−3°) and opacity 0, over `--dur-move`, `--stagger` apart.
- **Slam** (shipped, replay only in v1): scale 1.04 and 8px up, to rest, over `--dur-move`.
- **Press**: `:active` changes the fill in every mode and scales to 0.97. Keyboard focus never animates. No hover motion.

**Live changes** (`lib/changes.ts`). Motion comes only from a snapshot diff: never on first load, never in a hidden tab, at most three per poll (the rest apply at once). A card that would arrive, leave or reorder is held behind "Show *n* updates", and so is any text change that would change its box's height: `changesHeight` swaps the text node, measures and puts it back in the same task, so no shift is ever painted **(tested)**. The live studio is paused at launch, so the motion a visitor sees is mostly the replay they start; the rest is still.

## Breakpoints

- Below 30rem: the nav drops under the wordmark (replaced by the Menu in the home-and-design pull request). The wordmark wraps inside the bar rather than past it at large text sizes.
- From 48rem: two-column card, team and guide grids; three steps; each How it works step side by side; `--band-pad` grows.
- From 64rem: three-column card and team grids; the landing intro splits 3:2; Funding and Ledger side by side.

## Mockups

A design change ships with a mockup built from the real components, not a picture of one.

- **The design guide** is this pull request's mockup: an unlisted route, `/design-kit-7q4m` (in `routes.tsx`, with no top bar link, linked from nowhere, and `noindex, nofollow` while open). It shows the tokens with ratios measured on the page, all eight faces, the bar at 5, 50 and 100%, buttons on paper and on ink (Contribute as a link in an ink band), the coin, glyphs, suits and chips, rows with the change marker on both grounds, the team strip asleep and awake, the status line, the live-updates row, the paused notice, empty, loading and error lines, and Play buttons for the deal, the fund tick, the flip and the slam. Everything made up for it is labelled Sample; the team strip draws the real roles.
- **The home page** is the home-and-design pull request's mockup, built first.
- Screenshots at 375 and 1440 come from `E2E_SCREENSHOTS=<folder> E2E_PORT=<port> pnpm --filter @backseat/site e2e` (`e2e/design.spec.ts`).

## Rules changed by the design system

Each is updated here and in its test together: italic nowhere (was: the wordmark only); the contrast test covers paper, work, coin and ink (was: white only); cards have a 2px ink edge and `--radius-card`, choices 1px ink and `--radius` (was: `--line` boxes with `--radius-box`); a card has four text styles; card `h3` moves from body to lead; `--paper` is the page ground; `--paper-hover`, `--muted-on-ink`, `--line-on-ink`, `--work`, `--coin` and `--coin-down` are new; `--field` and `--line` change; `--accent`, `--track` and `--radius-box` retire; the paused notice has no box; the rotating bands are the new layout rule; `/team` rows are `li.agent`, not `li.card.role`. The top bar's 30rem rule, the landing order and the landing's inside-terms list change in the home-and-design pull request.

## Copy rules

The full rules, including the voice rules (winks, coins never a currency, no chance words beside money, the minus sign, characters inside the font), are in `docs/COPY.md`; `src/lib/copy.test.ts` enforces the tested ones. In short: plain, short and declarative; "contributions", never "donations"; money is `$0.00`; never describe something that does not exist yet.

## Accessibility checklist

- One `h1` per page; headings never skip a level.
- The contrast set above; control edges at least 3:1.
- Every interactive element is reachable by keyboard and shows the focus ring (paper on ink, ink on paper).
- Touch targets are at least 44px tall.
- No horizontal scroll at 320, 360, 375, 390, 768, 1024 and 1440px on every route, nor at 375px with 200% text **(e2e)**.
- axe finds no WCAG 2.2 AA violation on every route at 375 and 1440px, nor inside each ink band of the guide **(e2e)**.
- Information is never carried by colour alone or hidden behind hover.
