# Site layout: use the screen, separate what to fund, choose before checkout

Status: done. Card: none. Owner: board.

## Problem

After the design pass (`site-design.md`), the board found the site compressed. It had a 44rem column on a wide screen, cards that blended together as text between hairlines, no separation between funding the current game, the studio platform or a next game, and a Contribute button that went straight to checkout with no chance to pick a card.

## Scope

In:
- A 72rem page width with text held to a 44rem measure.
- The landing intro with a Right now panel.
- Card boxes in a responsive grid.
- Cards grouped into Building now, Fund what's next and Queued.
- A category filter: All, Dust, The studio, Next game.
- A `/contribute` chooser with Pick for me first.
- The site reads `cards.bucket` and `cards.folder`.
- BRAND.md updated.

Out: funding a next game (no folder or card exists; the next game is picked by a vote), an on-site checkout form, Shipped cards, legal pages.

## Behaviour

**Landing page.**
- It opens with the pitch and Contribute beside a Right now panel (available money, what is building, what shipped last). ~~the last three agent actions~~ Superseded: `panel-gap.md` (2026-09-16). The panel carries no list, so it stays about as tall as the pitch and the row leaves no dead space; agent actions are the Ledger section below.
- Building now shows only when a card is building.
- Fund what's next lists proposed, designing and voted cards as boxes in a one-, two- or three-column grid. The picked cards come first, and the category filter sits above the grid.
- Queued lists funded cards as rows.

**Categories.** A card's category is The studio when its folder is `platform`, and Dust otherwise. The Next game filter shows a note that funding opens with the vote that picks the next game.

**Contribute.** Contribute in the nav and on the landing page goes to `/contribute`.
- Pick for me comes first and links to the Payment Link with no card.
- Each fundable card below, grouped by category, links to the Payment Link with its card id.

## Acceptance criteria

- [x] The top bar, main and footer share `--wrap` 72rem; no paragraph on the landing page is wider than `--measure`.
- [x] From 64rem the intro shows the hero and the Right now panel side by side, and the card grid has three columns; at 375px everything stacks with no horizontal scroll.
- [x] `groupCards` sends building and gated cards to now, funded cards to queued, and the rest to fund, in `fundOrder`.
- [x] The filter shows All, Dust, The studio and Next game with counts. Selecting one shows only that category's cards; Next game shows its note and no empty line.
- [x] Each card box shows category, status, title, summary, and a bar with its caption. A fundable card also has a full-width Fund this card button linking to the Payment Link with its id.
- [x] Contribute links in the nav and on the landing page point to `/contribute`.
- [x] On `/contribute`, the first link is Pick for me to the bare Payment Link, and fundable cards follow grouped by category, each with its card id. Cards that are full, not goals or already building are not offered.
- [x] The site's card select includes `bucket` and `folder`.

## Verification

- `pnpm verify` at the repository root exits 0.
- `pnpm --filter @backseat/site build && pnpm --filter @backseat/site e2e` passes, both with the Netlify public values exported and without them.
- Full-page screenshots of `/` at 1440px and 390px and `/contribute` at 1440px, taken with Playwright against the built site and checked by eye.
- After merge, the live site serves the new build-sha, and screenshots are sent to the board.

## Decisions

- 2026-09-14: the Next game filter is shown with an explanation, and nothing funds it yet (board). The dispatcher builds only `seed-1` and `platform`, and PLAN.md §4 picks the next game by vote.
- 2026-09-14: Contribute opens a chooser page before checkout, with Pick for me first (board). A page can be linked from Discord or a stream and works on a phone.
- 2026-09-14: funded cards move out of the grid into a Queued list. There is nothing to do with them, and mixing them with fundable cards made the grid read as one undifferentiated list.
- 2026-09-14: the landing page widens to 72rem while text stays at 44rem. This supersedes the single 44rem column in `site-design.md`, which suited prose but left most of a wide screen empty for a page of short repeated items.

## Evidence

2026-09-14, PR 15 merged as b2c6360 and served live (`version.json` sha b2c6360):
- Tests: `pnpm verify` exit 0; site 97 unit tests; e2e 5/5 with and without the public values.
- Live Playwright check:
  - landing h2 `["Right now","Fund what's next","Queued","How it works","Funding","Ledger","Fixed rules"]`
  - hero Contribute → `/contribute`
  - filters Dust 4 / The studio 0 / Next game 0 / All 4
  - Fund button 44px tall
  - Pick for me first → the bare Payment Link; 4 card choices carry card ids
  - no horizontal overflow at 375 and 1440 on `/`, `/contribute`, `/ledger`, `/board` and a 404
