# Peanut Gallery site brand

The site is white ground, black type, system fonts, hairline rules. The look draws on the typographic conventions of museum websites: heavy italic uppercase display type, a filled dot before each section label, one-pixel black rules with generous space between sections, figures set as large numerals with the label beside them. No images, no animation, no colour beyond black, white and one near-black for the funding-bar fill.

Every visible string on the public pages comes from `src/lib/copy.ts`, including the loading lines, the deploy status words and the not-found page. The launch line is composed in `src/pages/Landing.tsx` from the snapshot: `copy.notLiveYet` while `launchedAt` is null, or `copy.liveSince` followed by a formatted date once it is set. The unlisted `/board` page keeps its own literals. Tokens live at `:root` in `src/styles.css`.

## Tokens

| Token | Value | Use |
| --- | --- | --- |
| `--paper` | `#ffffff` | Page ground, button type |
| `--ink` | `#000000` | All type, rules, button ground |
| `--accent` | `#1a1a1a` | Funding-bar fill only |
| `--font-sans` | `'Helvetica Neue', Helvetica, Arial, sans-serif` | Everything |
| `--font-mono` | `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` | Commit shas |
| `--weight-body` | `400` | Body |
| `--weight-bold` | `700` | Labels, links, amounts, tags |
| `--weight-display` | `900` | Headings, wordmark, nav, figures |
| `--leading-body` | `1.5` | Body |
| `--leading-display` | `0.95` | Headings |
| `--tracking-display` | `-0.03em` | Headings, wordmark, nav, figures |
| `--tracking-label` | `0.04em` | Section labels, figure labels, tags, buttons, the brief disclosure |
| `--measure` | `46rem` | Maximum paragraph, list and card width |
| `--wrap` | `80rem` | Content width, centred |
| `--gutter` | `clamp(1.5rem, 4vw, 2rem)` | Side padding at every width |
| `--rule` | `1px solid var(--ink)` | Section rules, tracks, list rows, card and form borders |
| `--focus` | `3px solid var(--ink)` | `:focus-visible` outline |
| `--space-1` … `--space-5` | `0.5 / 1 / 1.5 / 2.5 / 4rem` | Vertical rhythm |

Contrast is black on white (21:1) everywhere; white on black in buttons.

## Type scale

Five sizes on a 1.2 ratio from the 17px body. Every text role uses exactly one of them. Inside a size, weight, style and case make the difference; a role never gets its own in-between size. When a new element appears, pick the role it belongs to, not a size.

| Token | Size | Roles |
|---|---|---|
| `--size-small` | `0.875rem` (14px) | Section labels, figure labels, tags, card status words, the brief disclosure label, event and deploy rows, the info button and tooltip, footer |
| `--size-body` | `1.0625rem` (17px) | Body paragraphs, How it works steps, fixed rules, card titles (`h3`), card summaries and the opened brief, plain `h2` headings, nav links, buttons, `.more` links, card amounts |
| `--size-lead` | `1.25rem` (20px) | Wordmark, the pitch and the launch line under it (`.pitch`, `.launch`), page ledes (`.lede`), small figures (`.figures-small dd`) |
| `--size-large` | `1.5rem` (24px) | Meter figures (`.figure dd`) |
| `--size-display` | `1.875rem` (30px) | Page titles (`h1` / `.display`), the largest text on any page |

## Patterns

**Top bar.** `header.topbar` holds `.wrap.topbar-row`: `.brand` with the wordmark (a link home, `--size-lead` display) and `nav` with Studio, Ledger, Play (external, only when `VITE_PLAY_URL` is set), Contribute (external, only when the Stripe link is set) and Discord (external, only when the invite is set). Under 48rem the row stacks. There is no Board link and no live figure in the bar.

**Masthead and pitch.** The landing `.masthead` carries a visually hidden `h1.sr-only` (the studio name), `.pitch` (`copy.pitch`) and the launch line `p.launch`, both at `--size-lead` because they read as one intro, showing `copy.notLiveYet` before launch or `copy.liveSince` plus a formatted date after.

**Page header and lede.** `PageHeader` renders a `.masthead` with an `h1.display` title and an optional `.lede` (one sentence at `--size-lead`) below it. The Ledger, Board and not-found pages use it.

