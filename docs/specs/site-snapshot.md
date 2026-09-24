# F1: the public snapshot from the site's own origin, and stale tabs reload on navigation

Status: built. Card: none. Owner: board.

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
- **Kernel lists.** `platform/site/netlify` and `platform/site/src/lib/snapshot-keys.json` (which the kernel `source.ts` imports) join `platform/gate/kernel-paths.txt` and `KERNEL_PATHS` in `platform/dispatcher/src/worktree.ts`; `site-kernel.test.ts` drops `@supabase/supabase-js` from the allowed packages.
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
  - `cards`: a map from card id to its stage, its bar (`funded_usd`), its spend (`public_card_spend`) and the funding figures the pages read today (`public_card_funding`: contributors and credited_usd, null for a card no payment reached), over the listed set below;
  - `events`: the 20 newest `public_agent_events` rows, each with its card's title; `deploys`: the 10 newest.
- `GET /api/cards` returns `site_cards()`, the text that rarely moves:
  - `cards`: every column of `cards` anon may select, for the listed set;
  - `roles`: every `public_roles` row; `terms`: every `public_terms_versions` row (legal-copy).
- The listed set is every card on stage proposed, designing, voted, funded, building, gated or paused, plus the newest 200 live cards by `live_at` and the newest 50 rejected cards by `updated_at`. Each function returns one JSON value, so Max Rows does not truncate it. Older cards stay reachable at `/card/:id` (supporter-pages).

**Requests and caching.**
- `/api/live` 200: `Netlify-CDN-Cache-Control: public, durable, s-maxage=60, stale-while-revalidate=60` and `Cache-Control: public, max-age=0, must-revalidate`.
- `/api/cards` 200: the same with `s-maxage=300, stale-while-revalidate=300`.
- Every response is `application/json; charset=utf-8`. A request with any query string answers 400 with `no-store`, before any Supabase call, so a random query cannot reach the database. Any method but GET answers 405. A Supabase error or an 8-second timeout answers 502 with `no-store`.
- The function's config names its paths only (so a POST never falls through to the page rewrite) and sets Netlify's code-based rate limit: 60 requests a minute per IP and domain. It is the first of the two rules legacy Free allows; supporter-pages takes the second.
- The function calls Supabase's RPC endpoint with the publishable key from `public-env.ts` and nothing else: no environment variable, no service-role key, no secret on the public site's host.

**The budget.** At most one `/api/live` build per 60-second window (43,200 a month) and one `/api/cards` build per 300 seconds (8,640), about 52,000 of the 125,000 invocations even if someone views the site every minute all month; deploy previews add a few hundred per pull request. Supabase egress is builds times document size, and the measured sizes go in Evidence (a 10 KB live document is under 0.5 GB a month; a 100 KB card document is under 0.9 GB). A bad request costs an invocation but no egress. The table in PLAN Appendix A holds these rows, and supporter-pages and studio-reports add theirs.

