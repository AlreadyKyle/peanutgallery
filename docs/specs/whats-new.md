# What's new in Dust since your last visit

Status: draft. Card: none. Owner: studio.

## Problem

Mob Machine's hook is that the game changes as players fund cards, but a returning Dust player has no way to see that it changed. Nothing in the game says what shipped while they were away.

## Scope

In: a Phaser-free module `seed-1/render/whats-new.ts`, its line in `seed-1/index.html` (a kernel file, so a kernel pull request), a call from `seed-1/render/main.ts`, unit tests, and the seed-1 layout notes.
Out: any change to `SimState`, the save format or the state hash; any new proxy path or site function (`/api/cards` already carries `folder`, `stage` and `live_at`, and `seed-1/netlify.toml` already proxies it); drawing on the canvas.

## Behaviour

On load, when a save exists under `dust.save` and an earlier visit is recorded under `dust.lastVisit`, the game reads `/api/cards` and finds the seed-1 cards at stage `live` whose `live_at` is after that visit. If any, a line under the canvas, above the next card line, reads "New in Dust since your last visit: <title>" for one, or "N changes shipped since your last visit. Newest: <title>" for several, as one link to the newest card's page on https://mobmachine.games. The last visit moves to now once the read succeeds, or at once when there was no save or no earlier visit. A first visit, nothing new, a failed read, a malformed document or unavailable storage leaves the line hidden.

## Acceptance criteria

- [x] Only seed-1 cards at stage `live` with `live_at` after the last visit count, newest first (`tests/whats-new.test.ts`).
- [x] A first visit, or a save with no recorded visit, shows nothing, makes no read, and records the visit.
- [x] A failed read leaves the line hidden and keeps the old visit.
- [x] The last visit is its own localStorage key; the sim save is only checked for presence, never written.
- [x] The link is at least 44px tall and wraps inside a 375px viewport (`#whats-new a` in `index.html`: `min-height: 44px`, `max-width: 100%`, `overflow-wrap: anywhere`).
- [x] The link carries an `aria-label` naming the change and where it goes.

## Verification

- `pnpm --filter @backseat/seed-1 test`
- `pnpm --filter @backseat/seed-1 build`
- `pnpm verify:changed`
- `E2E_PORT=4430 npx playwright test` in `seed-1`

## Evidence

Quoted in the pull request's Verification section.

## Decisions

- 2026-10-11: link the newest shipped card's page rather than a list page. The site has a page per card; one link keeps the line a single 44px target on a phone.
