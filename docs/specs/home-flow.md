# Home: the cards to fund, then one card flow that is never empty

Status: agreed. Card: none. Owner: board.

## Problem

The live home page showed no card faces. Production on 10 October 2026: the machine had drafted, approved, funded, built and shipped three agent cards that day, each in about ten minutes. Its four drafts for the day were used, one of them lost to an over-long Game Director note, so no card was open, funded or building. Home drew card faces only in Building now, Fund what's next and Queued. Shipped and Planned next were plain rows in a later band. So the page looked empty while the studio was working, and the three stages sat in three sections with three layouts.

## Scope

In:
- Home's card band: the cards to fund first, as full faces, then one flow of three lanes.
- The status line's drafting sentence.
- A text-free drafting status in the live document (`public_supply`).
- Clipping an over-long Game Director verdict note, so it no longer fails a draft run.
- The live check, the tests and the docs that describe home.

Out:
- The draft cap: still 4 runs a day, the board's call on 10 October 2026.
- The waterfall, the floor and every money rule.
- /roadmap, the card's own page and the board's site.
- /contribute's choices and money; only its width and the choices' drawing change.

## Behaviour

Home's second band (paper) holds two sections, the cards to fund first.

**Pick a card to fund.** Its intro says what a card is: "Each card is one small change to a game or to this site. When its bar fills, the agents build it." Below it:
- The open cards in the waterfall's order, at most three, as full card faces (suit and state, an h3 title, the summary, the bar, the spec rows and Fund this card) in the fund grid: one column on a phone, two from 48rem, three from 72rem.
- The agreement line once, under the grid, while any card carries a live Fund this card.
- Past three cards, a link to /contribute: "See all n open cards".
- With no card open, a panel on the primary fill instead of the grid: "Fund the next card in line", then "Your contribution waits in Not on a card yet, then funds the next card that opens." (it does not repeat the status line above it), the Game Designer's state with the pencil glyph, and Contribute while the Payment Link is set.

**How the cards move.** Its intro: "Cards wait here before they open for funding, then move along once their bar fills. Every card here is real." Three lanes, in the order a card moves:
1. **Next up.** The roadmap's cards, held cards left out: an approved agent card waiting to open first, then cards for players or the studio, then kernel work. Each is drawn with the Planned face (a clock glyph) and one line: "Approved, opens soon", "Planned, opens for funding later" or "The studio builds this one itself, with no card". The lane's who-line is the Game Designer's state, from the studio's supply:
   - "The Game Designer is drafting a new card."
   - "The Game Designer has used today's n drafts and is back tomorrow."
   - "The Game Designer drafts more cards when the open ones run low."
2. **Building.** The cards being built or checked, then the funded cards waiting for the agents.
3. **Shipped.** The newest live cards, each with what it cost, when it shipped and Watch how it was built.

Every lane has the same parts:
- its numbered step on a rail
- its name and how many cards it holds
- who acts in it
- at most three compact card faces (index, title, bottom block; no summary)
- a link: Next up to /roadmap, Shipped to /reports ("Read the weekly reports")

A lane with no card shows a dashed tile saying what happens next, so no lane is ever blank:
- **Next up:** "Nothing is planned yet. Approved drafts wait here before they open."
- **Building:** nothing is being built, a funded card starts within about half an hour, and the last card built.
- **Shipped:** "Nothing has shipped yet. Cards land here once they pass the checks."

Layout:
- **From 64rem:** three equal columns, sharing their rows so every lane's first card starts on one line, with the rail running across the steps.
- **Below 64rem:** the lanes stack, joined by a vertical rail.

When no card is open and the Game Designer is drafting, the status line says "The agents are drafting the next card."

**/contribute** takes the full width (`main.wide`). Fund the next card in line is one wide panel on the primary fill, with the agreement line under it. Each open card is a choice drawn like a card (a 2px ink edge, the card radius, the title at the lead size, the bar at its foot) in a grid of one column on a phone, two from 48rem and three from 72rem, like home's fund grid. Its DOM classes are unchanged.

Bands on home: signal (what it is), paper (the cards to fund, then how they move), ink (the team), paper (where the money goes). Without team roles there are three bands. Cards sit only in band 2.

`public_supply()` returns only `drafting`, `short`, `reason` (a fixed code), `runs_today`, `run_limit` and `next_check_at`, with no card text. `site_live()` carries it as `studio.supply`. The site reads it as optional, so home works before the migration is applied. (`honest-status.md` adds `offline` and makes `drafting` true only while a draft run is running and the dispatcher checked in within 15 minutes.)

## Acceptance criteria

- [ ] Home draws two h2s in band 2: Pick a card to fund, then How the cards move, with three lanes in order: Next up, Building, Shipped.
- [ ] Pick a card to fund holds at most three full faces in the fund grid, or the panel that funds the next card in line, never nothing.
- [ ] Every lane holds at least one card or its tile, and at most three cards, on the default studio, a production-shaped studio (everything shipped, no open card, the drafts used), while drafting, and with no cards at all, at 320, 390, 768 and 1280px, with no horizontal scroll.
- [ ] Pick a card to fund lists the waterfall's open cards with live Fund this card links to the Payment Link, and its titles are /contribute's first card choices in order.
- [ ] Building holds funded cards as "Waiting for the agents".
- [ ] Next up never shows a card on horizon now or a vetoed card.
- [ ] The Next up who-line and the status line follow the supply: drafting, daily limit, idle; a missing supply reads as idle.
- [ ] ~~`site_live()->'studio'->'supply'` has exactly the six keys as anon, and `drafting` follows a queued or running `draft_card` run.~~ Replaced by `honest-status.md`: seven keys with `offline`, and `drafting` only while a run is running and the dispatcher is fresh.
- [ ] A Game Director verdict whose note is over 600 characters is clipped to 600 and the draft run goes on; any other schema violation still fails.
- [ ] The live check fails when a lane or the fund section is blank.
- [ ] /contribute is full width, its card choices in one, two or three columns.

## Verification

- `pnpm verify`
- `E2E_PORT=<port> npx playwright test` in `platform/site`, including `e2e/home-flow.spec.ts`
- After merge and the migration: `select public.site_live()->'studio'->'supply'` returns the six keys, and the `live-check` run for the merge commit reads `PASS ... failed=0`.

## Evidence

Added when the status moves to built or done.

## Decisions

- 10 Oct 2026: four lanes, Shipped included, so the flow always shows real cards (the board).
- 10 Oct 2026: the draft cap stays at 4 runs a day (the board).
- 10 Oct 2026: the migration is applied to production from the cloud session through the Supabase connector once the gate passes (the board: "do whatever is best").
- 11 Oct 2026: the cards to fund come first and full size; three lanes after; /contribute full width with card-sized choices; a copy pass (the board).
