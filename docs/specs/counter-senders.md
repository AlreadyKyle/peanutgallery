# Counter senders: the game's and the site's benchmark counts

Status: built. Card: none. Owner: studio.

Draft: written, not yet agreed. Agreed: the contract for the work, settled by the session or role that owns it (docs/PLAN.md §10 decision 74). Built: merged, and every criterion a test can prove is ticked; live verification is still to run. Done: every Verification line has been run and its output quoted. A criterion replaced by a later spec is struck through and names that spec.

## Problem

`docs/specs/operations.md` built the database side of the benchmarks' aggregate counters: `/api/count` and `count_play_event` take twelve new names and `public.daily_metrics` keeps their daily totals. Nothing sent them, so the rows of `docs/strategy/benchmarks.md` that need them read "not measured". This is the backlog entry "Aggregate counters for the benchmarks", the senders.

## Scope

In: Dust's returning, session and seed counts (`seed-1/render/count.ts`, `render/main.ts`); the site's home, dwell, broadcast, QR and Discord counts (`platform/site/src/lib/count.ts`, mounted by `App.tsx`); the source tag on /broadcast's QR code; the Privacy page's section; the two dwell rows on the benchmark review's scoreboard (`platform/dispatcher/src/benchmarks.ts`). Added by the full pass (its finding M6): the funnel's three counts below, with their migration `20261019020000_funnel_counters.sql` and `PLAY_EVENTS` in `platform/site/netlify/functions/card.mts`.
Out: any migration for the first counts (their names are in production since `20261017200000_benchmark_counters.sql`); Stripe's `checkout.session.expired`; scoreboard rows for the funnel; any cookie, local storage key, identifier, fingerprint or address; distinct referrers on /broadcast and contributions from the QR source, which need a record of a visit; clicks from links inside Discord posts back to the site, which need a source tag on the posts' links and a counter name for it; scoreboard rows for the broadcast and Discord counts, whose benchmarks are counted per stream, contribution or member; the board panel's play counts table, which still lists the four play counts.

## Behaviour

Every count is the event's name alone, `{"event": "<name>"}`, posted to `/api/count` on the page's own origin as a beacon (`navigator.sendBeacon`, else `fetch` with `keepalive` and no credentials), as `docs/specs/play-counts.md` sends the play counts. Nothing waits on it and a failure is dropped. Each count is decided in the browser from what the page already holds; nothing new is stored to decide it.

### Dust

- `dust_return_1d`: the game loads from a save whose own `savedAt` is at least 20 hours and under 48 hours old. `dust_return_7d`: at least 6 days and under 8 days old (benchmarks.md, Player D1 and D7). A save without `savedAt`, a fresher or older save, or a clock set back counts neither. Starting from a seed writes a save with no `savedAt`, so the reload after it is not a return.
- `dust_session_2m` and `dust_session_4m`: the page has been visible for 2 and 4 minutes of this page load (benchmarks.md, Session length). The clock is read every second; hidden time is not counted, and one reading credits at most 5 seconds, so a held timer (a sleeping laptop) is not play.
- `dust_seed_save`: Save as seed is pressed. `dust_seed_open`: the page opens with a `?seed=` link that decodes to a run (a broken link counts nothing).
- Each of these six is sent at most once per page load.

### The site

- `home_load`: home (`/`) is shown, once for each view of it, including a return to home inside the site. A tab opened hidden counts its view when it is first shown.
- `home_dwell_mid` and `home_dwell_long`: that view of home has been visible 15 and 45 seconds, the Studio dwell benchmark's floor and target. The clock is read every second, counts only visible time, credits at most 5 seconds a reading and stops when the visitor leaves home. A view is in the mid bucket when it reaches 15 seconds, so the median dwell meets the floor when `home_dwell_mid / home_load` is at least a half, and the target when `home_dwell_long / home_load` is.
- `broadcast_load`: /broadcast is shown, once per page load.
- The QR code on /broadcast opens `https://mobmachine.games/contribute?from=broadcast`. A page that opens with `from=broadcast` in its query counts `broadcast_qr` once and drops the tag from the address (keeping the rest of the query and the hash), so a reload or a copied address does not count again.
- `discord_click`: a press (a click, or a middle-button press) on any link to the site's Discord invite or to Discord's own hosts (discord.gg, discord.com, discordapp.com), once per page load. The press is not held: the beacon goes as the link opens.

### The funnel

The step from interest to payment: how many reach /contribute, how many press through to Stripe's checkout, and how many of home's views go on to the game.

