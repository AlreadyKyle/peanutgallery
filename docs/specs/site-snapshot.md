# F1: the public snapshot from the site's own origin, and stale tabs reload on navigation

Status: done. Card: none. Owner: board.

Series position: after agent-workflows, before supporter-pages (the order is in `docs/ROADMAP.md`, "The launch series"). It is a board pull request: it adds a kernel path (`platform/site/netlify`) and changes legal-copy's kernel `terms.ts`.

## Problem

- Every open tab of the public site reads Supabase every 15 seconds, visible or not (nine queries plus a title read, about 19 KB gzipped). Each tab also holds a Realtime socket and reloads everything whenever `pool`, `cards` or `deploys` changes, which `record_usage` does on every model request.
- At the Flop scenario's 30 tabs that is 60 to 100 GB of egress a month against Supabase's free 5 GB, and Realtime's free limits (200 connections, 100 messages a second) break with 50 tabs. Past the egress quota Supabase restricts the whole project, so `stripe-webhook` stops crediting payments and the dispatcher loses its database.
- The card list is read oldest first with no limit, so past the project's Max Rows (1,000) the newest cards silently disappear.
- Rejected and paused cards never reach the site, although a paused card can still hold supporters' money.
- The browser keeps its own rule for what is open for funding (`payment.ts`: `isOpenForFunding`, `canFund`), separate from the one money-logic's waterfall uses.
- Hashed build files under `/assets/*` are served `max-age=0, must-revalidate`, so every page view revalidates them.
- A tab that stays open and navigates inside the site never learns that a newer build is live: the watcher checks only on a back/forward restore and on a return to the tab (`lib/freshness.ts`).
- Moving the reads onto Netlify Functions trades Supabase egress for function invocations: 125,000 a month per site on legacy Free, and at 100% of a metered limit Netlify pauses every site on the account (the public site, Dust and the board site that holds Pause) until the next cycle or a paid plan. Netlify also puts every query parameter in a function response's cache key by default, so a random query string skips the cache.

## Scope

In:
- **SQL.** Migration `20260924500000_site_snapshot.sql` (after agent-workflows'; bumped at build, keeping the series' order, if main holds a later file): `public.site_live()` and `public.site_cards()`, each `language sql stable security invoker set search_path = public`, execute revoked from public and granted to anon, authenticated and service_role. They read only what anon already reads.
- **One Netlify Function.** `platform/site/netlify/functions/snapshot.mts` answers `GET /api/live` and `GET /api/cards`; `platform/site/netlify/lib/public-env.ts` holds the Supabase URL and publishable key as constants. Unit tests beside them in `platform/site/netlify/snapshot.test.ts`, outside `functions/`, since Netlify deploys every file in that folder as a function.
- **`platform/site/netlify.toml`:** `[functions] directory = "netlify/functions"`; `/assets/*` served `public, max-age=31536000, immutable`; `connect-src 'self'` in both the enforced and report-only policies; the `VITE_SUPABASE_*` build values removed.
- **The client.** `src/lib/source.ts` rewritten as `createSnapshotSource` reading the two documents, with `src/lib/snapshot-keys.json` listing the keys it requires; `studio.tsx` polls only while visible; `supabase.ts` keeps only `clearStoredSessions`, `STORED_SESSION_KEY` and `errorMessage`; `env.ts` loses the Supabase values; `payment.ts` loses `isOpenForFunding`, and `canFund` stays only for sample and example cards, as money-surfaces left it; `terms.ts` (legal-copy, kernel) reads posted versions from the card document; `@supabase/supabase-js` leaves the site's `package.json` and the lockfile; `App.tsx` calls the freshness check on each route change and adds `api` to `KERNEL_SEGMENTS`.
- **Stale tabs.** `src/lib/freshness.ts`: `watchForNewBuild` returns `{ check, stop }`.
- **Kernel lists.** `platform/site/netlify` and `platform/site/src/lib/snapshot-keys.json` (which the kernel `source.ts` imports) join `platform/gate/kernel-paths.txt` and `KERNEL_PATHS` in `platform/dispatcher/src/worktree.ts`; the names `netlify` and `.netlify` join `platform/gate/kernel-names.txt` and `KERNEL_NAMES` at any depth; `site-kernel.test.ts` drops `@supabase/supabase-js` from the allowed packages.
- **Fixtures.** The shared studio fixture moves to `platform/site/e2e/studio-fixture.ts` (no Playwright import, so the unit tests read it too); `toDocuments(fixture)` in `platform/site/e2e/snapshot-documents.ts` turns it into the two documents; `e2e/fixtures.ts` serves `/api/live` and `/api/cards` from it and fails any request to the Supabase host.
- **Checks.** `live-check.mjs` reads the site's own `/api` responses; `anon-negative-test.ts` calls the two functions as anon.
- **Docs.** PLAN §6 (the public site reads cached documents from its own origin and opens no Realtime connection) and Appendix A (the functions, the RPCs, and a "Public site function budget" table that later pull requests add their rows to); `platform/site/DESIGN.md` (live figures run up to about three minutes behind); `docs/ROADMAP.md`; BOARD-SETUP: a "Pause when the board site is down" section and a budget note under "Netlify plan check"; a pointer from `docs/specs/stale-tab.md`; `scripts/rename.mjs` tiers for any new file that names the studio or its domain.

Out, and what each waits on:
- `/api/card/:id` and `/api/thanks`: supporter-pages. `/api/reports`: studio-reports.
- Purging the CDN copy on change: a later board card, if a lag of about three minutes proves too slow.
- A Netlify usage read in the quota job: Netlify's own usage notifications to the board are the alert (board item below).
- Moving the sites to Cloudflare Pages (F9) and materialised aggregates (F14): board work before Mid and Pop.
- The board site, which signs in and reads Supabase directly: unchanged.
- A service worker or offline support.

## Behaviour

