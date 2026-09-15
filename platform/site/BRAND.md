# Peanut Gallery site style guide

This is the one style guide for the public site and `/board`. The site is mostly short lines of text, so the design's job is to make them easy to read, understand and act on. When in doubt, remove something.

Tokens live at `:root` in `src/styles.css`. `src/styles.test.ts` enforces the rules marked **(tested)**.

## Principles

1. **One column.** The top bar, the page and the footer share one width (`--wrap`, 44rem), so every left edge lines up and every line stays a comfortable length.
2. **Sentence case, regular style.** Headings are bold, not shouting. Italic and uppercase appear only in the wordmark **(tested)**.
3. **Show, don't hide.** Anything a reader needs to understand a figure or a card is written under it in gray. No tooltips and no icons that need a tap.
4. **Two text colours.** `--ink` for what matters, `--muted` for what explains it. Both meet WCAG AA on white **(tested)**.
5. **Space before rules.** Sections are separated by space. Hairlines (`--line`) only separate rows in a list, and the top bar and footer.
6. **Things you can press look pressable.** Links are underlined, and buttons are filled or outlined boxes at least 44px tall **(tested)**.
7. **Every public string lives in `src/lib/copy.ts`.** `/board` keeps its own literals.

## Tokens

| Token | Value | Use |
| --- | --- | --- |
| `--paper` | `#ffffff` | Page ground, primary button text |
| `--ink` | `#111111` | Body text, headings, primary button, 18.9:1 |
| `--muted` | `#5c5c5c` | Meta lines, descriptions, times, footer, 6.7:1 |
| `--line` | `#e4e4e4` | Hairlines between rows, top bar and footer borders |
| `--track` | `#ececec` | Empty part of a funding bar, secondary button hover |
| `--accent` | `#111111` | Filled part of a funding bar |
| `--ink-hover` | `#333333` | Primary button hover |
| `--field` | `#8a8a8a` | Form field borders, 3.5:1 as a non-text control |
| `--font-sans` | system UI stack | Everything |
| `--font-mono` | system mono stack | Commit shas |
| `--weight-body` / `--medium` / `--strong` / `--bold` | 400 / 500 / 600 / 700 | Body / nav / card titles, labels, buttons / headings, wordmark |
| `--leading-body` | 1.6 | Body |
| `--leading-heading` | 1.25 | Headings |
| `--space-1` … `--space-5` | 0.5 / 1 / 1.5 / 2.5 / 4rem | All spacing |
| `--wrap` | 44rem | Content width |
| `--gutter` | 1.25rem | Side padding at every width |
| `--radius` | 0.375rem | Buttons and fields |
| `--target` | 2.75rem | Minimum height of buttons, nav links and fields |
| `--focus` | 3px solid `--ink` | `:focus-visible` outline |

Colours are written only in `:root`; every other rule uses a token **(tested)**.

## Type scale

Five sizes on a 1.2 ratio from a 17px body **(tested)**. Every font-size is one of them **(tested)**.

| Token | Size | Roles |
| --- | --- | --- |
| `--size-small` | 14px | Meta lines, figure descriptions, event and deploy rows, the split line, the brief disclosure, the footer |
| `--size-body` | 17px | Paragraphs, card titles (`h3`), nav, buttons, the wordmark |
| `--size-lead` | 20px | The lede under a page heading, figure amounts |
| `--size-large` | 24px | Section headings (`h2`) |
| `--size-display` | 30px | The page heading (`h1`), once per page |

## Components

**Top bar.** The wordmark (the peanut mark and the studio name, a link home) sits on the left. The nav on the right has Ledger, Play, Discord, then Contribute in bold. Links that need an unset env value are left out. There is no Home link, because the wordmark is one. There is no Board link. Below 30rem the nav drops under the wordmark.

**Page heading.** `.hero` holds one `h1` and an optional `p.lede`. On the landing page the `h1` is the first sentence of the pitch, and the lede is the second. Under them come the launch line (muted), the Contribute button, and the split line (muted, small).

**Section.** `section.section` opens with an `h2` and nothing above it but space. The landing order is Building now, Up next, How it works, Funding, Ledger, Fixed rules. Now and Next lead because they are what people come to watch and fund.

**Card.** `li.card` in `ul.cards`, with hairlines between cards. Inside, in order:
- an `h3` title
- one muted meta line: status · source, for example "Decided · Board"
- the summary, if there is one
- the funding bar, with the caption "$0.00 of $3.00 · 0 contributors"
- the "Fund this card" outlined button
- the "What the agents are told" disclosure

A card never shows the agent brief outside the disclosure.

**Funding bar.** `.bar` is 0.5rem tall with rounded ends: `--track` behind, `--accent` fill sized by the percentage. It carries `role="progressbar"` and the card title as its label. The amount is written under it, never only drawn.

**Figure row.** `Stat` renders a `div.stat` inside `dl.stats`: the label (600) and a muted description on the left, the amount on the right in tabular numerals at `--size-lead`. Every figure has a description.

**Event and deploy rows.** `ul.rows`, small text, with hairlines between rows. The time is muted, then a plain sentence: "Builder A started · card title". Event types become words through `copy.eventVerbs`, and deploys read "Game 2775bcb passed checks".

**Buttons and links.** `.button` is filled black with white text. `.button-secondary` is outlined. Both are sentence case at weight 600, at least `--target` tall, with `--radius` corners. Body links are underlined and get a thicker underline on hover. The keyboard focus ring is `--focus` everywhere.

**Disclosure.** `details.brief` is native and closed by default. Its summary is muted, small and underlined. When open, the text sits beside a 2px `--line` rule.

**Lists.** How it works is an `ol.steps` with plain decimal numbers. The fixed rules are a `ul.rules` with discs.

**Footer.** Muted small text on one hairline: the footer line, Discord, and the "Created by Clayhouse" credit.

**Forms (/board).** Labels at weight 600 above the fields. Fields are `--target` tall with a `--field` border and `--radius` corners. Buttons use `.button` styling.

## Copy rules

- Plain, short and declarative. One idea per sentence. Sentence case everywhere.
- Say "contributions", never "donations".
- Money is `$0.00`. Counts use thousands separators.
- Never describe something that doesn't exist yet: no stream, badge or feature before it ships.
- Name things the way a first-time reader would: "Building now", "Up next", "Held in reserve".

## Accessibility checklist

- One `h1` per page; headings never skip a level.
- Text contrast is at least 4.5:1, and control borders at least 3:1.
- Every interactive element is reachable by keyboard and shows the focus ring.
- Touch targets are at least 44px tall.
- No horizontal scroll at 375px (Playwright checks the landing, ledger and board pages).
- Information is never carried by colour alone or hidden behind hover.
