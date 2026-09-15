# Site design pass: plain and readable

Status: agreed. Card: none. Owner: board.

## Problem

The public site is mostly short lines of text, but it presented them with heavy italic uppercase on every heading, label, tag and button. It also had dot labels, a black rule above every section and card, boxed source tags, an (i) tooltip on nearly every figure, and a top bar wider than the text column. The board said on 14 September 2026 that it reads as complex, and asked for simple, fundamental design practice with one style guide.

## Scope

In:
- Tokens, type and layout in `platform/site/src/styles.css`.
- The landing, ledger, not-found and top bar and footer markup.
- Figures without tooltips, cards, event and deploy rows.
- Two copy corrections: the stream and kill-switch rule, and the founding-badge line.
- `platform/site/BRAND.md` rewritten as the single style guide.
- Style tests.

Out: new content (Shipped, legal pages, OG tags), the /board layout beyond inherited styles, and dark mode.

## Behaviour

- **One column.** The site is one column 44rem wide, with the top bar and footer aligned to it.
- **Type.**
  - Headings are bold sentence case. Italic and uppercase appear only in the wordmark.
  - Secondary text is `--muted` gray.
- **Landing page.**
  - The visible `h1` is the first sentence of the pitch, and the second is the lede.
  - Section order: Building now, Up next, How it works, Funding, Ledger, Fixed rules.
- **Figures.** Each figure is a row with a visible gray description; there are no tooltips.
- **Cards.**
  - Each card has one meta line (status · source).
  - The bar has a written caption with the amount and contributors.
  - "Fund this card" is a 44px outlined button.
- **Events and deploys.** They read as plain sentences.

## Acceptance criteria

- [ ] `styles.test.ts` passes: five sizes on a 1.2 ratio, italic and uppercase only on `.wordmark`, no 900 weight or letter-spacing, `--ink` at 7:1 or better and `--muted` at 4.5:1 or better on `--paper`, colours only as tokens, buttons, nav links and fields at the 44px target.
- [ ] The landing page has exactly one `h1`, whose text is the first pitch sentence, and its `h2` order is Building now, Up next, How it works, Funding, Ledger, Fixed rules.
- [ ] No `role="tooltip"` and no Info button remain on public pages; every meter figure and agent spend shows its description.
- [ ] A Next card shows "status · source", a bar caption "$x of $y · n contributors", and a "Fund this card" link styled as a button.
- [ ] The public copy no longer mentions a stream, a kill switch or a founding badge, and says "These are contributions, not donations."
- [ ] At 375px the landing, ledger and board pages have no horizontal scroll.
- [ ] `BRAND.md` describes only what `styles.css` does.

## Verification

- `pnpm verify` at the repository root exits 0.
- `pnpm --filter @backseat/site build && pnpm --filter @backseat/site e2e`, with the Netlify public values exported, passes.
- Browser pane at 375px and 1280px against the built site: one h1, the h2 order above, button heights 44, italic only on the wordmark, no horizontal overflow.
- After merge, the live site serves the new build-sha, and screenshots at both widths are sent to the board.

## Decisions

- 2026-09-14: plain and readable replaces the co-berlin typographic direction (board). The wordmark keeps its italic uppercase as the one brand mark.
- 2026-09-14: descriptions replace tooltips (board). This supersedes the info-icon criterion in `live-cut.md`: explanations a reader needs should not sit behind a tap, especially on a phone.
- 2026-09-14: Building now and Up next move above How it works and the money, because they are the reason to visit and to fund. This supersedes the section order in `live-cut.md`.
- 2026-09-14: the nav drops Home because the wordmark links home, which keeps the nav on one line at 375px.
