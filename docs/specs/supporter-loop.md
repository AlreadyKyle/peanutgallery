# Supporter loop

Status: built. Card: none. Owner: board.

## Problem

A UX audit of the fund, watch, ship and share loop found that it drops at /thanks: the page lists where the money went but gives the supporter nothing to hold, no picture of what happens next and no way to share. Nothing brings a supporter back to see the card ship, the open card lists give no sense of which card is nearly there, and a live card's "What changed" reads as raw config paths.

## Scope

In: the /thanks reward band (kernel); a "$X left" note on the open card closest to fully funded (kernel, `Funding.tsx`); a "Since your last visit" strip on home (card lane, localStorage only); "What changed" on a card's own page in plain words where the game's config says what a field means (card lane). `ShareCard.tsx` moves into the kernel list so /thanks can use it, and `site-kernel.test.ts` allows kernel files to import `Glyph.tsx`, a board-only design file.

Out: the ship email itself (pull request #169); the Card.tsx "board work" label and the `board:` fields of `docs/BACKLOG.md` (another pull request renames them); the explainer video, focus rings and live regions (another pull request); any new data: no migration, no new read, no new field in `thanks_for_session`.

## Behaviour

- **/thanks, recorded.** First, the card the money went to first (the named card, else the first card reached) as a card face: its title linking `/card/:id`, its state line, and on its face "Supporter N" (a founding supporter reads plain Supporter too, as the page already does) from the answer's supporter number. A payment with no supporter number draws the face without one. Under it "Share the card, so friends can follow it too." and the existing Share button, drawn as a primary button, sharing `/card/:id` and the card's title only. Then "What happens next": Drafting, Building, Checks, Live, each with one plain sentence, the card's current step marked "Now" (`aria-current="step"`) from its stage (funded: Drafting; building; gated: Checks; live), none while it is still open; then "When it goes live, the studio emails you a ship notice." A stopped card draws the face and Share but no steps. A reversed payment draws no reward band. The answer still holds no amount, email or name; the rest of the page is unchanged.
- **Open card lists.** The open card closest to fully funded says "$X left to fund it." under its spec rows: among the cards in the waterfall's order with a target and money still to raise, the one with the least left, the earlier in the order on a tie. No note when the order did not load. It is a fact: no countdown, timer, deadline or bonus. It shows wherever that card's face draws its money in live mode (home's fund grid, and the card's own page).
- **Since your last visit.** Home keeps one value in localStorage, `peanutgallery.home.lastVisit`, the time of this browser's last visit. Every read and write is wrapped in try/catch. On a return visit home lists, above the cards to fund, the cards that went live after it (newest first, at most five), each title linking `/card/:id`. A first visit, blocked storage or no new ships draws nothing. The value is never sent anywhere.
- **What changed.** A check on a row of the game's config, `<collection>[id=<id>].<field>` with a known collection (rows, buildings, unlocks) and field (baseCost, rate, name, atTotalDust, effect.value), reads in plain words, such as "Mill costs 1500 dust to build." or "Each Cart makes 2 dust a second." Any other path, and a value the page cannot show, keeps the raw `<file> <path>: <value>` line. The check carries only the value after the change, so no line says what it was before.

## Acceptance criteria

- [x] /thanks for a recorded payment shows the reached card's face with "Supporter 12" on it, the What happens next steps with the ship-email line, and a Share button; no amount, email or name appears (`thanks.spec.ts`).
- [x] The left note appears on exactly one card, the one with the least left in the order, as "$0.75 left to fund it.", and on none when the order did not load (`SupporterLoop.test.tsx`).
- [x] The left note's words carry no countdown, deadline or bonus word (`SupporterLoop.test.tsx`).
- [x] The strip lists live cards shipped after the stored visit, newest first, at most five, linking `/card/:id`; nothing on a first visit, bad value or throwing storage (`SupporterLoop.test.tsx`, `home-flow.spec.ts`).
- [x] Known config paths read in plain words and anything else falls back to the raw line (`SupporterLoop.test.tsx`, `card.spec.ts`).
- [x] `ShareCard.tsx` is in `kernel-paths.txt` and `KERNEL_PATHS`, and `site-kernel.test.ts` passes.

## Verification

- `pnpm --filter @backseat/site exec vitest run`
- `E2E_PORT=4450 npx playwright test e2e/thanks.spec.ts e2e/card.spec.ts e2e/home-flow.spec.ts e2e/landing.spec.ts e2e/money.spec.ts` in `platform/site`
- `pnpm verify`

## Evidence

Quoted in the pull request's Verification section.

## Decisions

- 2026-10-11: the supporter number goes on a face /thanks draws itself, not on `Card.tsx`, because /thanks is kernel and may not import the card-lane Card. The number is the one `thanks_for_session` already answers; nothing new is read.
- 2026-10-11: "What changed" shows only the value after the change. The check line holds no earlier value, so an "old → new" line would be invented.
- 2026-10-11: the left note sits in `Funding.tsx` (kernel) since it states a money figure, and copy.ts may not.