**Section label and rule.** Each `section.section` opens with a 1px black top rule and space above the label. The label is an `h2.label`: a filled dot (`::before`, an empty circle in `currentColor`, so it never enters the accessible name) followed by the label word at `--size-small`, bold italic uppercase. Labels are short — usually one word (Now, Next, Funding, Ledger, Pool, Deploys), with a few longer (How it works, Fixed rules, Agent work).

**Steps.** How it works is an `ol.steps`: a decimal list with heavy italic markers, one `<li>` per `copy.steps` entry.

**Display heading.** `.display` / `h1` at `--size-display`; a plain `h2` (the board and form headings) and `h3` (card titles) at `--size-body`; all 900 italic uppercase with `--leading-display` and `--tracking-display`. Section labels are the exception: `h2.label` is overridden to the small bold style above.

**Figure.** `dl.figures` is a three-column grid (`figures-small` is four columns, two under 64rem); each `.figure` is a `dt` and `dd` pair, the `dd` drawn first by `order: -1` so the numeral leads and the label sits beside it at the baseline. Meter figures are `--size-large`, small figures `--size-lead`. Under 48rem the grid is one column.

**Cards.** `ul.cards` lists the Now and Next cards in one column with a 1px rule between rows. Each `li.card` has an `h3.card-title` and a `.card-meta` row holding a bordered `.tag` (the source label from `sourceLabel`) and a `.card-status` (the stage word). A Now card then shows a `.card-amount` and "spent so far". A Next card carries an `Info` on its status word, an optional `.card-summary`, and — when the funding target is positive — a `.card-track` with the progress `.bar`/`.bar-fill` (sized by `percent`), the `.card-amount` ("$X of $Y") and a second `Info`; below that the contributors line and, when the card is fundable and the Stripe link is set, a `.more` "Fund this" link whose `aria-describedby` points at the card title.

**Summary line.** `p.card-summary` is the card's public summary (`cards.summary`, at most 200 characters, written for supporters), set as body text under the meta row on both Now and Next cards. A card with a blank or missing summary shows no summary line. The agent brief (`cards.intent`) is never shown outside the disclosure below.

**Brief disclosure.** `details.brief` is a native disclosure, closed by default and keyboard operable, rendered last in a Now or Next card (below the "Fund this" link, or where it would be) whenever the card has a non-blank intent. Its `summary` reads `copy.agentBrief` ("What the agents are told") at `--size-small`, bold italic uppercase with `--tracking-label`, the browser's disclosure marker and the `--focus` outline. When opened, the `p` shows the intent verbatim in body text with a 1px left rule, `--space-2` left padding and a `--measure` cap.

**Info.** A round "i" `button.info-button` beside a term opens a `.tooltip` (`role="tooltip"`) that explains it. Hover and focus show it while they last; a click pins it open until a second click, Escape, blur or a pointer press outside. The `.info` wrapper is not positioned, so the tooltip anchors to the nearest positioned ancestor (`.figure`, `.card-meta`, `.card-track`) and spans its width, so it never runs past the viewport.

**Links.** Body links are underlined in black. A `.more` link is bold with a trailing arrow drawn by `::after` with empty alt text, so it reads as the link text alone. Nav links underline on hover and on the active route.

**Button.** `.button` and `button` are black with white text, bold italic uppercase, square corners; they invert on hover and focus.

**Footer.** `footer.site-footer` opens with a rule and holds `copy.footer`, the Discord link (when set), and the "Created by Clayhouse" credit linking to clayhouse.studio, at `--size-small`.

**Forms.** Inputs and selects are white with a 1px black border and square corners; labels are bold. These are the base styles the `/board` page inherits.

## Breakpoints

- `max-width: 63.99rem`: small figures drop from four columns to two.
- `max-width: 47.99rem`: every grid becomes one column and the top bar stacks.

Nothing carries a fixed width wider than the viewport. The `nowrap` runs are the wordmark and each `.card-amount`; the wordmark is under 200px and a card amount of any realistic size ("$25.00 of $100.00" is well under 200px at 17px bold) sits inside the ~327px content box at 375px.
