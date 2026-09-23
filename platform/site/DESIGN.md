# Peanut Gallery site style guide

This is the one style guide for the public site. The board's own site (`platform/board`, docs/specs/board-site.md) copies its tokens and form rules into its own stylesheet. The site is mostly short lines of text, so the design's job is to make them easy to read, understand and act on. When in doubt, remove something.

Tokens live at `:root` in `src/styles.css`. `src/styles.test.ts` enforces the rules marked **(tested)**.

## Principles

1. **One grid, readable lines.** The top bar, the page and the footer share one width (`--wrap`, 72rem), so every left edge lines up. Text never runs wider than `--measure` (44rem). Short, repeated items (cards, steps, figure groups) sit side by side on wide screens and stack on phones.
2. **Sentence case, regular style.** Headings are bold, not shouting. Italic and uppercase appear only in the wordmark **(tested)**.
3. **Show, don't hide.** Anything a reader needs to understand a figure or a card is written under it in gray. No tooltips and no icons that need a tap.
4. **Two text colours.** `--ink` for what matters, `--muted` for what explains it. Both meet WCAG AA on white **(tested)**.
5. **Space before rules.** Sections are separated by space. Hairlines (`--line`) separate rows in a list, and the top bar and footer. Things you can act on (cards, choices, the Right now panel) are boxes with a `--line` border and `--radius-box` corners, so they read as separate objects.
6. **Things you can press look pressable.** Links are underlined, and buttons are filled or outlined boxes at least 44px tall **(tested)**.
7. **Every public string lives in `src/lib/copy.ts`.** The board's own site keeps its own literals.
8. **Three text styles to a block.** A block (the hero, a card, a panel, a section intro) uses at most a heading, body text and one small muted line, plus its button. If a fourth style seems needed, the block is saying too much: cut a line or move it.
9. **Headings balance their lines.** Headings use `text-wrap: balance` **(tested)**, so a headline never leaves one or two words alone on its last line.

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
| `--field` | `#8a8a8a` | Form field borders, 3.5:1 as a non-text control; the dashed frame of an example |
| `--creature-*` | eleven fills (blue, lavender, green, pink, orange, yellow, purple, grey, teal, red, brown) | Agent avatar fills only; every avatar shape has an `--ink` outline, so no fill carries meaning |
| `--font-sans` | system UI stack | Everything |
| `--font-mono` | system mono stack | Commit shas |
| `--weight-body` / `--medium` / `--strong` / `--bold` | 400 / 500 / 600 / 700 | Body / nav / card titles, labels, buttons / headings, wordmark |
| `--leading-body` | 1.6 | Body |
| `--leading-heading` | 1.25 | Headings |
| `--space-1` … `--space-5` | 0.5 / 1 / 1.5 / 2.5 / 4rem | All spacing |
| `--wrap` | 72rem | Page width: top bar, main, footer |
| `--measure` | 44rem | Maximum width of any text block; the whole content of text pages (ledger, contribute, terms, privacy, refunds, contact) |
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

**Top bar.** The wordmark (the peanut mark and the studio name, a link home) sits on the left. The nav on the right has How it works, Team, Roadmap, Ledger, Play, Discord, then Contribute in bold. Contribute goes to `/contribute`, never straight to checkout. Links that need an unset env value are left out. There is no Home link (the wordmark is one) and no Board link. Below 30rem the nav drops under the wordmark and wraps onto two lines.

**Landing intro.** `.intro` holds the hero and the Right now panel: side by side (3:2) from 64rem, stacked below.
- **Hero:** one `h1` (the first pitch sentence), a `.lede` (the second), the muted launch line, the Contribute button and the muted split line.
- **Right now (`aside.panel`):** the paused notice while the agents are paused, the In the pool figure, what is building (or "Nothing is building", which says the agents are paused while they are), "Latest shipped: <title>" once a card has shipped, and a Full ledger link. In the pool shows the pool balance floored at $0.00; when agent work has cost more than came in, its description says by how much. Under the heading sits the page's status line (see Stale and missing figures). It carries no list: the panel has to stay about as tall as the pitch beside it, or the grid row leaves dead space under the pitch. Agent actions are the Ledger section below and the ledger page.

