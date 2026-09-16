# Peanut Gallery site style guide

This is the one style guide for the public site and `/board`. The site is mostly short lines of text, so the design's job is to make them easy to read, understand and act on. When in doubt, remove something.

Tokens live at `:root` in `src/styles.css`. `src/styles.test.ts` enforces the rules marked **(tested)**.

## Principles

1. **One grid, readable lines.** The top bar, the page and the footer share one width (`--wrap`, 72rem), so every left edge lines up. Text never runs wider than `--measure` (44rem). Short, repeated items (cards, steps, figure groups) sit side by side on wide screens and stack on phones.
2. **Sentence case, regular style.** Headings are bold, not shouting. Italic and uppercase appear only in the wordmark **(tested)**.
3. **Show, don't hide.** Anything a reader needs to understand a figure or a card is written under it in gray. No tooltips and no icons that need a tap.
4. **Two text colours.** `--ink` for what matters, `--muted` for what explains it. Both meet WCAG AA on white **(tested)**.
5. **Space before rules.** Sections are separated by space. Hairlines (`--line`) separate rows in a list, and the top bar and footer. Things you can act on (cards, choices, the Right now panel) are boxes with a `--line` border and `--radius-box` corners, so they read as separate objects.
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
| `--wrap` | 72rem | Page width: top bar, main, footer |
| `--measure` | 44rem | Maximum width of any text block; the whole content of text pages (ledger, contribute, terms, privacy, refunds, contact, board) |
| `--gutter` | 1.25rem | Side padding at every width |
| `--radius` | 0.375rem | Buttons and fields |
| `--radius-box` | 0.625rem | Cards, choices, the Right now panel |
| `--target` | 2.75rem | Minimum height of buttons, nav links and fields |
| `--focus` | 3px solid `--ink` | `:focus-visible` outline |

Colours are written only in `:root`; every other rule uses a token **(tested)**.

## Type scale

Five sizes on a 1.2 ratio from a 17px body **(tested)**. Every font-size is one of them **(tested)**.

| Token | Size | Roles |
| --- | --- | --- |
| `--size-small` | 14px | Meta lines, figure descriptions, event and deploy rows, the split line, the brief disclosure, the last-updated line, the footer |
| `--size-body` | 17px | Paragraphs, card titles (`h3`), nav, buttons, the wordmark |
| `--size-lead` | 20px | The lede under a page heading, figure amounts |
| `--size-large` | 24px | Section headings (`h2`) |
| `--size-display` | 30px | The page heading (`h1`), once per page |

## Components

**Top bar.** The wordmark (the peanut mark and the studio name, a link home) sits on the left. The nav on the right has Ledger, Play, Discord, then Contribute in bold. Contribute goes to `/contribute`, never straight to checkout. Links that need an unset env value are left out. There is no Home link (the wordmark is one) and no Board link. Below 30rem the nav drops under the wordmark.

**Landing intro.** `.intro` holds the hero and the Right now panel: side by side (3:2) from 64rem, stacked below.
- **Hero:** one `h1` (the first pitch sentence), a `.lede` (the second), the muted launch line, the Contribute button and the muted split line.
- **Right now (`aside.panel`):** the Available figure, what is building (or "Nothing is building"), "Latest shipped: <title>" once a card has shipped, and a Full ledger link. When a refresh fails after figures have loaded, the muted small line "Could not refresh. These figures may be out of date." (`role="status"`) sits under the heading until a load succeeds. It carries no list: the panel has to stay about as tall as the pitch beside it, or the grid row leaves dead space under the pitch. Agent actions are the Ledger section below and the ledger page.

**Landing order.**
1. Intro.
2. Building now, only when a card is building.
3. Fund what's next.
4. Queued, only when a card is funded and waiting.
5. Shipped, only when a card is live.
6. How it works.
7. Funding and Ledger, side by side from 64rem.
8. Fixed rules.

**Section.** `section.section` opens with an `h2` and nothing above it but space. Paragraphs directly inside a section stop at `--measure`.

**Category filter.** `.filters` is a `role="group"` row of `button.filter` chips: All, Dust (the current game), The studio (platform cards), Next game. Each chip shows its count and uses `aria-pressed`; the pressed chip is filled. A category chip adds one muted note. Next game says that no card funds a next game yet. A category comes from the card's folder (`categoryOf` in `src/lib/cards.ts`).

**Card grid.** `ul.card-grid` has one column on phones, two from 48rem and three from 64rem. Each `li.card` is a box:
- a top line with the category (muted, 600) and the status. "Open for funding" is plain; "Picked by the board", "Building" and "In the gate" are `.badge` pills.
- the `h3` title and the summary.
- `.card-bottom`, pushed to the bottom so bars and buttons line up across a row. It holds the funding bar, its caption ("$0.00 of $3.00 · 0 contributors"), a full-width outlined "Fund this card" button and the brief disclosure. A building card shows "$x spent so far · source" there instead; the amount is studio-billed spend and is left out when there is none.

**Card groups** (`groupCards`):
- Building now: stages building and gated.
- Fund what's next: proposed, designing and voted, picked ones first.
- Queued: funded, shown as compact rows rather than boxes, because there is nothing to do with them.
- Shipped: live, newest `updated_at` first, shown as rows. A live card is never in Fund what's next or on `/contribute`.