**Two documents from the site's own origin.**
- `GET /api/live` returns `site_live()`, the figures that move:
  - `built_at`, `pool`, `totals`;
  - `studio`: the `public_studio` row (with money-logic's `pause_reason`);
  - `money`: the `public_money` row (money-logic), which carries `funding_order`; `stopped`: the newest 12 `public_stopped_cards` rows;
  - `cards`: a map from card id to every `cards` column that moves as a card travels (its stage, horizon, rank, builder `executor_role_id`, `funding_target_usd`, bar `funded_usd`, `live_at` and `updated_at`), its spend (`public_card_spend`) and the funding figures the pages read today (`public_card_funding`: contributors and credited_usd, null for a card no payment reached), over the listed set below;
  - `events`: the 20 newest `public_agent_events` rows, each with its card's title; `deploys`: the 10 newest.
- `GET /api/cards` returns `site_cards()`, the text that rarely moves:
  - `cards`: every column of `cards` anon may select, for the listed set;
  - `roles`: every `public_roles` row; `terms`: every `public_terms_versions` row (legal-copy).
- The listed set is every card on stage proposed, designing, voted, funded, building, gated or paused, plus the newest 200 live cards by `live_at` and the newest 50 rejected cards by `updated_at`. Each function returns one JSON value, so Max Rows does not truncate it. Older cards stay reachable at `/card/:id` (supporter-pages).

**Requests and caching.**
- `/api/live` 200: `Netlify-CDN-Cache-Control: public, durable, s-maxage=60, stale-while-revalidate=60` and `Cache-Control: public, max-age=0, must-revalidate`.
- `/api/cards` 200: the same with `s-maxage=300, stale-while-revalidate=300`.
- Every response is `application/json; charset=utf-8`. A request with any query string answers 400 with `no-store`, before any Supabase call, so a random query cannot reach the database. Any method but GET answers 405. A Supabase error or an 8-second timeout answers 502 with `no-store`.
- The function's config names its paths only (so a POST never falls through to the page rewrite) and sets Netlify's code-based rate limit: 300 requests a minute per IP and domain (each full page load reads both documents, so about 150 page loads a minute from one address). It is the first of the two rules legacy Free allows; supporter-pages takes the second.
- The function calls Supabase's RPC endpoint with the publishable key from `public-env.ts` and nothing else: no environment variable, no service-role key, no secret on the public site's host.

**The budget.** At most one `/api/live` build per 60-second window (43,200 a month) and one `/api/cards` build per 300 seconds (8,640), about 52,000 builds of the 125,000 invocations even if someone views the site every minute all month; deploy previews add a few hundred per pull request. Supabase egress is builds times document size, and the measured sizes go in Evidence (a 10 KB live document is under 0.5 GB a month; a 100 KB card document is under 0.9 GB). An answer the CDN does not keep (a 502 while Supabase fails, a 400, 405 or 404) costs an invocation each, and a failing Supabase one egress-free invocation per open tab's retry; Netlify's usage notifications are the alert for that case. The table in PLAN Appendix A holds these rows, and supporter-pages and studio-reports add theirs.

**The client.**
- It loads `/api/live` every 60 seconds, only while `document.visibilityState` is `visible`, and at once on a return to the tab. A hidden tab makes no request.
- It loads `/api/cards` on the first load (alongside `/api/live`), when the live map names a card it does not hold, and when its copy is more than 5 minutes old. A card in the card document but absent from the live map is not shown. Everything about a card that moves (the live map's keys above) comes from the live map, and only its words and fixed facts (title, summary, intent, source, shape, bucket, folder, drafter, creation) from the card document, so a card that ships or is dealt to now shows its new stage with its ship time, horizon, target and builder, never a mix of the two documents. Paused and rejected cards reach the pages through `stopped` only, as they do today; the documents carry them for later pages.
- A tab opened hidden loads nothing until it is first shown.
- It builds the same `Snapshot` the pages read today, so no page changes. It ignores keys it does not know, so a later migration can add keys before its site change merges. A missing required key or a wrong JSON type rejects the load; a null `money` or `stopped` marks that part missing, which keeps money-surfaces' "Not available right now" states. Every figure goes through `money()`; a rejected load leaves the page's last figures marked stale and never shows zero.
- A failed load is retried after 60 seconds, doubling to at most 10 minutes, and a success resets it. Each request aborts after 10 seconds.
- Figures and stages run up to about three minutes behind the database (60 seconds fresh, 60 stale while one revalidation runs, 60 until the next poll); card text up to about fifteen minutes, by the same arithmetic at 300 seconds.
- The public site holds no Supabase client and opens no WebSocket; its enforced `connect-src` is `'self'` alone. Every Fund this button and /contribute choice follows `money.funding_order` from `/api/live` (money-surfaces' rule), so the site has no open-for-funding rule of its own.
- The Terms and Refunds pages read posted versions from `/api/cards`' `terms` rows, with legal-copy's page states and time limit unchanged; legal-copy's posting procedure purges the public site's CDN cache right after a new version's row is inserted, so the page and `terms_version_at` switch together.
- `/assets/*` is immutable; `index.html`, `/version.json` and `/fonts/*` keep Netlify's default.

**Stale tabs.**
- `watchForNewBuild(deps)` returns `{ check, stop }`. It reads `/version.json` (`cache: 'no-store'`) on a back/forward restore, on a return to the tab, and on every in-app route change after the first render (`App.tsx` calls `check` from a `useLocation` effect). When the served sha differs from the page's stamp, it reloads, so the reader lands on the new route in the new build. Nothing reloads a page someone is reading without their navigating or returning.
- A tab reloads at most once per served sha: sessionStorage `pg:reloaded-for` holds that sha, so a CDN still serving the old `index.html` cannot cause a loop. A hidden tab, a page with no stamp, a failed read and blocked storage leave the page alone.

**What fails.**
- If the functions fail, pages show their existing unavailable or stale lines. Contribute, the Payment Link, `stripe-webhook` and the dispatcher do not use Netlify Functions, so money keeps moving.
- If the team reaches a legacy Free limit, Netlify pauses every site including the board site's Pause. BOARD-SETUP's "Pause when the board site is down" gives the path without Netlify: `launchctl bootout` for the dispatcher on the Mac, and one SQL statement for the Supabase dashboard's SQL editor with the same effect as `set_paused(true)`.

## Acceptance criteria

- [x] The site holds no open-for-funding rule of its own: `isOpenForFunding` and `takesMoney` are absent from `platform/site/src`, `canFund` is called only for sample and example cards, and on the e2e fixture every live Fund this button and /contribute choice follows `money.funding_order` served in `/api/live`.
- [x] `site_live()` and `site_cards()` are `security invoker` and `stable`, executable by anon and revoked from public; called as anon in the Deno migration test, each card object's keys equal the `cards` columns anon may select (from `information_schema.column_privileges`), so no withheld column appears; the migration applies twice.
- [x] On a test database holding 1,100 live cards and cards on every other stage, `site_cards()` holds every proposed, designing, voted, funded, building, gated and paused card, exactly the newest 200 live and the newest 50 rejected; `site_live().cards` covers the same ids; and both outputs have every key in `snapshot-keys.json` with its JSON type.
- [x] The function (unit tests with a mocked fetch, and on the deploy preview): `/api/live` and `/api/cards` send the CDN and browser headers above; any query string answers 400 `no-store` without calling Supabase; a POST answers 405; a Supabase error or timeout answers 502 `no-store`; the config names paths only and sets the 300-a-minute per-IP rate limit.
- [x] `platform/site/netlify` is in `kernel-paths.txt` and `KERNEL_PATHS` (parity test), the gate's kernel guard fails a card branch that touches it, and the function calls Supabase only with `public-env.ts`'s key (it starts `sb_publishable_`), reading no environment variable, with a URL equal to the board site's.
- [x] From the two documents the client builds a `Snapshot` equal to a golden captured from main's `createSupabaseSource` on the shared fixture before the old source was deleted; an unknown key is ignored, a null `money` or `stopped` is marked missing, a malformed document or figure rejects the load and a loaded page keeps its figures marked stale, never zero; the Terms and Refunds pages take their versions from `/api/cards`' `terms` and legal-copy's Legal tests pass unchanged.
- [x] With the tab hidden, no `/api` request is made over three minutes (e2e, `page.clock`); while visible `/api/live` is read every 60 seconds and `/api/cards` only on the first load, for an unknown card or when the held copy is over 5 minutes old; failures back off from 60 seconds, doubling to 10 minutes, and reset on success (unit tests).
- [x] No public page requests the Supabase host or opens a WebSocket, on any route, in the e2e run and in the live check; `@supabase/supabase-js` is absent from the site's `package.json` and its lockfile entry; the enforced `connect-src` is `'self'` alone in `netlify.toml` and in production.
- [x] `/assets/*` is served `public, max-age=31536000, immutable`, and `index.html`, `/version.json` and `/fonts/*` are not (`netlify-headers.test.ts` and production).
- [x] An in-app route change after the first render reads `/version.json` and reloads when the served sha differs; a tab reloads at most once per served sha across its reloads; a hidden tab makes no read; a failed read or blocked storage leaves the page alone (unit tests, and an e2e with a stale sha that reloads once, not twice).
- [x] Production:
  - before the merge: the dump is taken and named, the migration is applied, and `anon-negative-test.ts` (calling `site_live` and `site_cards` as anon and still refusing every private table and the money schema) and `ledger-identity.ts` PASS (done: Evidence, Production before the merge);
  - after the merge: a second `/api/live` read within 60 seconds is a CDN hit (`Cache-Status`), `/api/live?x=1` answers 400, one `/assets/*.js` is immutable, and the live check PASSes with no Supabase request or WebSocket from any page (done: Evidence, The gate, the merge and production after it).

## Verification

- `rm -rf platform/site/dist-e2e platform/board/dist-e2e && pnpm verify`
- `E2E_PORT=4391 pnpm --filter @backseat/site e2e` (includes `layout-balance.spec.ts` and `design.spec.ts` on every route, unchanged)
- `deno test --config platform/supabase/functions/deno.json --allow-read --allow-env platform/supabase/functions/_shared/site_snapshot_test.ts platform/supabase/functions/_shared/migration_test.ts` (the site-snapshot migration's own test file, as the series' other migrations have, and the migration list and function privileges in `migration_test.ts`)
- BOARD-SETUP's pause statement, run on a local database (PGlite, in `site_snapshot_test.ts`, which reads the statement from `docs/BOARD-SETUP.md`): quote `studio_state` before and after, next to `set_paused(true)`'s effect.
- On the deploy preview, only after production steps 1 to 3 (a preview's function calls production): `curl -s -D - -o /dev/null <preview>/api/live` twice within 60 seconds, then `/api/cards`, `/api/live?x=1`, `curl -X POST` on `/api/live`, and `curl -sI` on one `/assets/*.js`, quoting each status, `Cache-Status` and `Cache-Control`.
- Production, after the steps below:
  - `pnpm --filter @backseat/supabase exec tsx scripts/anon-negative-test.ts`;
  - `pnpm --filter @backseat/supabase exec tsx scripts/ledger-identity.ts`;
  - `set -a; . ./.env; set +a; node platform/site/scripts/live-check.mjs`.

## Production steps

The migration is additive. It must be live before the merge (Netlify deploys from main and the function calls `site_live()` at once) and before the deploy-preview checks.

1. Dump the database: `/opt/homebrew/opt/libpq/bin/pg_dump "$BACKUP_DB_URL" --format=custom --file ~/peanutgallery-dumps/pre-site-snapshot-<UTC>.dump`, then `chmod 600` the file. `BACKUP_DB_URL` comes from `.env` and is never printed.
2. Apply `20260924500000_site_snapshot.sql` through the Management API query endpoint (project `lyxndueoeisyqzewflpu`, `SUPABASE_ACCESS_TOKEN`), or `supabase db push` once money-safety's history repair has run (then `supabase migration repair --status applied <version>` if the endpoint was used). Every statement is `create or replace`, so a reviewer's change is re-applied the same way.
3. From the branch: `anon-negative-test.ts` PASS, `ledger-identity.ts` PASS, and `select public.ledger_identity()` quoted.
4. Run the deploy-preview checks.
5. Merge on a green gate at the head sha. Netlify deploys the site.
6. Against https://peanutgallery.games: the live check, `/api/live` twice and `/api/live?x=1`, `curl -sI` one `/assets/*.js`. Quote each.
7. Record the measured `/api/live` and `/api/cards` sizes, raw and gzipped, in Evidence.

Board items (listed, never blocking):
- Netlify plan check: the team stays on legacy Free; the budget assumes 125,000 invocations per site a month.
- Confirm that Netlify's usage notifications reach the board's address. They are the invocation alert.
- Optional: a separate free Netlify team for the board site, so an overrun on the public site cannot pause Pause.
- After an overrun, restoring the sites before the next cycle needs a payment method and a paid plan. That is the board's call.
- No Stripe, Console or spending step.

## Evidence

Built on `launch/site-snapshot` from `launch/agent-workflows` at c1cee2f (stacked on agent-workflows, which had not merged). The production lines of Verification, the deploy-preview curls and production steps 1 to 7 are the ship stage's and are not run here: criteria 4 (its preview half), 8 and 9 (their production halves) and 11 wait on them. The migration is not applied to production.

**The public reads earlier pull requests added, and where each now travels.** Every read `createSupabaseSource` made (main at c1cee2f) is in one of the two documents:

| Read on main | Added by | Now |
|---|---|---|
| `pool` (balance, reserve, incident reserve, held, daily spent, day) | week 1 | `/api/live` `pool` |
| `cards` (`CARD_COLUMNS`, horizon and rank, `drafter_role_id`), stages proposed to live, oldest first | week 1, backlog, agent-workflows | `/api/cards` `cards` (every column anon may select, for the listed set); stage, horizon, rank, `executor_role_id`, `funding_target_usd`, `funded_usd`, `live_at` and `updated_at` from `/api/live` `cards[id]` |
| `public_card_funding` (contributors, credited_usd) | live-cut, money-logic, agent-system-core | `/api/live` `cards[id]` |
| `public_card_spend` (spent_usd) | card-spend | `/api/live` `cards[id].spent_usd` |
| `public_studio` (`*`: launched_at, paused, platform_lane_open, pause_reason) | board-site, money-logic | `/api/live` `studio` |
| `public_ledger_totals` | week 1, money-fixes | `/api/live` `totals` |
| `public_agent_events` (newest 20), then `cards` id,title for their cards | week 1, agent-system-core | `/api/live` `events`, each with `card_title` |
| `deploys` (newest 10, no smoke output) | week 1 | `/api/live` `deploys` |
| `public_roles` (the site's columns; the view also carries agent_class, paused, paused_reason) | public-roles, agent-system-core | `/api/cards` `roles` (the whole row) |
| `public_money` (money-in, the books, `funding_order`) | money-logic, money-surfaces | `/api/live` `money` |
| `public_stopped_cards` (newest 12) | money-logic, money-surfaces, agent-system-core | `/api/live` `stopped` |
| `public_terms_versions` (the Terms pages' own read in `terms.ts`) | legal-copy | `/api/cards` `terms`, read by `terms.ts` from `/api/cards` |
| Realtime on `pool`, `cards`, `deploys` | week 1 | removed; the visible tab's minute read replaces it |

**The golden comparison.** `src/lib/__fixtures__/snapshot-golden.json` was written by main's `createSupabaseSource` over the shared studio fixture through a supabase-js client with a fixture fetch (commit f0e01d6, before `source.ts` changed); the new source builds the same Snapshot from `toDocuments(DEFAULT_STUDIO)`, and an unknown key in either document or a card row leaves it equal.

`rm -rf platform/site/dist-e2e platform/board/dist-e2e && npm_config_workspace_concurrency=1 pnpm verify` exits 0 (`EXIT 0`), one package at a time because other agents were loading the machine:

```
platform/board test:       Tests  86 passed (86)
platform/supabase test:       Tests  309 passed (309)
platform/site test:       Tests  431 passed (431)
seed-1 test:       Tests  77 passed (77)
platform/dispatcher test:       Tests  676 passed (676)
platform/gate test: PASS: gate tests passed=513
ok | 116 passed (159 steps) | 0 failed (36s)
GATE PASS folder=seed-1 lane=code
GATE PASS folder=platform lane=code
PASS: secret-scan files=590
EXIT 0
```

`deno test ... site_snapshot_test.ts` (criteria 2 and 3, and BOARD-SETUP's pause statement next to `set_paused(true)` on PGlite):

```
running 4 tests from ./platform/supabase/functions/_shared/site_snapshot_test.ts
site_live and site_cards are stable, security invoker, anon's and not public's, and apply twice ...
  the migration applies a second time ... ok
  each is language sql, stable, security invoker, with search_path public ... ok
  anon, authenticated and the service role may execute each; public may not ... ok
site_live and site_cards are stable, security invoker, anon's and not public's, and apply twice ... ok
site_cards returns only the cards columns anon may select, and both documents carry every key the site requires ...
  each card object's keys equal the anon-selectable cards columns ... ok
  every key in snapshot-keys.json is present with its JSON type ... ok
  the live map carries each card's stage, spend and funding figures; events carry their card's title ... ok
site_cards returns only the cards columns anon may select, and both documents carry every key the site requires ... ok
with 1,100 live cards and cards on every other stage, both documents hold exactly the listed set ...
  site_cards holds every open and paused card, the newest 200 live and the newest 50 rejected ... ok
  site_live's card map covers the same ids ... ok
  the live document holds the newest 20 events, the newest 10 deploys and at most 12 stopped cards ... ok
with 1,100 live cards and cards on every other stage, both documents hold exactly the listed set ... ok
BOARD-SETUP's pause statement does what set_paused(true) does, and the live document shows it ...
  set_paused(true) from the board site: paused, the board's reason, who and when ...
set_paused(true): before {"paused":false,"pause_reason":null,"paused_by":null,"paused_set":false} after {"paused":true,"pause_reason":"board","paused_by":"board@peanutgallery.games","paused_set":true}
  set_paused(true) from the board site: paused, the board's reason, who and when ... ok
  the SQL editor statement: the same pause and reason, with the SQL editor as who ...
BOARD-SETUP statement: before {"paused":false,"pause_reason":null,"paused_by":null,"paused_set":false} after {"paused":true,"pause_reason":"board","paused_by":"sql-editor","paused_set":true}
  the SQL editor statement: the same pause and reason, with the SQL editor as who ... ok
BOARD-SETUP's pause statement does what set_paused(true) does, and the live document shows it ... ok
ok | 4 passed (11 steps) | 0 failed
```

The site's unit tests for the function, the source, the poll and the stale-tab check (criteria 1, 4's unit half, 5, 6, 7 and 10):

```
✓ netlify/snapshot.test.ts > the snapshot function > answers /api/live from site_live with the publishable key, cached 60 seconds on the CDN and revalidated by the browser
✓ netlify/snapshot.test.ts > the snapshot function > answers /api/cards from site_cards, cached 300 seconds on the CDN
✓ netlify/snapshot.test.ts > the snapshot function > answers any query string 400 with no-store, before any Supabase call
✓ netlify/snapshot.test.ts > the snapshot function > answers any method but GET 405, before any Supabase call
✓ netlify/snapshot.test.ts > the snapshot function > answers 502 with no-store on a Supabase error, a timeout, a network failure or a body that is not a JSON object
✓ netlify/snapshot.test.ts > the snapshot function > gives up on Supabase after 8 seconds: the signal it passes aborts on its own
✓ netlify/snapshot.test.ts > the snapshot function > answers a path it does not serve 404
✓ netlify/snapshot.test.ts > the snapshot function > names its paths only, with no method, and sets the 60-a-minute rate limit per IP and domain
✓ netlify/snapshot.test.ts > the public values > holds the publishable key, never a secret, and the board site’s Supabase URL
✓ netlify/snapshot.test.ts > the public values > reads no environment variable in the function or its constants
✓ netlify/snapshot.test.ts > the functions folder > holds the snapshot function alone, since Netlify deploys every file there as a function
✓ src/lib/freshness.test.ts > loadedBuildSha and servedBuildSha > read the stamped build and the served build
✓ src/lib/freshness.test.ts > loadedBuildSha and servedBuildSha > give up quietly when the read fails, is not JSON or carries no sha
✓ src/lib/freshness.test.ts > reloadWhenStale > reloads a page running a build the site no longer serves, and notes the served build for the tab
✓ src/lib/freshness.test.ts > reloadWhenStale > leaves the page alone when storage is blocked or missing, and makes no read from a hidden tab
✓ src/lib/freshness.test.ts > reloadWhenStale > finds sessionStorage, or null when the browser blocks it
✓ src/lib/freshness.test.ts > reloadWhenStale > leaves the page alone when the build matches, is unstamped, unreadable or the tab is hidden
✓ src/lib/freshness.test.ts > watchForNewBuild > checks on a back/forward restore and on a return to the tab, reloads once, and stops when told
✓ src/lib/freshness.test.ts > watchForNewBuild on a route change > reads /version.json when check is called and reloads on a differing served build
✓ src/lib/freshness.test.ts > watchForNewBuild on a route change > reads and leaves the page alone when the served build matches
✓ src/lib/freshness.test.ts > watchForNewBuild on a route change > reloads a tab at most once per served build across its reloads, and again for a newer one
✓ src/lib/freshness.test.ts > watchForNewBuild on a route change > makes no read from a hidden tab, and leaves the page alone when storage is blocked
✓ src/lib/freshness.test.ts > watchForNewBuild on a route change > runs one read at a time
✓ src/lib/source.test.ts > the golden snapshot > equals the Snapshot main built from the same fixture through the Supabase client, captured before it was removed
✓ src/lib/source.test.ts > createSnapshotSource.load > reads both documents on the first load, then /api/live alone each minute
✓ src/lib/source.test.ts > createSnapshotSource.load > reads /api/cards again once its copy is over five minutes old
✓ src/lib/source.test.ts > createSnapshotSource.load > reads /api/cards again when the live map names a card it does not hold, and shows the card once it has it
✓ src/lib/source.test.ts > createSnapshotSource.load > does not show a card the card document holds but the live map does not
✓ src/lib/source.test.ts > createSnapshotSource.load > takes each card’s stage, bar and spend from the live map, which moves each minute
✓ src/lib/source.test.ts > createSnapshotSource.load > lists paused and rejected cards only through stopped, as the pages do today
✓ src/lib/source.test.ts > createSnapshotSource.load > ignores a key it does not know, in either document or a row
✓ src/lib/source.test.ts > createSnapshotSource.load > rejects a document missing a required key or holding one of the wrong JSON type
✓ src/lib/source.test.ts > createSnapshotSource.load > marks a null money or stopped missing and keeps everything else
✓ src/lib/source.test.ts > createSnapshotSource.load > rejects the load on a malformed figure, never showing zero
✓ src/lib/source.test.ts > createSnapshotSource.load > keeps the books’ order: funding_order is the waterfall’s, card by card
✓ src/lib/source.test.ts > createSnapshotSource.load > reads a card with no horizon as horizon now, keeps next and later, and reads the pause and the lane only when true
✓ src/lib/source.test.ts > createSnapshotSource.load > builds card titles for events from the live document
✓ src/lib/source.test.ts > createSnapshotSource.load > rejects when a document answers other than 200
✓ src/lib/source.test.ts > createSnapshotSource.load > aborts a request that never answers after its timeout, and rejects the load
✓ src/lib/source.test.ts > createSnapshotSource.load > names every enrichment the pages know, of which only money and stopped can now be missing
✓ src/lib/source.test.ts > createSnapshotSource.load > requires the keys snapshot-keys.json lists, which the Deno migration test checks against the SQL
✓ src/lib/source.test.ts > the site reads only its own origin > imports no Supabase client, names no Supabase host and opens no WebSocket
✓ src/lib/source.test.ts > the site reads only its own origin > holds no open-for-funding rule of its own: canFund only for sample and example cards
✓ src/lib/studio.test.tsx > useStudio > is unconfigured without a source
✓ src/lib/studio.test.tsx > useStudio > keeps the last snapshot when a later load fails
✓ src/lib/studio.test.tsx > useStudio > marks the kept snapshot stale after a failed refresh and clears it on the next successful load
✓ src/lib/studio.test.tsx > useStudio > reports the error when no snapshot has loaded yet
✓ src/lib/studio.test.tsx > useStudio > ignores an older load that resolves after a newer one
✓ src/lib/studio.test.tsx > useStudio > reads every 60 seconds while visible, counting from the end of each load
✓ src/lib/studio.test.tsx > useStudio > makes no load while the tab is hidden, and loads at once on a return
✓ src/lib/studio.test.tsx > useStudio > makes no load from a tab opened hidden until it is shown
✓ src/lib/studio.test.tsx > useStudio > retries a failed load after 60 seconds, doubling to 10 minutes, and a success resets the wait
✓ src/lib/studio.test.tsx > useStudio > stops loading after unmount
Tests  53 passed (53)
```

`E2E_PORT=4437 pnpm --filter @backseat/site e2e` (the whole suite on the new fixtures: `design.spec.ts` with axe, `layout-balance.spec.ts`, the money and legal specs unchanged; every test's page fixture also fails on any Supabase request or WebSocket):

```
✓ e2e/csp.spec.ts:29:1 › the preview sends the enforced policy from netlify.toml: frame-ancestors, connect-src to the site alone, and form-action
✓ e2e/money.spec.ts:225:3 › /ledger Stopped cards › lists a paused card under Paused and a rejected card under Didn't ship, with their reasons and money
✓ e2e/csp.spec.ts:36:1 › every route loads its data from the site's own /api under the policy with no report
✓ e2e/snapshot.spec.ts:37:1 › no route requests the Supabase host or opens a WebSocket, and every route reads its own /api
✓ e2e/snapshot.spec.ts:53:1 › a hidden tab makes no /api request over three minutes, and a return reads /api/live at once
✓ e2e/snapshot.spec.ts:67:1 › a tab opened hidden makes no /api request until it is shown
✓ e2e/snapshot.spec.ts:81:1 › a visible tab reads /api/live every 60 seconds and /api/cards only on the first load
✓ e2e/snapshot.spec.ts:94:1 › an in-app route change reads /version.json once and leaves a current tab alone
✓ e2e/snapshot.spec.ts:113:1 › a stale tab reloads once on a route change, not twice
✓ e2e/design.spec.ts:302:5 › accessibility (axe, WCAG 2.2 AA) › finds no violation on the guide and every page at 375px
✓ e2e/design.spec.ts:302:5 › accessibility (axe, WCAG 2.2 AA) › finds no violation on the guide and every page at 1440px
✓ e2e/design.spec.ts:315:3 › accessibility (axe, WCAG 2.2 AA) › finds no violation inside the signal plate and the ink band of the guide
5 skipped
134 passed (2.2m)
```

`BOARD_E2E_PORT=4438 pnpm --filter @backseat/board e2e`: `5 passed`. `bash platform/gate/test/run-tests.sh`: `PASS: gate tests passed=513` (a card branch touching `platform/site/netlify/functions/x.mts`, `snapshot.mts`, `lib/public-env.ts` or `snapshot-keys.json` fails the kernel guard).

The function through `netlify dev --offline` on a local build (production has no `site_live()` yet, so the reads answer 502, as the Risks say they do until the migration is applied):

```
== GET /api/live
HTTP/1.1 502 Bad Gateway
cache-control: no-store
content-type: application/json; charset=utf-8
netlify-cdn-cache-control: no-store
{"error":"The studio database did not answer"}
== GET /api/live?x=1
HTTP/1.1 400 Bad Request
cache-control: no-store
netlify-cdn-cache-control: no-store
{"error":"No query string is allowed"}
== POST /api/live
HTTP/1.1 405 Method Not Allowed
allow: GET
cache-control: no-store
{"error":"Only GET is allowed"}
Content-Security-Policy: frame-ancestors 'none'; connect-src 'self'; form-action 'self'
```

`netlify dev` serves static files with its own `cache-control: public, max-age=0`, so the `/assets/*` header is checked by `netlify-headers.test.ts` here and by the preview and production curls in the ship stage.

`node platform/site/scripts/live-check.mjs http://127.0.0.1:4443 --allow-no-data` against a local `vite preview` (no function, so the data checks skip):

```
PASS live-check http://127.0.0.1:4443 passed=197 failed=0 skipped=18
PASS 375px no page requests the Supabase host or opens a WebSocket
PASS 1440px no page requests the Supabase host or opens a WebSocket
SKIP /api: http://127.0.0.1:4443 has no snapshot function (answered 200 text/html)
SKIP /assets/index-C61B00pC.js Cache-Control no-cache: a local server does not send netlify.toml's asset headers
```

**Document sizes, estimated before production.** Production's public rows today (57 cards, 16 roles, 20 events, read with the publishable key through the old public reads and passed through `toDocuments`) make a live document of 15,607 bytes and a card document of 60,319 bytes, raw. The real card document carries all 34 anon columns, so it will be larger; the ship stage measures both, raw and gzipped, from production (step 7). At 15.6 KB the live document is about 0.7 GB a month at one build a minute.

**Screens.** `/`, `/ledger`, `/contribute` and `/terms` at 375 and 1440px on a local build with those production rows served as `/api/live` and `/api/cards`: every page renders as before, with no console error; `/terms` shows "Version 2, in force since 23 Sep 2026 at 17:34 Toronto time." from `/api/cards`' terms.

**Review fixes (at ad65e45).** `rm -rf platform/site/dist-e2e platform/board/dist-e2e && pnpm verify`: exit 0 (site `Tests  437 passed (437)`, dispatcher `Tests  677 passed (677)`, supabase `Tests  309 passed (309)`, board `Tests  86 passed (86)`, seed-1 `Tests  77 passed (77)`, functions `ok | 116 passed (160 steps) | 0 failed`, `PASS: gate tests passed=524`). `E2E_PORT=4431 pnpm --filter @backseat/site e2e`: `134 passed (2.3m)`, 5 skipped (the opt-in screenshots). New tests: `source.test.ts` (a card that shipped shows its live map ship time while the card document says building, and first among the shipped; a card dealt from next to now joins the fund group with its target; nothing that moves is read from the card document; a live map card missing a key or of the wrong type is rejected), `site_snapshot_test.ts` (`a card that ships or is dealt to now shows its new ship time, horizon, rank, target and builder in the live map, as site_cards has them ... ok`), `build-sha.test.ts` (an absolute `--outDir` gets `version.json`, and no copy of that path appears under the root), `worktree.test.ts` and `run-tests.sh` (`.netlify` and `netlify` at any depth fail the kernel guard; `seed-1/render/netlify.ts` and `.netlify.json` pass). The pages render the same Snapshot as before on the fixture (the golden test is unchanged), so no screenshots were retaken.

**Review fixes, rerun at 7b2c65a.** Each of the four review findings was confirmed (all four carry a real=true verdict) and each is fixed at ad65e45; `git ls-files platform/site/private` lists nothing, and no path under `origin/main...HEAD` names a scratchpad. `rm -rf platform/site/dist-e2e platform/board/dist-e2e && pnpm verify`: `EXIT 0`, with the same counts as above (site `Tests  437 passed (437)`, dispatcher `Tests  677 passed (677)`, functions `ok | 116 passed (160 steps) | 0 failed`, `PASS: gate tests passed=524`). `E2E_PORT=4431 pnpm --filter @backseat/site e2e`: `134 passed (2.2m)`, 5 skipped.

**After main moved and the minor findings (at 863400b).** The branch merged agent-workflows' last tip, 361c322, then main at c65e7cb (Decisions, 2026-09-24). `node scripts/rename.mjs --check`: `tier 1 carries the old name nowhere`. New tests: `source.test.ts` ("keeps a line's step and amount, which the pages turn into what the database did to a card"), `site_snapshot_test.ts` (`the live map carries each card's state; events carry their card's title, step and amount ... ok`, where a `ceiling_top_up` line reads back `["message","ceiling_top_up",2.5]`), `cards.test.ts` ("names no card when the first place in the order is a card the snapshot does not list yet, never a later one"), `Contribute.test.tsx` ("names no card, never a later one, while the first card in the order has not reached the page"), `LiveUpdates.test.tsx` ("reads No new updates, never Up to date, while the last refresh failed, and still shows a waiting count"), and `snapshot.test.ts` names the 300-a-minute rule.

`rm -rf platform/site/dist-e2e platform/board/dist-e2e && npm_config_workspace_concurrency=2 pnpm verify` at 863400b exits 0 (`EXIT 0`):

```
platform/board test:       Tests  94 passed (94)
platform/dispatcher test:       Tests  688 passed (688)
platform/site test:       Tests  459 passed (459)
platform/supabase test:       Tests  309 passed (309)
seed-1 test:       Tests  77 passed (77)
platform/gate test: PASS: gate tests passed=524
ok | 119 passed (173 steps) | 0 failed
GATE PASS folder=seed-1 lane=code
GATE PASS folder=platform lane=code
PASS: secret-scan files=602
tier 1 carries the old name nowhere
EXIT 0
```

`E2E_PORT=4431 pnpm --filter @backseat/site e2e` at 863400b: `165 passed`, `3 failed`, `5 skipped`. The three were main's "the Terms pages keep their layout while the versions read runs" at 375, 768 and 1440, which held a Supabase read the site no longer makes (`getByText('Loading the terms.')` never showed); it now holds `/api/cards`, and main's "every title holds still while the data loads", which passed without holding anything for the same reason, now holds `/api/**` (3f61d2e): `13 passed` and `3 passed (40.7s)` on their own. The whole suite again at 3f61d2e: `168 passed (3.1m)`, `5 skipped` (the opt-in screenshots). `BOARD_E2E_PORT=4432 pnpm --filter @backseat/board e2e`: `7 passed (4.0s)`.

### Production before the merge (24 September 2026, UTC)

1. `select paused, pause_reason, agent_mode, dispatcher_seen_at, cooling_window_minutes from public.studio_state` → `[{"paused":true,"pause_reason":"awaiting_credit","agent_mode":"attended","dispatcher_seen_at":"2026-09-16 04:19:38.678+00","cooling_window_minutes":0}]`; the cards read `[{"building":0,"live":6,"total":59}]`; `to_regprocedure('public.site_live()')` and `site_cards()` → null, so nothing of this migration was there; Terms at version 3.
2. The dump: `pg_dump "$BACKUP_DB_URL" -Fc` → `~/peanutgallery-dumps/pre-site-snapshot-20260924T045756Z.dump`, mode `-rw-------`, 748,938 bytes; `pg_restore --list` reads 77 TABLE DATA entries, `cards`, `contributions`, `contribution_allocations`, `ledger`, `pool`, `roles`, `studio_state` and `terms_versions` among them.
3. `20260924500000_site_snapshot.sql` at 427fe3e (sha256 4a40a27a…3ef2), wrapped in `begin; … commit;`, one request to the Management API query endpoint: `HTTP 201 []`. Read-backs: both functions `provolatile "s"`, `prosecdef false`, `proconfig ["search_path=public"]`, executable by anon, authenticated and the service role and not by public; called as anon, `site_cards()` holds 59 cards, 16 roles and 3 Terms rows and `site_live()`'s map 59 cards, 20 events and 6 deploys; `public.ledger_identity() ->> 'holds'` → `"true"`. `anon-negative-test.ts` → `PASS: anon access matches the RLS contract`, with `ok   rpc site_live (the site's document) … keys built_at,cards,deploys,events,money,pool,stopped,studio,totals` and `ok   rpc site_cards (the site's document) … keys cards,roles,terms`; `ledger-identity.ts` → `PASS: ledger identity holds over 1 contribution rows, 0 studio ledger rows, 1 allocations and 59 cards`.
4. The deploy-preview checks. Netlify built no deploy preview for this pull request, so a draft deploy of the branch's own build stood in: `vite build` at 04d7ae1 with netlify.toml's three public values, then `netlify deploy --dir <build> --functions netlify/functions` (a draft, never published; its function calls production, where step 3 had run):

   ```
   == GET /api/live (1)       HTTP/2 200  cache-control: public,max-age=0,must-revalidate  cache-status: "Netlify Durable"; hit; ttl=57  content-type: application/json; charset=utf-8  content-length: 27556
   == GET /api/live (2)       HTTP/2 200  cache-status: "Netlify Durable"; hit; ttl=55
   == GET /api/cards          HTTP/2 200  cache-control: public,max-age=0,must-revalidate  cache-status: "Netlify Durable"; hit; ttl=295  content-length: 95795
   == GET /api/live?x=1       HTTP/2 400  cache-control: no-store  cache-status: "Netlify Durable"; fwd=bypass  {"error":"No query string is allowed"}
   == POST /api/live          HTTP/2 405  allow: GET  cache-control: no-store
   == HEAD /assets/index-BGg-pLCO.js  HTTP/2 200  cache-control: public,max-age=31536000,immutable
   == HEAD /version.json      HTTP/2 200  cache-control: public,max-age=0,must-revalidate
   connect-src 'self'
   ```

   The live check against that draft failed 11 lines, every one a 429 from the function's rate limit (`/api/live 429 : missing or wrong not JSON`): at 60 a minute per address the check's own page loads (two documents each) and reads passed the limit, as a school or an office behind one address would. The limit became 300 a minute and the check reads each document once (Decisions); against a second draft at 863400b's function, `node platform/site/scripts/live-check.mjs https://6ab4aed4d4ea3aa5a85bcb9a--peanutgallerygames.netlify.app` → `PASS live-check https://6ab4aed4d4ea3aa5a85bcb9a--peanutgallerygames.netlify.app passed=242 failed=0 skipped=2` (the two skips: og:image names production, and the www redirect runs only there), with `PASS /api/live read again within 60 seconds: 200 Cache-Status "Netlify Edge"; hit; ttl=29` and `PASS /api/live?x=1 400 Cache-Control no-store`. Home and /contribute from that draft at 375 and 1440 were looked at: production's six open cards, "Pause updates" beside "Up to date", no horizontal overflow.
7. The sizes, from production's rows (59 cards, 16 roles, 3 Terms versions): `/api/live` 27,556 bytes raw and 4,137 gzipped; `/api/cards` 95,795 raw and 19,989 gzipped. At one build a minute and one every five minutes that is at most about 1.2 GB and 0.8 GB a month raw (about 0.2 GB each gzipped), against Supabase's free 5 GB.

### The gate, the merge and production after it (24 September 2026, UTC)

5. The gate at the head sha, on the board's Mac (`scripts/local-gate.sh`, PLAN.md §10 decision 44): `LOCAL GATE PASS pr=80 head=57a06a7578b499b45ae3214a119695efaeffc8aa base=c65e7cb2eaa99a5ad487c8f6fddb5488f1ac72af merge=078401dc56bacd28ad5b42669fe27695753be40a seed=true platform=true lane=code site=true functions=true log=/Users/kylesmith/peanutgallery-launch/gate-logs/pr80-57a06a7.log`. The log shows site e2e `168 passed (3.1m)` with 5 skipped, board e2e `7 passed (3.9s)`, functions `ok | 119 passed (173 steps) | 0 failed`, gate tests 524, GATE PASS for the build and the bot, and the commit status `local-gate success`.
   The merge: #82 (supporter-pages, based on this branch) was retargeted to main first (`gh pr edit 82 --base main` → `main OPEN`); origin/main was c65e7cb, the PASS line's base; `gh pr merge 80 --squash --match-head-commit 57a06a7…` with the PASS line in the body → `MERGED 86463fe4fbfaf32a36b23d2ba410376948417efa 2026-09-24T05:25:48Z`; the remote branch is deleted.
6. After the merge: 86463fe is ready on the public site (70df3957, 05:26:33Z) and the board's (51051b5b, 05:26:52Z), and the live page's build sha reads 86463fe4fbfaf32a36b23d2ba410376948417efa. Against https://peanutgallery.games:

   ```
   == GET /api/live (1)       HTTP/2 200  cache-control: public,max-age=0,must-revalidate  cache-status: "Netlify Durable"; fwd=uri-miss; stored  content-type: application/json; charset=utf-8
   == GET /api/live (2)       HTTP/2 200  cache-status: "Netlify Durable"; hit; ttl=57  content-length: 27556
   == GET /api/cards          HTTP/2 200  cache-control: public,max-age=0,must-revalidate  cache-status: "Netlify Durable"; fwd=uri-miss; stored
   == GET /api/live?x=1       HTTP/2 400  cache-control: no-store  cache-status: "Netlify Durable"; fwd=bypass
   == POST /api/live          HTTP/2 405  allow: GET  cache-control: no-store
   == HEAD /assets/index-BGg-pLCO.js  HTTP/2 200  cache-control: public,max-age=31536000,immutable
   == HEAD /version.json      HTTP/2 200  cache-control: public,max-age=0,must-revalidate
   connect-src 'self'
   ```

   `node platform/site/scripts/live-check.mjs` → `PASS live-check https://peanutgallery.games passed=244 failed=0 skipped=0`, with `PASS 375px no page requests the Supabase host or opens a WebSocket`, the same at 1440px, `PASS /api/live read again within 60 seconds: 200 Cache-Status "Netlify Edge"; hit; ttl=25`, `PASS /api/live?x=1 400 Cache-Control no-store` and `PASS /assets/index-BGg-pLCO.js Cache-Control: public,max-age=31536000,immutable`. `anon-negative-test.ts` → `PASS: anon access matches the RLS contract` and `ledger-identity.ts` → `PASS: ledger identity holds over 1 contribution rows, 0 studio ledger rows, 1 allocations and 59 cards`, again after the merge. Live screenshots of home, /contribute, /ledger and /terms at 375 and 1440 were looked at: no horizontal overflow, "Pause updates" beside "Up to date", "Next in line: Stop the unlock count from showing more unlocks than exist" first on /contribute, and "Version 3, in force since 23 Sep 2026 at 23:10 Toronto time." on /terms from `/api/cards`.
   legal-copy's new purge step, tried on production: `netlify api purgeCache --data '{"site_id":…}'` answered `JSONHTTPError: Bad Request`, so the procedure now puts the id in the body; `netlify api purgeCache --data '{"body":{"site_id":…}}'` answered `""`, and the next `/api/live` read carried `built_at` 05:30:01, two seconds after the purge, where the copy before it was built at 05:29:37 (`cache-status: "Netlify Durable"; fwd=stale; ttl=36; stored`).
7. The sizes after the merge are those measured before it (Production before the merge, 7): `/api/live` 27,556 bytes raw and 4,137 gzipped; `/api/cards` 95,795 raw and 19,989 gzipped.

No function deploy, seed or backlog step belongs to this pull request, and the dispatcher's kernel-name change reaches the Mac when it is installed (BOARD-SETUP step 3), since none runs yet. Every Verification line is now run and quoted: `pnpm verify`, both e2e runs, the Deno migration test and the pause statement on PGlite above; the deploy-preview curls on the draft deploy; and production (both scripts' PASS lines and the live check).

## Decisions

- 2026-09-23, Trimmed (board: "better to be simple and delete than add more convoluted bespoke"; good normal modern standards): 29 criteria became 11. Cut: the content-addressed card document (`site_cards_body`, `site_cards_version`, the md5 `v` parameter, the 409 retry, `Netlify-Vary: query=v`, the total-order and md5-stability tests), replaced by two plain CDN-cached documents at 60 and 300 seconds; `card_open_for_funding` and the live map's `open` flag, because money-surfaces (trimmed) already has every Fund button follow `money.funding_order`, so a second SQL wrapper and flag add nothing; the document `v` field; the 15-second return rule; the 60-second version poll and its pending-reload state (a route change and a return to the tab are enough); the quota job's Netlify invocation read, hourly schedule and ops tests (Netlify's own usage notifications alert the board, and no read-only endpoint was confirmed); the bundle-size comparison; the functions-import-only-lib test and split helper modules; the kernel `scripts/snapshot-documents.mjs` (design-review no longer has a gate render, so `toDocuments` lives in the site's e2e folder); the per-PR frame review and attended reviewer session (the site e2e suite with `layout-balance.spec.ts` and `design.spec.ts` covers it); the dependency on layout-balance's gate module (that pull request is dropped) and on the operations bucket (removed; the live document carries whatever `public_money` holds and names no operations field). Kept whole: every Problem outcome, anon-only reads, the kernel path, the dump before the production write, `anon-negative-test` and `ledger-identity`.
- 2026-09-23: one SQL function per document, `security invoker`: one round trip, one consistent read, and anon's own grants and RLS apply, so it cannot return anything anon could not already read.
- 2026-09-23: the function uses the publishable key from a kernel constants module, never the service role or an environment variable; no secret lives on the public site's host.
- 2026-09-23: figures and stages travel in the small live document every minute; card text in a second document cached five minutes, so a busy studio does not re-send every title each minute and Supabase egress stays bounded by construction.
- 2026-09-23: any query string answers 400 before Supabase, because Netlify puts every query parameter in the cache key by default.
- 2026-09-23: no purge on change in v1: a lag of about three minutes is acceptable while cards take minutes to hours, and a purge would add a Netlify write to the ship path.
- 2026-09-23: the public site keeps no Supabase client, so its enforced `connect-src` becomes `'self'` and card-built script on the site cannot reach the database.
- 2026-09-23: the live document carries `public_money` and `public_stopped_cards`, because "Failures are public" (R14, L02, L04) needs a data path once the site reads only these documents; legal-copy's Terms pages read `public_terms_versions` from the card document for the same reason, superseding legal-copy's separate read.
- 2026-09-23: a stale tab reloads only when the reader navigates or returns, and at most once per served sha, because nothing moves under the viewer.
- 2026-09-23: the legal pages stay inside the one `StudioProvider`: their reads are CDN hits, and the header shows the paused notice on every page.
- 2026-09-23, reconciled with the series: this migration creates no `public_reconciliation` view and does not touch `public_studio`. supporter-pages recreates `site_live` and `site_cards` with its keys, and copy-pass recreates `site_cards` with `board_work`; the client ignores added keys. studio-reports counts open cards from `money.funding_order()` or `money.card_takes_money` inside its own security definer function.
- 2026-09-23, at build: the live map carries each card's `funded_usd` beside its stage, spend and funding figures. The bar moves with every payment; from the card document it would lag up to about fifteen minutes.
- 2026-09-23, at build: paused and rejected cards stay out of the Snapshot's `cards`, as they are today: the home page's fund group and the roadmap would otherwise list them. They reach the pages through `stopped`, and both documents carry them for supporter-pages' card page.
- 2026-09-23, at build: the function's unit tests sit in `platform/site/netlify/snapshot.test.ts`, beside `functions/` rather than in it: `netlify dev` showed Netlify loads every file in that folder as a function ("Loaded function snapshot.test"). A test pins the folder to `snapshot.mts` alone.
- 2026-09-23, at build: the migration's PGlite checks are their own file, `site_snapshot_test.ts`, as the series' other migrations have; `migration_test.ts` gains the file in its order list and `site_live` and `site_cards` in its function privileges (anon may run them; they are security invoker).
- 2026-09-23, at build: the listed-set CTE is written in both functions rather than as a third anon-callable function; a static test keeps the two copies identical.
- 2026-09-23, at build: `terms.ts`'s default loader reads `/api/cards` itself (a CDN hit, once per visit) and keeps the `TermsLoader` context, so `Legal.test.tsx` and legal-copy's page states and 5-second limit are unchanged.
- 2026-09-23, at build: a tab opened hidden loads nothing until it is first shown ("a hidden tab makes no request"); the first load reads both documents at once.
- 2026-09-23, at build: `snapshot-keys.json` is kernel, since the kernel `source.ts` imports it.
- 2026-09-23, at build: the shared studio fixture moves to `e2e/studio-fixture.ts`, free of Playwright, so the unit tests read the same fixture the e2e run serves; `toDocuments` lists the fixture's stopped cards as cards, as the database does.
- 2026-09-23, at build: BOARD-SETUP's pause statement names `sql-editor` as who paused, since the SQL editor has no signed-in email and the repository names no personal address; `site_snapshot_test.ts` reads the statement from `docs/BOARD-SETUP.md` and checks it against `set_paused(true)`.
- 2026-09-23, at build: `/how-it-works` still picks its example card with `canFund`, as money-surfaces left it: it draws an example with no link or button. The source test pins `canFund`'s callers to that and `Funding.tsx`'s sample mode.
- 2026-09-23, at build: `live-check.mjs --allow-no-data` treats a local preview's `/api` 404s and the landing's data-dependent headings as missing data; without the flag, as in production, each still fails.
- 2026-09-23, at review: every field of a card that must agree travels in one document. The live map carries every `cards` column that moves as a card travels (stage, horizon, rank, `executor_role_id`, `funding_target_usd`, `funded_usd`, `live_at`, `updated_at`) beside its spend and funding figures, and `snapshot-keys.json`'s `live_card` requires each with its JSON type; the card document supplies only a card's words and fixed facts. Before, a card that shipped showed live with no `live_at` (and the old `updated_at`) for up to about fifteen minutes, and a card dealt to now kept horizon next while `money.funding_order` in the live document already listed it. The cost is six keys per listed card: on the e2e live fixture (17 cards) the live document grows from 10,314 to 12,609 bytes raw (1,304 to 1,483 gzipped), about 135 bytes a card raw, so each 100 listed cards add about 0.6 GB a month raw at one build a minute (production's ids and times are longer than the fixture's; the ship stage's step 7 measures the real sizes). Purging the card document on change or re-reading it on a stage change would not help, since the CDN would answer with the same stale copy. A Deno step checks both documents agree on every moving column after a ship and after a deal to now.
- 2026-09-23, at review: `netlify` and `.netlify` are kernel names at any depth, not just `platform/site/netlify` as a path: Netlify deploys functions and edge functions from a site's `netlify/` by default and from `.netlify/functions-internal` and `.netlify/edge-functions` on every build, whatever `.gitignore` says, so a card that un-ignores `.netlify` must still fail the kernel guard. `.gitignore` stays out of the kernel: the guard reads names, not ignore rules.
- 2026-09-23, at review: `writeVersionFile` resolves the build's `outDir` with `path.resolve`, as Vite does, so a build given an absolute `--outDir` writes `version.json` beside the build and never into the repository; `platform/site/.gitignore` ignores `/private/`, and the two `version.json` files an earlier build left under `platform/site/private/` are removed.
- 2026-09-24, after main moved to c65e7cb (agent-system-core and agent-workflows squashed, the rename and the local gate): the branch merged agent-workflows' last tip (361c322, whose tree c65e7cb equals) and then main. The public snapshot becomes PLAN §10 decision 47, after main's 43 to 46; the migration keeps its `20260924500000` stamp, which sorts before the rename's `20260925000000_terms_version_3.sql` in the migration list, as agent-workflows' did (both are applied through the Management API, which runs a file whatever its order). agent-system-core added `step` and `usd` to `public_agent_events`, so the pages say a card was dealt, topped up or resumed by rule; `site_live()`'s events now carry both, and the source keeps them only when set, as the old select did. agent-workflows changed the fixture roles' descriptions, which the golden passes through unchanged, so the golden takes the new words.
- 2026-09-24, the review's minor findings, each fixed here or placed:
  - Fund the next card in line names the first place in `money.funding_order` only. When that card is not in the snapshot yet (its words come with `/api/cards`, which can lag the order by minutes), /contribute says the plain line naming no card rather than naming the second card, and the live check allows that line only while the order's first card is missing from `/api/cards`.
  - A bar's target and a card's horizon already travel in the live map with its funded amount (the review fix at ad65e45), so a card dealt to now shows its new target at once.
  - The Terms pages read the posted versions from `/api/cards`. legal-copy's posting procedure now purges the public site's CDN cache straight after inserting the version's row, so /terms and `terms_version_at` switch together, not up to ten minutes apart.
  - /team's "n cards shipped" counts the live cards in the listed set, which holds the newest 200. supporter-pages, next in the series, replaces that count with `public_role_stats.shipped_cards` over every live card; production holds 59 cards in all, so the cap cannot bind before then.
  - The copied build files under `platform/site/private/` were removed at ad65e45, and `private/` is ignored.
  - BOARD-SETUP's budget note says the 52,000 is document builds, and that answers the CDN does not keep (a 502 while Supabase fails, a 400, 405 or 404) each cost an invocation, with the usage notifications as the alert; the Budget paragraph above says the same.
  - `.env.example` puts `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` under the board site's build values, since the public site reads neither.
  - No "live" wording sits near a figure (DESIGN.md, How fresh the figures are): "Loading the figures.", "Figures are not available yet.", "Pause updates" and "Updates are paused." replace the live wording in `legal.ts`, `copy.ts` and DESIGN.md.
  - While the last refresh failed, home's quiet updates button reads "No new updates" under "Could not refresh. These figures may be out of date.", never "Up to date"; main already hides the row when no snapshot loaded.
- 2026-09-24, at ship: the function's rate limit is 300 requests a minute per address and domain, not 60. The draft deploy's live check drew 429s at 60, since every full page load reads both documents (the Terms pages a third time), so the check, or a school or an office behind one address, passes 60 within a minute. Cached answers cost no invocation, so the rule only has to stop a runaway loop; at either number one determined address could spend the month's invocations within days, so Netlify's usage notifications stay the alert. The live check reads each document once per run.
- 2026-09-24, at ship: Netlify built no deploy preview for this pull request, so the preview checks ran on a draft deploy of the branch's build (`netlify deploy` with the functions folder, never published), whose function reads production after step 3.
- 2026-09-24, after the merge: legal-copy's purge step names the Netlify CLI's working form, with the site id in the request body; the form first written answered 400 when tried on production.