- `contribute_load`: /contribute is shown, once per page load, whether the page opened there or the visitor moved to it inside the site. A QR or channel landing on /contribute counts it beside the landing.
- `checkout_open`: a press (a click, or a middle-button press) on the site's Payment Link (its configured address, with any query), on any page (home's and a card page's Fund this card, /contribute's choices and the Machine card, /thanks), once per page load. The press is not held: the beacon goes as the link opens.
- `home_play_click`: a press on a link into the game while home is shown (the play address's origin, at or under its path, with any query: Play free, Play Dust free, the top bar's Play, a shipped card's Play), once per view of home, the unit `home_load` counts, so `home_play_click / home_load` is the share of home's views that go on to play. Away from home, or with no play address, nothing is counted.
- The live check is not a visitor for these either: every page it opens answers `/api/count` in the browser, so its load of /contribute sends nothing out, and it presses no link, so it sends no `checkout_open` or `home_play_click`.
- An automated browser is not a visitor (issue #240): both senders send nothing when `navigator.webdriver` is true, which WebDriver and Playwright set, so a screenshot run or any other robot opening production adds nothing to any count. Nothing about the browser is sent or stored; it is one more reason not to count. The e2e suites play a person's browser: their page reads `navigator.webdriver` as false, and one site test sets it back to true and sees no count.
- The migration adds the three names to `play_counts_event_check` and `count_play_event`, the same list as `PLAY_EVENTS`; `refresh_daily_metrics` already copies every name into `daily_metrics` as `play.<name>`. Every statement runs twice without error.

### Privacy and the scoreboard

- The Privacy page's Play and share counts section names every count above, says the browser decides whether a count applies from what it already holds, that the save's own time is never sent, and keeps the rule: no cookie, no identifier, no IP address, nothing new stored in the browser.
- The benchmark review's scoreboard gains `site.dwell_mid` (home views staying 15 seconds or more / home views, target and floor a half) and `site.dwell_long` (45 seconds or more, target a half). Both read "not measured" until `home_dwell_mid` has been counted. The rows for Player D1 and D7 and session length were already on it and now have counts to read.

## Acceptance criteria

- [x] A save at least 20 hours and under 48 hours old counts `dust_return_1d`, at least 6 days and under 8 days `dust_return_7d`, and any other age, no save or a clock set back counts neither (`seed-1/tests/count.test.ts`).
- [x] The session clock counts `dust_session_2m` at 120 and `dust_session_4m` at 240 visible seconds, each once, and never hidden time or more than 5 seconds a reading (`seed-1/tests/count.test.ts`).
- [x] Each of Dust's six counts goes through one once-each sender per page load, and counting reads no storage key but the save (`seed-1/tests/count.test.ts`).
- [x] A seed link that opens and Save as seed are each counted once, a day-old save counts `dust_return_1d`, and counting stores no key (`seed-1/e2e/seed.spec.ts`).
- [x] The site's dwell clock counts `home_dwell_mid` at 15 and `home_dwell_long` at 45 visible seconds per view of home, and nothing once the visitor leaves home or while the tab is hidden (`platform/site/src/lib/count.test.tsx`, `e2e/counts.spec.ts`).
- [x] /broadcast counts `broadcast_load` once per page load; its QR code opens /contribute with `from=broadcast`; that landing counts `broadcast_qr` once and drops the tag (`count.test.tsx`, `e2e/counts.spec.ts`).
- [x] A press on a Discord link counts `discord_click` once per page load and the link still opens; other links count nothing (`count.test.tsx`, `e2e/counts.spec.ts`).
- [x] Every request is a POST to the page's own `/api/count` with the event's name alone, no query string and no cookie (`e2e/counts.spec.ts`, `seed-1/e2e/seed.spec.ts`).
- [x] The Privacy page names the new counts and keeps the no cookie, identifier or address rule (`platform/site/src/lib/legal.ts`).
- [x] The scoreboard measures the dwell rows from the counts, and reads them as not measured before any dwell count (`platform/dispatcher/test/benchmark-review.test.ts`).
- [x] /contribute counts `contribute_load` once a page load, opened by address or reached inside the site, and beside a QR or channel landing (`platform/site/src/lib/count.test.tsx`, `e2e/counts.spec.ts`).
- [x] A press on a Payment Link counts `checkout_open` once a page load and the link still opens checkout; a right-button press, or a link on another host that only starts like Stripe's, counts nothing (`count.test.tsx`, `e2e/counts.spec.ts`).
- [x] A press on a link into the game counts `home_play_click` once a view of home, a middle-button press included, and nothing away from home or with no play address; the link still opens the game (`count.test.tsx`, `e2e/counts.spec.ts`).
- [x] `PLAY_EVENTS` and `count_play_event` take the three names and still drop others; the migration applies a second time; `refresh_daily_metrics` writes `play.contribute_load`, `play.checkout_open` and `play.home_play_click` (`platform/site/netlify/card.test.ts`, `platform/supabase/functions/_shared/funnel_counters_test.ts`, `migration_test.ts`).
- [x] The live check presses nothing and answers every count beacon in the browser (`platform/site/src/live-check-counts.test.ts`).
- [x] An automated browser (`navigator.webdriver` true) sends no count from the site or from Dust, and a person's browser still counts (`platform/site/src/lib/count.test.tsx`, `seed-1/tests/count.test.ts`, `e2e/counts.spec.ts`).
- [x] The Privacy page names the three counts (`platform/site/src/lib/legal.ts`).

## Verification

- `pnpm verify:changed`
- `pnpm --filter @backseat/seed-1 test`
- `npx vitest run src/lib/count.test.tsx src/components/ShareCard.test.tsx` in `platform/site`
- `npx vitest run test/benchmark-review.test.ts` in `platform/dispatcher`
- `E2E_PORT=4421 npx playwright test e2e/counts.spec.ts e2e/card.spec.ts e2e/landing.spec.ts e2e/text-pages.spec.ts e2e/home-flow.spec.ts` in `platform/site`
- `E2E_PORT=4422 npx playwright test e2e/seed.spec.ts e2e/a11y.spec.ts` in `seed-1`
- `pnpm test:docs`
- `pnpm verify`
- After merge, once both sites are deployed: the board's `board_daily_metrics` (or `daily_metrics_window`) shows `play.home_load` and `play.dust_session_2m` above 0 for the day after the deploy.
- The funnel: `npx vitest run src/lib/count.test.tsx netlify/card.test.ts src/live-check-counts.test.ts` and `E2E_PORT=4462 npx playwright test e2e/counts.spec.ts e2e/money.spec.ts` in `platform/site`; `deno test --config platform/supabase/functions/deno.json --allow-read --allow-env platform/supabase/functions/_shared/funnel_counters_test.ts platform/supabase/functions/_shared/migration_test.ts`.
- After the funnel merges, its migration applied and the site deployed: `board_daily_metrics` shows `play.contribute_load` above 0 for the day after the deploy, and the live check's first line still reads `PASS ... failed=0` with its beacon line held equal to sent.

## Evidence

Quoted in the branch's report.

## Decisions

- 2026-10-17: the counting logic lives in the two kernel count modules (`seed-1/render/count.ts`, `platform/site/src/lib/count.ts`), so no new kernel path is needed and no card can change what is counted.
- 2026-10-17: session and dwell count visible time only, read every second and credited at most 5 seconds a reading; a tab left open in the background is not play or dwell.
- 2026-10-17: `home_load` counts each view of home, not each page load, so the dwell buckets and their denominator count the same thing.
- 2026-10-17: `discord_click` counts presses on the site's Discord links (site to Discord), as the counter's name in `20261017200000_benchmark_counters.sql` and the operations spec describe it. benchmarks.md's "Discord to site" row reads clicks the other way, from Discord posts to the site; that needs a source tag on the posts' links and a counter name the database does not take yet, so the row stays not measured.
- 2026-10-17: the QR tag is `?from=broadcast`; the frame drops it on arrival, so it is never shared on.
- 2026-10-19: the funnel's three counts (the full pass's finding M6). `contribute_load` and `checkout_open` count once a page load, as `broadcast_load` and `discord_click` do, so a visitor going back and forth counts once; `home_play_click` counts once a view of home, the unit of `home_load`, so the two divide.
- 2026-10-19: `checkout_open` counts a link to the configured Payment Link's address with any query, so every path to checkout counts whatever its `client_reference_id`. It matches that address rather than Stripe's checkout host, because the gate's payment-host scan refuses any payment address in the build other than the Payment Link itself. Stripe's `checkout.session.expired` is left out by the board's call.
- 2026-10-19: the live check is not a visitor. `platform/site/scripts/live-check.mjs` opened `/` at each width and once more at 1440, so each run added up to 3 `home_load` (19 runs on 18 October: up to 57 of 106). Every page it opens now answers `/api/count` with a 204 inside its own browser, and the run checks that no beacon got out. The check never read a count, so no check was dropped, and `count.ts` does not skip on `navigator.webdriver`, which the e2e suites need. Read `home_load` from before this change less 3 for each `live-check` workflow run that day.
- 2026-10-19: the senders skip an automated browser after all (issue #240, from the weekly growth review). The live check already answered its own beacons, but threads' screenshot runs against production still counted: `home_load` read 159 for 13 to 19 October, mostly robots. Each sender returns early when `navigator.webdriver` is true; the site's e2e fixture and Dust's counting specs set it to false, so they still see every count. This replaces the line above that kept `navigator.webdriver` out for the e2e suites' sake.