**Shipped list.** `ul.shipped` holds one row per live card at the reading measure, with hairlines between rows like a list. A row has:
- the category (`.shipped-category`: muted, small, 600);
- the `h3` title and the summary;
- a `.card-meta` line: "$1.23 spent · 3 contributors · shipped 15 Sep 2026". The amount is studio-billed spend and is left out when there is none, so founder-billed work never shows a cost. A card with no goal and no funding names its source instead of a count ("Board");
- "Play the game" on a Dust card when the play URL is set, described by the card title.

Rows, not boxes, because a shipped card is a record: the one action, playing the game, is the same for every Dust card. Like Building now and Queued, the section is not rendered until a card ships.

**Funding bar.** `.bar` is 0.5rem tall with rounded ends: `--track` behind, `--accent` fill sized by the percentage. It carries `role="progressbar"` and the card title as its label. The amount is always written under it, never only drawn.

**Contribute chooser (`/contribute`).** A text page with the title "Where should your contribution go?" and a lede.
- The first choice is **Pick for me**, a filled `.choice-primary` block that goes to the Payment Link with no card.
- Then "Or pick a card", with fundable cards grouped by category, each a `.choice` block linking to the Payment Link with the card id.
- The split line comes last.
- Every choice is one large link at least 44px tall.

**Text pages** (`/terms`, `/privacy`, `/refunds`, `/contact`, through `TextPage`). A `main.text-page`, never `.wide`, so every block stops at `--measure`.
- `PageHeader` gives the one `h1` and the lede.
- Each section is a `section.section` that opens with an `h2`, followed by plain paragraphs. Sections sit `--space-4` apart, closer than landing sections, because each holds only a sentence or two.
- In the copy, `{email}` becomes the contact address as a mailto link, `{refunds}` a link to the Refunds page, and `{discord}` the Discord invite.
- The legal pages end with the muted small "Last updated" line. Contact adds a Discord section only when the invite is set.
- The strings live in `copy.ts` like every public string. The pages never say draft.

**Stale and missing figures.** A failed refresh keeps the figures on screen and adds the stale line under the Right now heading and under the lede of the ledger and contribute pages. When one part of the data did not load, that part says "Not available right now." instead of a zero or an empty line: agent spend and tokens, agent actions and deploys. The launch line is left out when the studio's launch date did not load, and a funding caption leaves out the contributor count when the funding figures did not.

**Figure row.** `Stat` renders a `div.stat` inside `dl.stats`: the label (600) and a muted description on the left, the amount on the right in tabular numerals at `--size-lead`. Every figure has a description.

**Event and deploy rows.** `ul.rows`, small text, with hairlines between rows. The time is muted, then a plain sentence: "Builder A started · card title". Event types become words through `copy.eventVerbs`, and deploys read "Game 2775bcb passed checks".

**Buttons and links.** `.button` is filled black with white text; `.button-secondary` is outlined; `.button-block` fills its container's width. All are sentence case at weight 600, at least `--target` tall, with `--radius` corners. Body links are underlined and get a thicker underline on hover. The keyboard focus ring is `--focus` everywhere.

**Disclosure.** `details.brief` is native and closed by default. Its summary is muted, small and underlined. When open, the text sits beside a 2px `--line` rule.

**Lists.** How it works is an `ol.steps` grid: one column on phones, two from 48rem, four from 64rem. The fixed rules are a `ul.rules` with discs, at the reading measure.

**Footer.** Muted small text on one hairline: the footer line, then `ul.footer-links` with Terms, Privacy, Refunds, Contact and Discord (when the invite is set), then the "Created by Clayhouse" credit. The links are underlined like every body link and wrap onto their own line on a phone.

**Link preview image.** `public/og.png` is 1200×630 and typographic: the wordmark with the peanut mark, the pitch line as the heading and lede, and the address in muted small text on `--paper`. `scripts/og-image.mjs` draws it from `styles.css` at a 175% root size, so the tokens scale together. Run it again and commit the PNG when the pitch, the tokens or the mark change.

**Forms (/board).** Labels at weight 600 above the fields. Fields are `--target` tall with a `--field` border and `--radius` corners. Buttons use `.button` styling.

**Two-factor step (/board).** A board member's first section until the session has a verified second factor. It says what stays hidden. With no authenticator app, it shows a "Set up an authenticator app" button, then the QR code (`img.qr`, 12.5rem), the secret in `code` and a 6-digit code form. With an app, it shows the code form only.

## Breakpoints

- Below 30rem: the nav drops under the wordmark.
- From 48rem: card grid and steps go to two columns.
- From 64rem: the intro splits 3:2, the card grid goes to three columns, steps to four, and Funding and Ledger sit side by side.

## Copy rules

- Plain, short and declarative. One idea per sentence. Sentence case everywhere.
- Say "contributions", never "donations".
- Money is `$0.00`. Counts use thousands separators.
- Never describe something that doesn't exist yet: no stream, badge or feature before it ships.
- Name things the way a first-time reader would: "Building now", "Fund what's next", "Held in reserve".

## Accessibility checklist

- One `h1` per page; headings never skip a level.
- Text contrast is at least 4.5:1, and control borders at least 3:1.
- Every interactive element is reachable by keyboard and shows the focus ring.
- Touch targets are at least 44px tall.
- No horizontal scroll at 375px (Playwright checks the landing, contribute, ledger, terms, privacy, refunds, contact and board pages).
- Information is never carried by colour alone or hidden behind hover.