**Landing order.**
1. Intro.
2. Building now, only when a card is building.
3. Fund what's next.
4. Queued, only when a card is funded and waiting.
5. Shipped, only when a card is live.
6. How it works: three short lines and a link to `/how-it-works`.
7. Funding and Ledger, side by side from 64rem.
8. Fixed rules.

**Section.** `section.section` opens with an `h2` and nothing above it but space. Paragraphs directly inside a section stop at `--measure`.

**Category filter.** `.filters` is a `role="group"` row of `button.filter` chips: All, Dust (the current game), The studio (platform cards), Next game. All and Dust always show; The studio and Next game show only while a card is in them (`visibleFilters`), so at launch, with the platform code lane closed, the row is All and Dust. Each chip shows its count and uses `aria-pressed`; the pressed chip is filled, and a pressed chip that empties falls back to All. A category chip adds one muted note. A category comes from the card's folder (`categoryOf` in `src/lib/cards.ts`).

**Card grid.** `ul.card-grid` has one column on phones, two from 48rem and three from 64rem. Each `li.card` is a box:
- a top line with the category (muted, 600) and the status. "Open for funding" is plain; "Picked by the board", "Building" and "Being checked" are `.badge` pills.
- the `h3` title and the summary.
- `.card-bottom`, pushed to the bottom so bars and buttons line up across a row. It holds the funding bar, its caption ("$0.00 of $3.00 · 0 contributors"), a full-width outlined "Fund this card" button and the brief disclosure. A building card shows "$x spent so far · source" there instead; the amount is studio-billed spend and is left out when there is none.

**Card groups** (`groupCards`). Building now, Fund what's next and Queued hold horizon `now` cards only; a `next` or `later` card is on the roadmap and never shows as open for funding.
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

**Stale and missing figures.** A failed or timed-out refresh keeps the figures on screen and shows "Could not refresh. These figures may be out of date." until a load succeeds. Each page has one `p.muted.small.status` with `role="status"`, always in place and empty until then, so a screen reader announces the text when it arrives; `.status:empty` takes no space. It sits under the Right now heading on the landing and under the lede on the ledger, contribute, team and roadmap pages. The Funding meter repeats the line above its figures, without `role="status"`, so a reader who scrolls to the money sees it and a screen reader hears it once. When one part of the data did not load, that part says "Not available right now." instead of a zero or an empty line: agent spend and tokens, agent actions and deploys. The launch line is left out when the studio's launch date did not load, and a funding caption leaves out the contributor count when the funding figures did not.

**Figure row.** `Stat` renders a `div.stat` inside `dl.stats`: the label (600) and a muted description on the left, the amount on the right in tabular numerals at `--size-lead`. Every figure has a description.

**Event and deploy rows.** `ul.rows`, small text, with hairlines between rows. The time is muted, then a plain sentence: "Builder A started · card title". Event types become words through `copy.eventVerbs`, and deploys read "Game 2775bcb passed checks". The smoke bot's raw output stays in the database and is never shown.

**Buttons and links.** `.button` is filled black with white text; `.button-secondary` is outlined; `.button-block` fills its container's width. All are sentence case at weight 600, at least `--target` tall, with `--radius` corners. Body links are underlined and get a thicker underline on hover. The keyboard focus ring is `--focus` everywhere.

**Disclosure.** `details.brief` is native and closed by default. Its summary is muted, small and underlined. When open, the text sits beside a 2px `--line` rule.

**Lists.** The landing's How it works is an `ol.steps` of three lines: one column on phones, three from 48rem. The fixed rules are a `ul.rules` with discs, at the reading measure.

**Paused notice.** `p.notice`: one line in an `--ink` bordered box, weight 600, while `public_studio.paused` is true. It shows in the Right now panel, above the choices on `/contribute` and under the heading on `/how-it-works`. It says only what is true for any pause, and it never shows when the studio row did not load.

