# Home: one card flow that is never empty

Status: agreed. Card: none. Owner: board.

## Problem

The live home page showed no card faces. Production on 10 October 2026: the machine had drafted, approved, funded, built and shipped three agent cards that day, each in about ten minutes. Its four drafts for the day were used, one of them lost to an over-long Game Director note, so no card was open, funded or building. Home drew card faces only in Building now, Fund what's next and Queued. Shipped and Planned next were plain rows in a later band. So the page looked empty while the studio was working, and the three stages sat in three sections with three layouts.

## Scope

In:
- Home's card band, as one flow of four lanes.
- The status line's drafting sentence.
- A text-free drafting status in the live document (`public_supply`).
- Clipping an over-long Game Director verdict note, so it no longer fails a draft run.
- The live check, the tests and the docs that describe home.

Out:
- The draft cap: still 4 runs a day, the board's call on 10 October 2026.
- The waterfall, the floor and every money rule.
- /contribute, /roadmap, the card's own page and the board's site.

## Behaviour

Home's second band (paper) is one section, **How the cards move**. It holds four lanes in the order a card moves:
1. **Next up.** The roadmap's cards, held cards left out: an approved agent card waiting to open first, then cards for players or the studio, then board work. Each is drawn with the Planned face (a clock glyph) and one line: "Approved, opens soon", "Planned, opens for funding later" or "Board work, built by the board". The lane's who-line is the Game Designer's state, from the studio's supply:
   - "The Game Designer is drafting a new card now."
   - "The Game Designer has used its n drafts for today and drafts again tomorrow."
   - "The Game Designer drafts a new card when too few are open."
2. **Fund now.** The open cards in the waterfall's order, each with its bar, spec rows and Fund this card, then the agreement line.
3. **Building.** The cards being built or checked, then the funded cards waiting for the agents.
4. **Shipped.** The newest live cards, each with what it cost, when it shipped and Watch how it was built.

Every lane has the same parts:
- its numbered step on a rail
- its name and how many cards it holds
- who acts in it
- at most three compact card faces (index, title, bottom block; no summary)
- for Next up and Shipped, a link to /roadmap; for Fund now, a link to /contribute past three cards

A lane with no card shows a dashed tile saying what happens next, so no lane is ever blank:
- **Next up:** "Nothing is planned yet."
- **Fund now:** "Fund the next card in line", the waits line and Contribute.
- **Building:** nothing is being built, a funded card starts within about half an hour, and the last card built.
- **Shipped:** "Nothing has shipped yet."

Layout:
- **From 64rem:** four equal columns, sharing their rows so every lane's first card starts on one line, with the rail running across the steps.
- **Below 64rem:** the lanes stack, joined by a vertical rail.

When no card is open and the Game Designer is drafting, the status line says "The agents are drafting the next card."

Bands on home: signal (what it is), paper (the flow), ink (the team), paper (where the money goes). Without team roles there are three bands. Cards sit only in band 2.

`public_supply()` returns only `drafting`, `short`, `reason` (a fixed code), `runs_today`, `run_limit` and `next_check_at`, with no card text. `site_live()` carries it as `studio.supply`. The site reads it as optional, so home works before the migration is applied.

## Acceptance criteria

- [ ] Home draws one h2, How the cards move, in band 2, with four lanes in order: Next up, Fund now, Building, Shipped.
- [ ] Every lane holds at least one card or its tile, and at most three cards, on the default studio, a production-shaped studio (everything shipped, no open card, the drafts used), while drafting, and with no cards at all, at 320, 390, 768 and 1280px, with no horizontal scroll.
- [ ] Fund now lists the waterfall's open cards with live Fund this card links to the Payment Link, and its titles are /contribute's first card choices in order.
- [ ] Building holds funded cards as "Waiting for the agents".
- [ ] Next up never shows a card on horizon now or a vetoed card.
- [ ] The Next up who-line and the status line follow the supply: drafting, daily limit, idle; a missing supply reads as idle.
- [ ] `site_live()->'studio'->'supply'` has exactly the six keys as anon, and `drafting` follows a queued or running `draft_card` run.
- [ ] A Game Director verdict whose note is over 600 characters is clipped to 600 and the draft run goes on; any other schema violation still fails.
- [ ] The live check fails when a lane is blank.

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
