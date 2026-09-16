# A tab that outlived its build reloads itself

Status: built. Card: none. Owner: board.

## Problem

The board followed the Play link, pressed Back, and landed on the ledger page in the design the site had before 14 September: the pool figure in the top bar, the old type. Nothing on the server is stale; every page serves the current build. Chrome and Safari keep a whole page in the back/forward cache, so pressing Back after a cross-site link restores the document that tab loaded, with the code and copy of the build it started with. The same happens to any tab left open across a deploy, which at a studio that ships several times an hour is every tab.

## Scope

In: the public site notices it is running a build the site no longer serves and reloads once.
Out: a service worker, a visible "new version" prompt, offline support, and the game (Dust loads its data at runtime and keeps no state worth protecting).

## Behaviour

- The page reads the build it is running from the `build-sha` meta tag the build stamps into `index.html`.
- On a back/forward restore (`pageshow` with `persisted`) and whenever the tab becomes visible again, it reads `/version.json` with `cache: 'no-store'` and reloads when the served sha differs from the one it is running.
- It reloads at most once.
- A page with no stamped build, a read that fails, and a hidden tab all leave the page alone, so an offline visitor is never reloaded into an error.

## Acceptance criteria

- [x] A page whose stamped build differs from the served build reloads once.
- [x] A matching build, a missing stamp, an unreadable `/version.json` and a hidden tab leave the page alone.
- [x] The watcher checks on a persisted `pageshow` and on a return to the tab, not on a first load, and stops when it is stopped.
- [ ] On the live site, a tab held open across a deploy shows the new build after it is left and returned to.

## Verification

- `pnpm verify` at the repository root.
- `pnpm --filter @backseat/site test` covers `freshness.ts`.
- Live: load `https://peanutgallery.games`, note the `build-sha` meta, ship a card, return to the tab, and read the meta again.

## Evidence

2026-09-15, branch `stale-tab`: `platform/site/src/lib/freshness.test.ts` (5 tests) covers the reload, every case that must not reload, and the watcher's events. Live check pending the next deploy.

## Decisions

- 2026-09-15: reload without asking. The site is a read-only public page with nothing a visitor could lose, and a stale page misstates money (PLAN.md §4: the ledger is the record).
- 2026-09-15: no service worker. It would cache more, not less, and the kernel keeps the site simple enough to read.
