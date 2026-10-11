# The first game on home, what the agents' share buys, and Dust counting time away

Status: agreed. Card: none. Owner: board.

Draft: written, not yet agreed by the board. Agreed: the contract for the work. Built: merged, and every criterion a test can prove is ticked; live verification is still to run. Done: every Verification line has been run and its output quoted. A criterion replaced by a later spec is struck through and names that spec.

## Problem

Public feedback after the announcement said three things. Home never shows a game, so nothing proves the agents ship: the only way in is a "Play free" button that names nothing (decision 58). Home states the 10/80/20 split but not what the agents' share pays for. And Dust credits nothing for time away: Phaser stops or clamps its frame time in a background tab, and the save carries no time, so a tab left behind or a closed page earns nothing.

## Scope

In: a first-game tile on home, first in the card band; one sentence in home's Where the money goes; Dust stepping by wall-clock time and its save recording when it was written.
Out: embedding the game in the site (the game refuses framing and the site's CSP has no `frame-src`); the pitch, the footer, the suit chip and the video, which still name no game; the split itself and every other money rule.

## Behaviour

Home's card band opens with **Play the first game**: a still of Dust in play with alt text, the name Dust, one line saying it is an idle game for a browser that the agents built and keep changing one funded card at a time, and **Play Dust free** to the game. The tile is drawn only when the site has a play address, like the hero button. It is not a card and carries no bar. On a phone it stacks; from 48rem the still sits beside the text.

Where the money goes adds, after the split: "The agents' share pays only for the AI model time that builds funded cards, and the ledger lists every cost." It restates fixed rule 2 and the ledger's Agent spend line; no rule changes.

Dust advances by the wall clock between frames, so a background tab is credited when it returns. Every save records when it was written (`savedAt`, beside the state in the save wrapper, so the pinned state hash is untouched), and loading a save credits the time since. Both credits are clamped to between zero and 8 hours. A save without `savedAt` still loads, with nothing credited. The credit is one step at the rate the player had when they left; unlocks reached during it open on return.

## Acceptance criteria

- [ ] Home's h2 order is Play the first game, Pick a card to fund, How the cards move, The team (when drawn), Where the money goes.
- [ ] The tile shows the still, the name Dust and Play Dust free linking the play address; with no play address it is not drawn.
- [ ] Home names Dust only in the tile; the pitch, footer, lanes, Play free and the suit chip name no game.
- [ ] Where the money goes shows the agents' share line.
- [ ] Every card stays in band 2 and no page scrolls sideways at 320 to 1440px.
- [ ] Dust credits about four minutes of production after four minutes in a background tab, and after a page closed for four minutes.
- [ ] `awaySeconds` never returns below 0 or above 8 hours; a save without `savedAt` loads.
- [ ] The bot's four invariants hold and the pinned timeline hash is unchanged.

## Verification

- `pnpm verify`
- `E2E_PORT=<port> npx playwright test e2e/landing.spec.ts e2e/design.spec.ts e2e/home-flow.spec.ts e2e/money.spec.ts e2e/layout-balance.spec.ts e2e/csp.spec.ts` in `platform/site`
- `pnpm --filter @backseat/seed-1 test` and `pnpm --filter @backseat/seed-1 bot -- --config-dir seed-1/config --hours 10 --seed 20260914`
- A Playwright run against the built game with a fake clock: four minutes in the background, and a page closed for four minutes, each credit about 240 dust at 1.0 per second.
- After merge, the first line of the `live-check` workflow's run for the merge commit.

## Evidence

## Decisions

- 11 October 2026: the board names the first game on home, amending decision 58 (`docs/PLAN.md` §10 decision 68). A visitor should see a real, playable game before being asked to fund one.
- 11 October 2026: time away is capped at 8 hours, so a months-old save or a clock set forward cannot flood the economy.