**How it works (`/how-it-works`).** A `main.wide` page: the heading and lede, the paused notice when paused, then `ol.how-steps` of six steps. Each `li.how-step` is a text half (an `h2` numbered by a CSS counter, and one or two paragraphs) and a visual half; from 48rem they sit side by side and swap sides on every other step, and on a phone the text comes first. Each visual is a real component in example mode inside `figure.example`: a dashed `--field` frame whose `figcaption` starts with "Example" and says whether it shows a real public record ("Example from the live studio") or made-up figures ("Example with made-up figures"). Example mode renders no link, button or disclosure, whatever the Payment Link says. Made-up visuals use times relative to now, never a fixed date. Then plain headed sections (Where the money goes, Holds and refunds, Rules that never change), written as statements, with no questions.

**The team (`/team`).** A `main.wide` page with two sections, Running and Not running yet, each a `ul.team-grid` of `li.card.role` boxes (one column on phones, two from 48rem, three from 64rem). A box has the avatar, the name as `h3`, "AI agent" (with the title when the name differs), the description, and one muted facts line. Running is derived, not labelled: a role runs when it builds cards in an open folder (`runsCards` in `src/lib/roster.ts`; the platform folder counts as open once the studio says its code lane is open). A running role's line is its model, hired date, live cards shipped and what it changes; a role that does not run shows none of those, only that it is not running and, for a closed lane, why. No scorecards.

**Avatar.** `components/Avatar.tsx` draws every agent as inline SVG from its one-line species note: colour and build from the words before "creature", then eyes, ears, horns, arms, a tail, a shell, legs and so on from the rest. The same note always draws the same picture. Fills come from the `--creature-*` tokens through `--avatar-fill`; every shape has an `--ink` outline. The SVG is `role="img"` with the species note as its `title`.

**Roadmap (`/roadmap`).** A text page: Next and Later as `h2` sections with a muted intro, each grouped by category (`h3`, small and muted) into `ul.planned` rows like Shipped. A row is the `h4` title, the summary and the muted "Planned and not built yet". No bar, no status, no fund link.

**Footer.** Muted small text on one hairline: the footer sentence ("AI agents build free games you can play in a browser."), then `ul.footer-links` with Terms, Privacy, Refunds, Contact and Discord (when the invite is set), then the "Created by Clayhouse" credit. The links are underlined like every body link and wrap onto their own line on a phone.

**Link preview image.** `public/og.png` is 1200×630 and typographic: the wordmark with the peanut mark, the pitch line as the heading and lede, and the address in muted small text on `--paper`. `scripts/og-image.mjs` draws it from `styles.css` at a 175% root size, so the tokens scale together. Run it again and commit the PNG when the pitch, the tokens or the mark change.

**Forms (the board's own site).** Labels at weight 600 above the fields. Fields are `--target` tall with a `--field` border and `--radius` corners. Buttons use `.button` styling. The board site opens on the Needs you inbox, then has, after the second factor: pause and resume, the studio status, the caps form (`set_caps`, every cap with a reason), record a credit purchase, one form per card for horizon, rank, target, cancel and resume (`ul.board-cards`), file a card (with its horizon), file a directive and file a note.

**Two-factor step (the board's own site).** The section under the Needs you inbox until the session has a verified second factor. It says what stays hidden. With no authenticator app, it shows a "Set up an authenticator app" button, then the QR code (`img.qr`, 12.5rem), the secret in `code` and a 6-digit code form. With an app, it shows the code form only.

## Breakpoints

- Below 30rem: the nav drops under the wordmark.
- From 48rem: card grid and team grid go to two columns, steps to three, and each How it works step puts its text and visual side by side.
- From 64rem: the intro splits 3:2, the card grid and team grid go to three columns, and Funding and Ledger sit side by side.

## Copy rules

The full rules, with examples and the patterns to avoid, are in `docs/COPY.md`. `src/lib/copy.test.ts` enforces them. In short:

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
- No horizontal scroll at 375px or 1440px (Playwright checks the landing, contribute, ledger, how it works, team, roadmap and the paused state at both widths, and terms, privacy, refunds and contact at 375px; the board site's own suite checks it at 375px).
- Information is never carried by colour alone or hidden behind hover.
