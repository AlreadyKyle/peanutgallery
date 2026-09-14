# Peanut Gallery site brand

The site is white ground, black type, system fonts, hairline rules. The look draws on the typographic conventions of museum websites: heavy italic uppercase display type, a filled dot before each section label, one-pixel black rules with generous space between sections, figures set as large numerals with the label beside them. No images, no animation, no colour beyond black, white and one near-black for the funding-bar fill.

Every visible string on the public pages comes from `src/lib/copy.ts`, including the loading lines, the deploy status words and the not-found page; the launch line in `src/lib/launch.ts` is `copy.launchDefault` or a formatted date. The unlisted `/board` page keeps its own literals. Tokens live at `:root` in `src/styles.css`.

## Tokens

| Token | Value | Use |
| --- | --- | --- |
| `--paper` | `#ffffff` | Page ground, band type, button type |
| `--ink` | `#000000` | All type, rules, band ground, button ground |
| `--accent` | `#1a1a1a` | Funding-bar fill only |
| `--font-sans` | `'Helvetica Neue', Helvetica, Arial, sans-serif` | Everything |
| `--font-mono` | `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` | Commit shas |
| `--weight-body` | `400` | Body |
| `--weight-bold` | `700` | Labels, links, amounts |
| `--weight-display` | `900` | Headings, wordmark, nav, band, figures (falls back to the nearest available weight) |
| `--leading-body` | `1.5` | Body |
| `--leading-display` | `0.95` | Headings and the band |
| `--tracking-display` | `-0.03em` | Headings, wordmark, nav, figures |
| `--tracking-label` | `0.04em` | Section labels, figure labels, buttons, status |
| `--measure` | `46rem` | Maximum paragraph width |
| `--wrap` | `80rem` | Content width, centred |
| `--gutter` | `clamp(1.5rem, 4vw, 2rem)` | Side padding at every width |
| `--rule` | `1px solid var(--ink)` | Section rules, tracks, list rows, form borders |
| `--focus` | `3px solid var(--ink)` | `:focus-visible` outline (white inside the band) |
| `--space-1` … `--space-5` | `0.5 / 1 / 1.5 / 2.5 / 4rem` | Vertical rhythm |

Contrast is black on white (21:1) everywhere; white on black in the band and buttons.

## Type scale

| Step | Size | Style | Where |
| --- | --- | --- | --- |
| `--step--1` | `0.9375rem` | 700 italic uppercase, `--tracking-label` | Section labels, figure labels, status slot, footer, event types |
| `--step-0` | `1.0625rem` | 400, line-height 1.5 | Body |
| `--step-1` | `1.25rem` | 900 italic uppercase | Nav links under 48rem |
| `--step-2` | `clamp(1.25rem, 1.75vw, 1.5rem)` | 900 italic uppercase | Wordmark, nav links, goal titles (`h3`) |
| `--step-3` | `clamp(1.75rem, 4.5vw, 3.5rem)` | 900 italic uppercase, line-height 0.95 | Band line, `h2`, small figures |
| `--step-4` | `clamp(2.75rem, 5.5vw, 4.5rem)` | 900 upright, tabular numerals, line-height 1 | Meter figures |
| `--step-5` | `clamp(3rem, 10vw, 8rem)` | 900 italic uppercase, line-height 0.95 | Page title (`h1`) |

Uppercase is applied with `text-transform`, so the text in the DOM stays as written in `copy.ts`.

## Patterns

**Top bar.** `header.topbar` holds `.wrap.topbar-row`: the wordmark (a link home, `--step-2` display), a `.status` slot that shows the live pool balance only when figures are loaded, and `nav` with Studio, Ledger, Contribute (external, only when the Stripe link is set) and Discord (external, only when the invite is set). Under 48rem the row stacks. There is no Board link.

**Band.** `.band` is a full-width black block directly under the top bar on the public pages. `.band-line` carries `copy.pitch` verbatim at `--step-3`, white on black.

**Section label and rule.** Each `section.section` opens with a 1px black top rule and `--space-4` above the label. The label is an `h2.label`: a filled dot (`::before`, an empty circle in `currentColor`, so it never enters the accessible name) followed by the label word at `--step--1`, bold italic uppercase. Sections close with `--space-5` below.

**Display heading.** `.display` / `h1` at `--step-5`, `h2` at `--step-3`, `h3` at `--step-2`; all 900 italic uppercase with `--leading-display` and `--tracking-display`.

**Figure.** `dl.figures` is a three-column grid (`figures-small` is four columns, two under 64rem); each `.figure` is a `dt` and `dd` pair, the `dd` drawn first by `order: -1` so the numeral leads and the label sits beside it at the baseline. Under 48rem the grid is one column.

**Funding bar.** `.goal` holds an `h3.goal-title`, then `.goal-track`: a `.bar` (1px black outline, 0.625rem tall, `--accent` fill sized by `percent`) with the `.goal-amount` beside it in bold tabular numerals. Three goals sit in a three-column grid that collapses to one under 48rem.

**Links.** Body links are underlined in black. A `.more` link is bold with a trailing arrow drawn by `::after` with empty alt text, so it reads as the link text alone. Nav links underline on hover and on the active route.

**Button.** `.button` and `button` are black with white text, bold italic uppercase, square corners; they invert on hover and focus.

**Footer.** `footer.site-footer` opens with a rule and holds `copy.footer` on the left and the Discord link (when set) on the right at `--step--1`.

**Forms.** Inputs and selects are white with a 1px black border and square corners; labels are bold. These are the base styles the `/board` page inherits.

## Breakpoints

- `max-width: 63.99rem`: small figures drop from four columns to two.
- `max-width: 47.99rem`: every grid becomes one column, the top bar stacks, nav links drop to `--step-1`.

Nothing carries a fixed width wider than the viewport. The `nowrap` runs are the wordmark, the `.status` slot and each `.goal-amount`; the first two are under 200px and a goal amount of any realistic size ("$1,000.00 of $10,000.00" is about 200px at 17px bold) sits well inside the 327px content box at 375px.
