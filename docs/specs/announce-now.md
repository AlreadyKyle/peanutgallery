# Announce now

Status: built. The /contribute and /thanks timing line and home's queue line were removed by `specs/build-on-funding.md` (PLAN.md §10 decision 65): a funded card builds at once. Card: none. Owner: board.

## Problem

The launch drafts waited for a clip of the first player-funded card, but no player has paid yet and the announcement is how the first players' money arrives (PLAN.md §10 decision 64). Posted as written, the drafts promised a clip that does not exist, said the code was private when the repository is public, and implied a funded card builds at once. The site said the same: "When a card's bar fills, the agents build it", with nothing on /contribute or /thanks about when the agents start.

## Scope

In: the five post drafts and the launch README; one timing line on /contribute and /thanks; home's fund line; the game's link preview image; PLAN.md §7 Order and decision 64; the board's step 40.
Out: the dispatcher's host state, per-page link previews on the main site, the /contribute desktop layout.

## Behaviour

- The drafts carry no clip placeholder, link to the free game at https://play.mobmachine.games, say nothing about the code, and describe the product as it is, with nothing about the studio's current state.
- /contribute shows, among its footnotes before checkout: "The agents are paid for with contributions once Stripe pays them out to the studio, which can take up to two weeks. A funded card waits in the queue until then."
- /thanks shows, in every finished state: "The agents start on a funded card once Stripe pays your contribution out to the studio, which can take up to two weeks. This page and the card show when it starts."
- Home's fund line reads "Fund a card to grow the games and the studio. When a card's bar fills, it joins the agents' queue."
- https://play.mobmachine.games carries og:image (the studio's https://mobmachine.games/og.png) and `twitter:card` `summary_large_image`.

## Acceptance criteria

- [x] No file in `docs/launch/` holds "clip link" or mentions the code being private or public.
- [x] Every X post is at most 280 counted with a link as 23; the Show HN first comment is under 2,000 characters.
- [x] /contribute and /thanks render the timing line; home renders the new fund line.
- [ ] Live: the three site lines and the game's og:image are served in production.

## Verification

- `pnpm verify`
- `node platform/site/scripts/live-check.mjs` first line `PASS ... failed=0`
- `curl -s https://play.mobmachine.games | grep og:image`
- `curl -s https://mobmachine.games/... ` the built bundle holds "can take up to two weeks"

## Evidence

Added in the pull request and after the deploy.

## Decisions

- 2026-10-07: the board announces now, before a player-funded card ships (PLAN.md §10 decision 64). The announcement is how player money arrives.