**The client.**
- It loads `/api/live` every 60 seconds, only while `document.visibilityState` is `visible`, and at once on a return to the tab. A hidden tab makes no request.
- It loads `/api/cards` on the first load (alongside `/api/live`), when the live map names a card it does not hold, and when its copy is more than 5 minutes old. A card in the card document but absent from the live map is not shown, and a card's stage, bar and spend come from the live map. Paused and rejected cards reach the pages through `stopped` only, as they do today; the documents carry them for later pages.
- A tab opened hidden loads nothing until it is first shown.
- It builds the same `Snapshot` the pages read today, so no page changes. It ignores keys it does not know, so a later migration can add keys before its site change merges. A missing required key or a wrong JSON type rejects the load; a null `money` or `stopped` marks that part missing, which keeps money-surfaces' "Not available right now" states. Every figure goes through `money()`; a rejected load leaves the page's last figures marked stale and never shows zero.
- A failed load is retried after 60 seconds, doubling to at most 10 minutes, and a success resets it. Each request aborts after 10 seconds.
- Figures and stages run up to about three minutes behind the database (60 seconds fresh, 60 stale while one revalidation runs, 60 until the next poll); card text up to about fifteen minutes, by the same arithmetic at 300 seconds.
- The public site holds no Supabase client and opens no WebSocket; its enforced `connect-src` is `'self'` alone. Every Fund this button and /contribute choice follows `money.funding_order` from `/api/live` (money-surfaces' rule), so the site has no open-for-funding rule of its own.
- The Terms and Refunds pages read posted versions from `/api/cards`' `terms` rows, with legal-copy's page states and time limit unchanged.
- `/assets/*` is immutable; `index.html`, `/version.json` and `/fonts/*` keep Netlify's default.

**Stale tabs.**
- `watchForNewBuild(deps)` returns `{ check, stop }`. It reads `/version.json` (`cache: 'no-store'`) on a back/forward restore, on a return to the tab, and on every in-app route change after the first render (`App.tsx` calls `check` from a `useLocation` effect). When the served sha differs from the page's stamp, it reloads, so the reader lands on the new route in the new build. Nothing reloads a page someone is reading without their navigating or returning.
- A tab reloads at most once per served sha: sessionStorage `pg:reloaded-for` holds that sha, so a CDN still serving the old `index.html` cannot cause a loop. A hidden tab, a page with no stamp, a failed read and blocked storage leave the page alone.

**What fails.**
- If the functions fail, pages show their existing unavailable or stale lines. Contribute, the Payment Link, `stripe-webhook` and the dispatcher do not use Netlify Functions, so money keeps moving.
- If the team reaches a legacy Free limit, Netlify pauses every site including the board site's Pause. BOARD-SETUP's "Pause when the board site is down" gives the path without Netlify: `launchctl bootout` for the dispatcher on the Mac, and one SQL statement for the Supabase dashboard's SQL editor with the same effect as `set_paused(true)`.

## Acceptance criteria

- [ ] The site holds no open-for-funding rule of its own: `isOpenForFunding` and `takesMoney` are absent from `platform/site/src`, `canFund` is called only for sample and example cards, and on the e2e fixture every live Fund this button and /contribute choice follows `money.funding_order` served in `/api/live`.
- [ ] `site_live()` and `site_cards()` are `security invoker` and `stable`, executable by anon and revoked from public; called as anon in the Deno migration test, each card object's keys equal the `cards` columns anon may select (from `information_schema.column_privileges`), so no withheld column appears; the migration applies twice.
- [ ] On a test database holding 1,100 live cards and cards on every other stage, `site_cards()` holds every proposed, designing, voted, funded, building, gated and paused card, exactly the newest 200 live and the newest 50 rejected; `site_live().cards` covers the same ids; and both outputs have every key in `snapshot-keys.json` with its JSON type.
- [ ] The function (unit tests with a mocked fetch, and on the deploy preview): `/api/live` and `/api/cards` send the CDN and browser headers above; any query string answers 400 `no-store` without calling Supabase; a POST answers 405; a Supabase error or timeout answers 502 `no-store`; the config names paths only and sets the 60-a-minute per-IP rate limit.
- [ ] `platform/site/netlify` is in `kernel-paths.txt` and `KERNEL_PATHS` (parity test), the gate's kernel guard fails a card branch that touches it, and the function calls Supabase only with `public-env.ts`'s key (it starts `sb_publishable_`), reading no environment variable, with a URL equal to the board site's.
- [ ] From the two documents the client builds a `Snapshot` equal to a golden captured from main's `createSupabaseSource` on the shared fixture before the old source was deleted; an unknown key is ignored, a null `money` or `stopped` is marked missing, a malformed document or figure rejects the load and a loaded page keeps its figures marked stale, never zero; the Terms and Refunds pages take their versions from `/api/cards`' `terms` and legal-copy's Legal tests pass unchanged.
- [ ] With the tab hidden, no `/api` request is made over three minutes (e2e, `page.clock`); while visible `/api/live` is read every 60 seconds and `/api/cards` only on the first load, for an unknown card or when the held copy is over 5 minutes old; failures back off from 60 seconds, doubling to 10 minutes, and reset on success (unit tests).
- [ ] No public page requests the Supabase host or opens a WebSocket, on any route, in the e2e run and in the live check; `@supabase/supabase-js` is absent from the site's `package.json` and its lockfile entry; the enforced `connect-src` is `'self'` alone in `netlify.toml` and in production.
- [ ] `/assets/*` is served `public, max-age=31536000, immutable`, and `index.html`, `/version.json` and `/fonts/*` are not (`netlify-headers.test.ts` and production).
- [ ] An in-app route change after the first render reads `/version.json` and reloads when the served sha differs; a tab reloads at most once per served sha across its reloads; a hidden tab makes no read; a failed read or blocked storage leaves the page alone (unit tests, and an e2e with a stale sha that reloads once, not twice).
- [ ] Production:
  - before the merge: the dump is taken and named, the migration is applied, and `anon-negative-test.ts` (calling `site_live` and `site_cards` as anon and still refusing every private table and the money schema) and `ledger-identity.ts` PASS (waits on: production steps 1 to 3);
  - after the merge: a second `/api/live` read within 60 seconds is a CDN hit (`Cache-Status`), `/api/live?x=1` answers 400, one `/assets/*.js` is immutable, and the live check PASSes with no Supabase request or WebSocket from any page (waits on: production steps 5 and 6).

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

Added when the status moves to built: the public reads earlier pull requests added to `source.ts` and where each now travels; the golden comparison; the preview curls; the measured document sizes; the production outputs.

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
