# A tab that outlived its build reloads itself

Status: done. Card: none. Owner: board.

Superseded in part by `site-snapshot.md`: the watcher also checks on every in-app route change, `watchForNewBuild` returns `{ check, stop }`, and a tab reloads at most once per served build (sessionStorage `pg:reloaded-for`).

## Problem

The board followed the Play link, pressed Back, and landed on the ledger page in the design the site had before 14 September: the pool figure in the top bar, the old type. Nothing on the server is stale; every page serves the current build. Chrome and Safari keep a whole page in the back/forward cache, so pressing Back after a cross-site link restores the document that tab loaded, with the code and copy of the build it started with. The same happens to any tab left open across a deploy, which at a studio that ships several times an hour is every tab.

## Scope

In: the public site notices it is running a build the site no longer serves and reloads once.
Out: a service worker, a visible "new version" prompt, offline support, and the game. Dust loads its data at runtime, and since D2 save and resume (ce35e53, `week1-runs.md`) it keeps progress in the browser across a reload (amended 16 September 2026; this spec first said the game kept no state worth protecting).

## Behaviour

- The page reads the build it is running from the `build-sha` meta tag the build stamps into `index.html`.
- On a back/forward restore (`pageshow` with `persisted`) and whenever the tab becomes visible again, it reads `/version.json` with `cache: 'no-store'` and reloads when the served sha differs from the one it is running.
- It reloads at most once.
- A page with no stamped build, a read that fails, and a hidden tab all leave the page alone, so an offline visitor is never reloaded into an error.

## Acceptance criteria

- [x] A page whose stamped build differs from the served build reloads once.
- [x] A matching build, a missing stamp, an unreadable `/version.json` and a hidden tab leave the page alone.
- [x] The watcher checks on a persisted `pageshow` and on a return to the tab, not on a first load, and stops when it is stopped.
- [x] On the live site, a tab held open across a deploy shows the new build after it is left and returned to.

## Verification

- `pnpm verify` at the repository root.
- `pnpm --filter @backseat/site test` covers `freshness.ts`.
- Live: load `https://peanutgallery.games`, note the `build-sha` meta, ship a card, return to the tab, and read the meta again.

## Evidence

2026-09-15, branch `stale-tab`, since merged as 89cdbe9 (PR 25): `platform/site/src/lib/freshness.test.ts` (5 tests) covers the reload, every case that must not reload, and the watcher's events.

2026-09-16: criterion 4 is still pending. Two merges since PR 25 changed `platform/site` (3a08226, PR 21, and 4f60c7c, PR 30), so the live check no longer waits on a deploy, but nobody has run it.

2026-09-26, criterion 4 on the live site. A headless tab loaded https://peanutgallery.games/team on build 747803a (grid-boxes, #84) and was held open, untouched, while studio-reports (#85) deployed 3c23f80; it then left /team through the top bar's Roadmap link and its build was read again. The log (`stale-tab-evidence.log`, kept outside the repository), all five lines:

```
2026-09-26T16:55:28.390Z HELD {"sha":"747803aced9027b59c57ba8f09c454843c77d166","held":"held-1790441728387","vis":"visible"}
2026-09-26T17:34:36.330Z DEPLOYED 3c23f80f261c6d3cd66125752a38023cb05166e6
2026-09-26T17:34:36.332Z BEFORE-NAV (tab untouched, not reloaded) {"sha":"747803aced9027b59c57ba8f09c454843c77d166","held":"held-1790441728387"}
2026-09-26T17:34:41.782Z AFTER-NAV {"path":"/roadmap","sha":"3c23f80f261c6d3cd66125752a38023cb05166e6","held":null,"navType":"reload"}
2026-09-26T17:34:41.782Z STALE-TAB PASS
```

After the navigation the tab runs 3c23f80: `held` is null, so the page's in-memory marker is gone, and `navType` is `reload`, so the in-app navigation became a full load of the new build rather than staying on the old bundle. The live path this exercises is the route-change check `site-snapshot.md` added; the return-to-tab and back/forward paths are the unit tests in `freshness.test.ts` above, since a headless tab never goes hidden. The Verification lines: `pnpm verify` and the site tests pass on `origin/main` at ed63326 (site `Tests  530 passed (530)`, `docs/specs/launch-hardening.md` Evidence), and the live line is the log above. Status done.

## Decisions

- 2026-09-15: reload without asking. The site is a read-only public page with nothing a visitor could lose, and a stale page misstates money (PLAN.md §4: the ledger is the record).
- 2026-09-15: no service worker. It would cache more, not less, and the kernel keeps the site simple enough to read.
- 2026-09-26: the live line was run across a site deploy from a board pull request rather than a shipped card. A deploy is what the criterion tests, and cards wait for GitHub Actions minutes.
