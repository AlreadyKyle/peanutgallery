# Reason to come back: the weekly report, Discord posts and the card supply floor

Status: built. Card: none. Owner: board.

Series position: after grid-boxes, before design-review (the order is in `docs/ROADMAP.md`, "The launch series"). The layout-balance pull request is dropped: home (#64) ships `platform/site/e2e/layout-balance.spec.ts`, which this change only extends. It is the launch plan's Phase 2 "Reason to come back" (PG-13, L19) and "Card supply" (PG-10) lines. It is a board pull request: it changes kernel files (the dispatcher, the ops env tools, Supabase, the board site and the site's kernel files). Drafting the launch cards that fill the floor is `docs/specs/launch-card-floor.md`.

## Problem

- Nothing brings a supporter back. There is no weekly report, and nothing tells anyone that a card shipped. The backlog's "The Monday report" and "Discord bot" are unbuilt, and the board's Discord webhooks (BOARD-SETUP "Discord webhooks") have no code to use them.
- Nothing keeps enough cards open to fund.
  - On 23 September 2026, production had six open cards. All were goal cards, with targets of $0.50 to $1.50, and none was large enough to pool many contributions (PG-10).
  - No rule says how many cards should be open, and nothing starts drafting when the supply runs low.

## Scope

In:
- **SQL.** Migration `20260925100000_reports_supply.sql` (the series' stamp, straight after main's `20260925000000_terms_version_3.sql`):
  - `studio_reports` (RLS on, no API grants) and `site_reports()`, the one public read;
  - `publish_weekly_report(week_start)`, run hourly by a pg_cron job `weekly-report`;
  - `outbound_posts` (RLS on, no API grants), the Discord outbox;
  - the floor columns on `studio_state` and `card_supply()`.
- **Dispatcher.** `src/discord.ts` (the poster), `src/outbound.ts` (ship and weekly posts, run by the tick), and `src/config.ts`'s `DISCORD_WEBHOOK_SHIPS`, `DISCORD_WEBHOOK_WEEKLY` and `PUBLIC_SITE_URL`.
- **Ops.** `platform/ops/dispatcher-env.mjs` copies and checks the two Discord keys; `provision.sh`'s `check_env_lines`, which `install.sh` runs on the Mac, checks them; `.env.example` lists them; `after-restore.sql` schedules `weekly-report` for a restored copy.
- **Site.** `/reports` (card-lane `pages/Reports.tsx`, with kernel `components/ReportFacts.tsx` and kernel `lib/reports-source.ts`, both added to `kernel-paths.txt` and `KERNEL_PATHS`); `GET /api/reports` in site-snapshot's function; a "Weekly reports" link in the footer (kernel `App.tsx`).
- **Board site.** The supply line, a "Card supply is short" item in Needs you, and "Draft to the floor".
- **Docs.** BACKLOG ("The Monday report" removed as built; "Discord bot" narrowed to the inbound parts); PLAN §4, §6 and Appendix A's `/api/reports` budget line; `docs/SYSTEM.md`'s outbound lane; BOARD-SETUP "Discord webhooks" (built, inert until set); COPY.md's post templates; ROADMAP; the rename script's tiers for the new files; this spec.

Out, and what each waits on:
- Setting the webhook addresses: a board item (BOARD-SETUP "Discord webhooks"). Until then no request is made and nothing is posted.
- Drafting the launch cards that fill the floor: `launch-card-floor.md`.
- Automatic drafting when the supply is short, AI-written notes on the report (the Studio Head's and the Head of Finance's), the Head of Finance's note on /ledger and its run on a failed reconcile: each needs scheduled, unattended role jobs, which need an operations percentage. The operations bucket is removed until one exists (money-logic); agent-workflows lists scheduled role jobs in BACKLOG with it.
- Changing the floor from /board: the defaults are changed by a board pull request.
- Retrying a failed Discord post.
- Inbound Discord (polls, buttons, commands), free voting and the Video Editor: backlog.
- A post when a card opens or fills: left out of v1 (see Decisions).

## Behaviour

**The weekly report.**
- A report covers one New York week, Monday 00:00 to the next Monday 00:00 (America/New_York, the studio's day).
- A pg_cron job calls `publish_weekly_report()` every hour. With no argument it takes the last ended week. It publishes each week once, and a week in which no card shipped gets no report.
- The facts come only from public records, through SQL, never from an agent:
  - each card that went live that week: its title, folder, live time, cost billed to the studio, and its supporters by number (at most 24, plus a count), from supporter-pages' public supporter list;
  - the number of cards shipped;
  - the cards open for funding (money-logic's `money.card_takes_money`, the set in `public_money.funding_order`), and the first three in that order;
  - the new supporters that week (money-logic's `supporters` rows, which never include the board's test payment);
  - the week's spend billed to the studio.
- `/reports` lists the reports newest first, each through the kernel `ReportFacts` template. With none yet it says: "No weekly report yet. A report is published after a week in which a card shipped."
- `/api/reports` follows site-snapshot's documents: GET only; any query string answers 400 `no-store` before Supabase; the 200 carries `Netlify-CDN-Cache-Control: public, durable, s-maxage=3600, stale-while-revalidate=600` and `Cache-Control: public, max-age=0, must-revalidate`. That is at most about 720 invocations a month.

**Discord, outbound only.**
- `DISCORD_WEBHOOK_SHIPS` and `DISCORD_WEBHOOK_WEEKLY` are optional. Unset, that lane makes no request. Set, each must be a Discord webhook address (`https://discord.com/api/webhooks/<id>/<token>`, or the `discordapp.com`, `ptb.` and `canary.` forms), or the dispatcher refuses to start and names the key. The address is a bearer secret and is never logged or printed. It lives only in the dispatcher host's `.env`, never on Netlify.
- **Ship posts.** Each tick, a card that went live in the last 6 hours and has no `outbound_posts` row is posted to the ships lane: "Shipped: <title>. Built by <role> for $0.29 from contributions, funded by Supporter 3, Founding supporter 1 and 2 more. Watch how it was built: <site>/card/<id>". At $0.00 from contributions (founder-billed work) the cost clause is left out. A card older than 6 hours is never posted, so switching the lane on does not flood the channel.
- **Weekly posts.** The newest report, when it has not been posted: "This week at Mob Machine: 2 cards shipped (<title>, <title>). 6 cards are open for funding. Read the report: <site>/reports".
- **Pause.** While the studio is paused or `kill_switch_fired_at` is set, nothing is posted, and a ship post found then is recorded `skipped` so it is never posted after resuming. A Pause therefore also stops a post about an incident card.
- **At most once.** Discord webhooks take no idempotency key. Before sending, the dispatcher inserts the `(kind, ref)` row as `sending`; the primary key refuses a second claim. After the request the row becomes `posted` with the message id, or `failed` with the status. Any existing row is never posted again, so a timeout, an error or a crash mid-request loses that post rather than doubling it.
- **Every post** is plain text of at most 2,000 characters, with the username "Mob Machine", `allowed_mentions: { parse: [] }`, Discord markdown and mentions escaped in every title, and `?wait=true`. It runs inside the tick's try/catch with a 10-second timeout, so Discord can never delay a card or the heartbeat.
- Discord is for ages 13 and over. The posts link back to the site, which stays the all-ages home.

**The card supply floor.**
- `studio_state` gains `card_floor_open` (default 6), `card_floor_big` (1), `card_floor_small` (1), `card_big_min_usd` ($5) and `card_small_max_usd` ($2).
- `card_supply()` counts the cards open for funding (the same set as `public_money.funding_order`), the big ones (target at or above $5, which pool many contributions) and the small ones (target under $2), and returns each shortfall and the open cards.
- `/board` shows "Open cards: 6 of a floor of 6 · $5 or more: 0 of 1 · under $2: 6 of 1". When any shortfall is above 0, Needs you shows "Card supply is short" with a "Draft to the floor" button.
- "Draft to the floor" queues agent-workflows' `draft_card` job with typed input `{floor, open_cards}` through `enqueue_manual_job`, under the board's second factor. It runs attended while a board member is signed in, like every role job, and its drafts pass the same checks, grading and cooling window as any card.

## Acceptance criteria

- [x] `publish_weekly_report(p_week_start)` is callable by the service role only; it refuses a date that is not a Monday or a New York week that has not ended; with no argument it takes the last ended New York week, tested with a card shipped inside whatever week that is on the day the test runs, so the test passes on any date; it returns null and inserts nothing for a week with no card gone live; otherwise it inserts one row, and a second call changes nothing (Deno migration test, `reports_supply_test.ts`, whose fixture ships are all in 2025 so none can fall in the last ended week); the migration schedules `weekly-report` hourly inside the pg_cron guard (static test; PGlite ships no pg_cron, so `cron.job` is quoted in production step 3).
- [x] On a fixture with a founder-billed card, the board's test payment and contributors with emails, a report's facts hold each shipped card's title, folder, live time, studio-billed cost and supporter numbers (at most 24, plus a count), the shipped count, the open count equal to the number of cards in `public_money.funding_order` with its first three in that order, the new supporters and the studio-billed spend, and hold no per-supporter amount, name, email, founder-billed cost or board payment (Deno migration test).
- [x] RLS is on for `studio_reports` and `outbound_posts`; anon can execute `site_reports()` and nothing else new; `studio_reports`, `outbound_posts`, `publish_weekly_report` and `card_supply` are refused to anon with 42501 (`anon-negative-test.ts`).
- [x] `/api/reports` returns `site_reports()`' reports newest first with the CDN and browser headers above, answers any query string with 400 `no-store` without calling Supabase, and answers a POST with 405 (unit test with a mocked fetch). `/reports` renders the list and the empty-state sentence and the footer links to it; with /reports (list and empty state) in the routes of `design.spec.ts` (axe WCAG 2.2 AA, no sideways scroll), `layout-balance.spec.ts` and `route-shots.spec.ts`, all three pass at the widths they run. `ReportFacts.tsx` and `reports-source.ts` are in `kernel-paths.txt` and `KERNEL_PATHS` (parity test), and the kernel guard fails a card branch that touches either.
- [x] The dispatcher refuses to start with a Discord key that is not a Discord webhook address, naming the key only; with both keys unset a tick makes no request to Discord; `dispatcher-env.mjs` copies each key when set, omits it when unset and refuses a bad value naming the key only; no log or error line captured by `config.test.ts`, `discord.test.ts`, `outbound.test.ts` or `ops.test.mjs` contains the webhook token.
- [x] With a fake fetch (`outbound.test.ts`): a card live within 6 hours is posted once to the ships lane with `?wait=true` and its message id stored; a card live longer ago is not posted; a card found while the studio is paused or the kill switch has fired is recorded `skipped` and not posted after resuming; a post that timed out, failed, or whose row was left `sending` by a restart is never sent again; the newest unposted report is posted once to the weekly lane; every body sets `allowed_mentions.parse` to `[]` and the username "Mob Machine", escapes markdown and `@` in titles, is at most 2,000 characters, and leaves out the cost clause at $0.00; a fetch that throws or times out leaves the rest of the tick unaffected (`tick.test.ts`).
- [x] On a fixture, `card_supply()` returns the open, big and small counts over the cards in `public_money.funding_order`, each shortfall against the `studio_state` floor, and the open cards; `/board` shows the supply line; a shortfall above 0 shows "Card supply is short" in Needs you; "Draft to the floor" queues exactly one board-origin `draft_card` run with `{floor, open_cards}` through `enqueue_manual_job` and is refused without the second factor; its status line sits inside the form and clears the focused button's ring by at least 8 px at 375 and 1440 px, as the two-factor status under Verify does (board unit tests and the board e2e under the enforced policy).
- [x] `docs/BACKLOG.md` no longer lists "The Monday report", "Discord bot" describes only the inbound parts, BOARD-SETUP "Discord webhooks" says the code is built and inert until the addresses are set, and `pnpm verify` passes.
- [ ] Production: a dump taken before the migration; the migration applied; `anon-negative-test.ts` and `ledger-identity.ts` PASS; on the deploy preview a second `/api/reports` read is a CDN hit and `?x=1` answers 400; after the merge the live check renders `/reports`, and `file-backlog --apply` has removed "The Monday report" from /roadmap (waits on: production steps 1 to 6).

## Verification

- `rm -rf platform/site/dist-e2e platform/board/dist-e2e && pnpm verify`
- `E2E_PORT=4460 E2E_ROUTE_SHOTS=<folder> pnpm --filter @backseat/site e2e` (includes `design.spec.ts`, `layout-balance.spec.ts` and `route-shots.spec.ts` with /reports; any free port)
- `BOARD_E2E_PORT=4461 pnpm --filter @backseat/board e2e`
- `deno test --config platform/supabase/functions/deno.json --allow-read --allow-env platform/supabase/functions/_shared/migration_test.ts platform/supabase/functions/_shared/reports_supply_test.ts`
- `pnpm --filter @backseat/dispatcher exec vitest run test/discord.test.ts test/outbound.test.ts test/config.test.ts test/tick.test.ts`
- `node --test platform/ops/test/ops.test.mjs`
- On the deploy preview, after production step 2: `curl -s -D - -o /dev/null <preview>/api/reports` twice (quote `Cache-Status`), and with `?x=1` (quote the 400).
- Production:
  - `pnpm --filter @backseat/supabase exec tsx scripts/anon-negative-test.ts`;
  - `pnpm --filter @backseat/supabase exec tsx scripts/ledger-identity.ts`;
  - `set -a; . ./.env; set +a; node platform/site/scripts/live-check.mjs`;
  - `pnpm --filter @backseat/supabase file-backlog`, as a dry run, then `--apply`.

## Production steps

The migration is additive and must be live before the merge, because the site's function calls `site_reports()` and the dispatcher on the new code writes `outbound_posts` on its first tick.

1. Dump: `/opt/homebrew/opt/libpq/bin/pg_dump "$BACKUP_DB_URL" --format=custom --file ~/peanutgallery-dumps/pre-reports-supply-<UTC>.dump`, then `chmod 600`. `BACKUP_DB_URL` is never printed.
2. Apply `20260925100000_reports_supply.sql` through the Management API query endpoint, or `supabase db push` once the history repair has run (then `supabase migration repair --status applied <version>` if the endpoint was used). Re-apply if a reviewer changes the SQL, then re-run the preview check.
3. From the branch: `anon-negative-test.ts` PASS and `ledger-identity.ts` PASS, quoting `select public.ledger_identity()`, `select public.card_supply()` (expected short of its one big card) and `select jobname, schedule from cron.job where jobname = 'weekly-report'`.
4. The deploy-preview check of `/api/reports`.
5. Merge on a green gate at the head sha. Netlify deploys both sites.
6. The live check. Then `file-backlog` as a dry run ("The Monday report" listed for removal, "Discord bot" updated in place), then `--apply`, which deletes the planned card in one statement (agent-system-core's `file-backlog --apply`; the step 1 dump covers it).

Board items (listed, never blocking):
- Discord (BOARD-SETUP "Discord webhooks"): create the #ships and #weekly webhooks, put them in `.env` as `DISCORD_WEBHOOK_SHIPS` and `DISCORD_WEBHOOK_WEEKLY`, and turn on AutoMod. The attended dispatcher reads them at its next start; the Mac host gets them when `make-dispatcher-env.sh` and `install.sh` run at the cutover. The first ship post's arrival is quoted then.
- Optional: change the floor defaults through a board pull request. The defaults apply until then.
- No Stripe, Console or spending step.

## Evidence

Built 26 September 2026 on `launch/studio-reports`, stacked on `launch/grid-boxes` (base `fa7412b`).

**Names confirmed against the code on the base.**
- money-logic: `money.card_takes_money(c, p_lane_open)` as agent-system-core redefined it (not board-vetoed, `card_is_public`); `money.funding_order()` returns `("position", card_id, room_usd)` and `public_money.funding_order` is its jsonb array `[{position, card_id, room_usd}]`; `supporters (number, contributor_id, first_payment_id, founding, created_at)`, which `money.is_board_test` keeps the board's test payment out of. The card's target column is `funding_target_usd`.
- supporter-pages: `public_card_supporters (card_id, supporter_number, founding)`, filtered by `money.payment_counts` (no board test payment, no fully reversed payment) and `card_is_public`.
- agent-system-core: `enqueue_manual_job(p_job, p_card, p_reason, p_input default '{}')`, which refuses anyone but the board, a session without `board_aal2()`, a blank reason and input over 4 KB; `file-backlog --apply` deletes planned cards whose entries left BACKLOG.
- agent-workflows: `draft_card`'s `parseDraftInput` takes `{}` or `{floor, open_cards}`, `floor` a number or named numbers, `open_cards` ids or `{id}`, and filters its own open cards by those ids.
- site-snapshot: `platform/site/netlify/functions/snapshot.mts` kept one value for `s-maxage` and `stale-while-revalidate`; `/api/reports` now carries its own (3,600 and 600).

**Production, read only (26 September 2026, the Management API query endpoint, a select of the migration's own function bodies; nothing written).** The last ended New York week is `"2026-09-14"`. Its facts: `shipped_count` 6 (the Gatherer, Forge and Mill prices, the unlock list, progress on reload, the game's tab), each `cost_usd` 0 and no supporter (founder-billed launch work), `open_count` 6, `new_supporters` 0, `spend_usd` 0; the weeks of 7 and 21 September have no ship. So the first hourly run after the migration publishes the week of 14 September 2026. `card_supply()` before, with the floor's defaults: `{"open": 6, "big": 0, "small": 6, "floor_open": 6, "floor_big": 1, "floor_small": 1, "short_open": 0, "short_big": 1, "short_small": 0, "big_min_usd": 5, "small_max_usd": 2, ...}`, short of its one big card as expected. After: production step 3.

**Verification, run on the branch.**
- `rm -rf platform/site/dist-e2e platform/board/dist-e2e && npm_config_workspace_concurrency=1 pnpm verify`: exit 0. `platform/board test: Tests 100 passed (100)`; `platform/supabase test: Tests 316 passed (316)`; `platform/site test: Tests 514 passed (514)`; `seed-1 test: Tests 77 passed (77)`; `platform/dispatcher test: Tests 714 passed (714)`; `platform/gate test: PASS: gate tests passed=527`; agents `ℹ pass 125`, ops `ℹ pass 128`; Deno `ok | 128 passed (223 steps) | 0 failed`; `PASS: secret-scan files=637`; docs `ℹ pass 19`; rename `ℹ pass 8`, `tier 1 carries the old name nowhere`.
- `E2E_PORT=4460 E2E_ROUTE_SHOTS=… pnpm --filter @backseat/site e2e`: `220 passed (3.9m)`, `2 skipped` (the design guide's own screenshots, which need `E2E_SCREENSHOTS`). Among them `the weekly reports › list two reports with no axe violation, no sideways scroll and the bands at 375px`, `768px` and `1440px`, `the footer links /reports`, `the weekly reports, none yet › say no report yet and link the roadmap`, every layout balance run with /reports in its routes (320 to 1440px), and `route screenshots, no report yet › /reports with none at 375px`, `768px`, `1440px`. The first run found `/reports orphan: a 11px item alone on a line in div "Open for funding when published6"` at 320px; the label became "Open for funding" (Decisions).
- `BOARD_E2E_PORT=4461 pnpm --filter @backseat/board e2e`: `9 passed (4.7s)`, with `the card supply: the line, Card supply is short, and Draft to the floor queues one draft_card run at the second factor alone, under the enforced policy` and `at the first factor the supply item asks for the second factor and offers no Draft to the floor`.
- `deno test … migration_test.ts reports_supply_test.ts`: `ok | 5 passed (21 steps) | 0 failed` for `reports_supply_test.ts` (publish once, null for no ship, a Tuesday and the week under way refused, the week boundary in New York time, both DST changes, the facts' privacy, site_reports newest first to anon, card_supply above, below and between the thresholds with a full and a vetoed card left out, and the grants), inside the verify total above.
- `pnpm --filter @backseat/dispatcher exec vitest run test/discord.test.ts test/outbound.test.ts test/config.test.ts test/tick.test.ts`: `Test Files 4 passed (4)`, `Tests 83 passed (83)`.
- `node --test platform/ops/test/ops.test.mjs`: `ℹ pass 128`, `ℹ fail 0` (the Discord keys copied, omitted and refused by key only; `check_env_lines` refuses a bad address; one pattern in all three places; `after-restore.sql` schedules `weekly-report`).
- Screenshots, looked at, in `/Users/kylesmith/peanutgallery-launch/shots/build/studio-reports/`: the branch build with production's own `/api/live` and `/api/cards` and `/api/reports` answered with the week of 14 September 2026 as the query above computes it, and with none: `prod-published /reports 375: audit clean`, `prod-published /reports 1440: audit clean`, `prod-empty /reports 375: audit clean`, `prod-empty /reports 1440: audit clean` (and home at both widths clean), no sideways scroll; the fixture's two reports and the empty state at 375, 768 and 1440 in `route-shots/`. The empty state reads as one block, its line with See the roadmap under it.

**After merging `main` (grid-boxes #84, with its later layout checks) into the branch**, rerun at the merge: `pnpm verify` exit 0 (`platform/site test: Tests 515 passed (515)`, dispatcher 714, supabase 316, board 100, seed-1 77, `PASS: gate tests passed=527`, Deno `ok | 128 passed (223 steps) | 0 failed`, agents 125, ops 128, docs 19, rename 8 and `tier 1 carries the old name nowhere`); `E2E_PORT=4460 pnpm --filter @backseat/site e2e`: `219 passed (4.0m)`, `8 skipped` (the screenshot tests, without their folders).

**The ship stage, before the merge (26 September 2026).** Main at `747803a` (grid-boxes #84 merged) was already in the branch; `docs/specs/grid-boxes.md` got its production evidence and Status done (commit `bfb8459`).
- At `bfb8459`: `rm -rf platform/site/dist-e2e platform/board/dist-e2e && npm_config_workspace_concurrency=1 pnpm verify` → `EXIT 0`, with `platform/board test: Tests 100 passed (100)`, `platform/supabase test: Tests 316 passed (316)`, `platform/site test: Tests 515 passed (515)`, `seed-1 test: Tests 77 passed (77)`, `platform/dispatcher test: Tests 714 passed (714)`, `PASS: gate tests passed=527`, agents `ℹ pass 125`, ops `ℹ pass 128`, Deno `ok | 128 passed (223 steps) | 0 failed`, `GATE PASS folder=seed-1 lane=code`, `GATE PASS folder=platform lane=code`, `PASS: secret-scan files=637`, docs `ℹ pass 19`, rename `ℹ pass 8`, `tier 1 carries the old name nowhere`.
- `BOARD_E2E_PORT=4461 pnpm --filter @backseat/board e2e`: `9 passed (5.0s)`, among them `the card supply: the line, Card supply is short, and Draft to the floor queues one draft_card run at the second factor alone, under the enforced policy`.
- `E2E_PORT=4460 pnpm --filter @backseat/site e2e`: `218 passed (4.5m)`, `8 skipped`, `1 failed`: `design.spec.ts › accessibility (axe, WCAG 2.2 AA) › finds no violation on the guide and every page at 375px` hit its 30-second timeout in `document.fonts.ready` with the machine's load average at 20 to 40 from other runs, not an axe finding. Run alone (`E2E_PORT=4462 … e2e e2e/design.spec.ts -g accessibility`): `3 passed (31.1s)`, the 375px run in 13.9s. The local gate runs the whole suite again.
- `deno test … migration_test.ts reports_supply_test.ts`: `ok | 8 passed (92 steps) | 0 failed`. `pnpm --filter @backseat/dispatcher exec vitest run test/discord.test.ts test/outbound.test.ts test/config.test.ts test/tick.test.ts`: `Test Files 4 passed (4)`, `Tests 83 passed (83)`. `node --test platform/ops/test/ops.test.mjs`: `ℹ pass 128`, `ℹ fail 0`.
- Production step 1 (read first: `studio_state` `{"paused":true,"pause_reason":"awaiting_credit","kill_switch_fired_at":null}`, and `studio_reports`, `outbound_posts`, `card_supply()` and `site_reports()` all absent): `pg_dump "$BACKUP_DB_URL" -Fc` → `~/peanutgallery-dumps/pre-studio-reports-20260926T171620Z.dump`, 784,446 bytes, `chmod 600`; `pg_restore --list` lists 1,188 entries, with `TABLE DATA public cards`, `ledger`, `studio_state` and `supporters`.
- Production step 2: `20260925100000_reports_supply.sql` as at `bfb8459` (sha256 `395152dd…363d99f`), wrapped in `begin;`/`commit;`, one Management API request → `[]` `HTTP 201`.
- Production step 3, read back through the same endpoint:
  - `select public.card_supply()` → `{"open":6,"big":0,"small":6,"floor_open":6,"floor_big":1,"floor_small":1,"short_open":0,"short_big":1,"short_small":0,"big_min_usd":5,"small_max_usd":2,"open_cards":[…6 cards, first "Stop the unlock count from showing more unlocks than exist" at 1.5…]}`: short of its one big card, as expected.
  - `select jobname, schedule, command from cron.job where jobname = 'weekly-report'` → `[{"jobname":"weekly-report","schedule":"7 * * * *","command":"select public.publish_weekly_report()"}]`.
  - `select public.ledger_identity()` → `"holds":true`, I1 to I5 each `"drift":0`, `"contribution_rows":1`.
  - RLS on both new tables (`"rls_reports":true,"rls_outbox":true`); `studio_reports` holds 0 rows; `money.last_ended_week(now())` → `"2026-09-14"`; `studio_state` still paused (`awaiting_credit`) with the floor defaults `6, 1, 1, 5.0000, 2.0000`.
  - From the branch: `anon-negative-test.ts` → `PASS: anon access matches the RLS contract`, with `studio_reports`, `outbound_posts`, `rpc publish_weekly_report` and `rpc card_supply` each `expected refused actual refused 42501` and `rpc site_reports (the site's document) expected readable actual readable keys reports`; `ledger-identity.ts` → `PASS: ledger identity holds over 1 contribution rows, 0 studio ledger rows, 1 allocations and 59 cards`.
- Production step 4. Netlify builds no preview for this pull request, so a draft deploy of the branch's own build stood in, as for supporter-pages (`pnpm --filter @backseat/site build` with netlify.toml's three public values at `bfb8459`, then `netlify deploy --dir dist --functions netlify/functions`, never published; its function reads production, where step 2 had run), https://6ab7fe2d6a9120bb7c9fa44c--peanutgallerygames.netlify.app:
  ```
  == GET /api/reports (1)  HTTP/2 200  cache-control: public,max-age=0,must-revalidate  cache-status: "Netlify Durable"; fwd=uri-miss; stored
  == GET /api/reports (2)  HTTP/2 200  cache-status: "Netlify Durable"; hit; ttl=3599  content-length: 15  {"reports": []}
  == GET /api/reports?x=1  HTTP/2 400  cache-control: no-store  {"error":"No query string is allowed"}
  == POST /api/reports     HTTP/2 405  allow: GET
  ```
  The branch's live check against the draft: `PASS live-check https://6ab7fe2d6a9120bb7c9fa44c--peanutgallerygames.netlify.app passed=276 failed=0 skipped=2` (the og:image and www lines are production's), with `PASS 375px /reports status 200`, `no horizontal overflow`, `one h1: ["Weekly reports"]`, `no dead space` and every page's footer linking Weekly reports, the same at 1440px.

Waits on the ship stage: step 5 (the local gate at the head and the merge) and step 6 (the live check on production, the first hourly `weekly-report` run publishing the week of 14 September 2026, and `file-backlog` as a dry run, then `--apply`).

## Decisions

- 2026-09-23, Trimmed (board: "better to be simple and delete than add more convoluted bespoke"; good normal modern standards): 25 criteria became 9. Cut, because each shipped switched off with the operations bucket removed (role jobs run only board-queued and attended until a percentage exists): the tick's drafting trigger (`src/supply.ts`), its reads of `operations_pct` and `operations_budget`, `operations_ready` and the "Drafting waits on the operations bucket." line; the Studio Head's `report_note` on `ranking.schema.json`; the Head of Finance's `finance_note` job, its handler, `report-note.schema.json`, its Controller-alert watch and its note on /ledger (`MoneyIn.tsx` is no longer touched here); `set_report_note`, the report's `notes` column and its public-text filter. Replaced with the standard tool: the dispatcher's weekly-report publishing by a pg_cron job; the six-state outbox and its `claim_outbound`, `finish_outbound` and `settle_unknown_outbound` RPCs by plain inserts into `outbound_posts` whose primary key is the claim, with no retries (a missed post is accepted, a double one is not); `card_open_for_funding` by money-logic's `public_money.funding_order` set (site-snapshot dropped the predicate); `Netlify-Vary: query=v` by site-snapshot's plain CDN headers. Cut as customization: `set_card_floor`, the second-factor floor form and its board action (a board pull request changes the defaults). Cut as implementation detail or duplication: the `public_studio_reports` view and the public `weekly_report_facts` (one read, `site_reports()`); recreating `board_studio_state` (the board calls `card_supply()`); the home Shipped-row link; the fixture mockup and the attended frame grading (the site's axe, layout-balance and route-shot suites cover it); the dependency on the layout-balance gate module (that pull request is dropped); the live Discord criterion (a board item, not a gate). Kept whole: every Problem outcome, the facts' privacy, at-most-once posting, the Pause and kill-switch stop, the webhook secret, RLS and the anon grants, the kernel paths, the dump before the production write, `anon-negative-test.ts` and `ledger-identity.ts`.
- 2026-09-23, reconciled with the series (these override any line that disagrees):
  - The migration is `20260925100000_reports_supply.sql` (superseded 2026-09-26: the series' stamp once terms version 3 took `20260925000000`). It does not touch `board_studio_state` or `board_actions_action_check`.
  - Open for funding is money-logic's `money.card_takes_money`, the set listed in `public_money.funding_order`, which every Fund button follows.
  - The drafting job is agent-workflows' `draft_card`, queued with `{floor, open_cards}` through agent-system-core's `enqueue_manual_job(..., p_input)`.
  - The planned card "The Monday report" leaves /roadmap through `file-backlog --apply`, the series' one path for removing planned cards. `cancel_card` would list it as cancelled, which is false.
- 2026-09-26, built under the board's order of that day (finish every agreed launch item without asking; each call recorded here):
  - The migration is `20260925100000_reports_supply.sql`, the series' fixed stamp. Its Deno tests are their own file, `platform/supabase/functions/_shared/reports_supply_test.ts`, as supporter-pages' are; `migration_test.ts` lists the file in its order and its tables and grants.
  - The New York week arithmetic is `money.last_ended_week(timestamptz)`, which `publish_weekly_report` calls with `now()`: a test cannot move `now()`, so the DST case is tested on the helper at both changes (1 November 2026 and 14 March 2027). The facts are `money.report_facts(date)`. Both live in the `money` schema, security definer like every helper there, and no API role can call them.
  - A report counts only cards still at stage live and public (`card_is_public`); its spend uses the ledger's public read filter (studio-billed rows on public cards or no card). Each shipped card carries its id, so /reports links its page.
  - `card_supply()` also returns `big_min_usd` and `small_max_usd`, so the board's line reads the thresholds from `studio_state` instead of repeating $5 and $2.
  - Draft to the floor sends `open_cards` as card ids, at most 80: `draft_card` reads the open cards' typed fields itself and filters by id, and `enqueue_manual_job` refuses input over 4 KB. `floor` is `{short_open, short_big, short_small}`.
  - The supply line sits in /board's Studio section; the Needs you item names the same line, with a reason field and Draft to the floor at the second factor, and at the first factor says to verify it.
  - A ship post names at most three supporters, a weekly post at most five titles, then "and n more". A ship found while paused is recorded `skipped` with `skip_reason` `paused` or `kill_switch`, whichever stopped it. Escaping flattens line breaks and puts a backslash before the backslash, the backtick, `*`, `_`, `~`, `|`, `[`, `]`, `(`, `)`, `<`, `>`, `#`, `@` and `:`; the site link is never cut by truncation.
  - `PUBLIC_SITE_URL` must be an https origin with no path; `DISCORD_WEBHOOK_SHIPS` and `DISCORD_WEBHOOK_WEEKLY` use one pattern in `config.ts`, `dispatcher-env.mjs` and `provision.sh`, tested equal. The lane logs nothing on a tick where both are unset.
  - The report's template words are `legal.reportFacts` (kernel), since they name money and `copy.ts` and `legal.ts` share no key; the page's own words are `copy.reports`. The open figure reads "Open for funding", and the lede says the open cards are counted as the report is published: "Open for funding when published" left its figure alone on a line at 320px (the layout audit's orphan check).
  - /reports shows its empty state as one block (the line and See the roadmap), like the not found page. The footer links /reports from the start: on production's own records (read-only, 26 September 2026) the week of 14 September 2026 had six ships, so the first hourly run after the migration publishes a report at once, and the empty state stands only until then.
  - `/api/reports` shares `snapshot.mts`' one rate-limit rule; the function keeps a separate stale window per document (3,600 and 600 seconds for the reports).
  - `after-restore.sql` schedules `weekly-report`, as it does the other pg_cron jobs, so a restored copy publishes too (the Mac host's restore test requires it).
- 2026-09-26, review fixes (each with a test that failed before it):
  - `reports_supply_test.ts`'s fixtures ship only in 2025, and the no-argument step ships its own card at Wednesday noon New York time inside `money.last_ended_week(now())`, then asserts `publish_weekly_report()` returns that week with one ship and a second call adds no row. Before, a fixture shipped at 21 September 2026 04:00 UTC, so from 28 September to 5 October 2026 the step would have failed `pnpm verify`, and on other days it asserted nothing about the no-argument call. Run with the clock moved to 29 September 2026, the old step fails and the new one passes.
  - Draft to the floor's status line is inside its form, as on every other board form, so the form's 16 px gap spaces it. The same flaw stood on main under the two-factor Verify form, where the status follows the form (it can show with no form, after a failed enrolment); `.stack + p` now gives any paragraph after a form the same 16 px. The board e2e measures the focused button's ring against both status lines (it measured -5 px before).
- 2026-09-23: the report's facts come from SQL over public records, and no model writes any part of it. This gives a report from the first week a card ships.
- 2026-09-23: a report is published only for a week in which a card shipped (PG-13), so a paused studio posts nothing empty.
- 2026-09-23: the week runs Monday to Monday, New York time: the same day boundary as the pool and the caps. This is a cadence, not a date.
- 2026-09-23: v1 posts ships and the weekly report only, not a post for each card that opens or fills. The ships channel then carries real outcomes, and the weekly post names what is open.
- 2026-09-23: posts run in the dispatcher's tick from an outbox table, not in the pipeline's ship step, so a post can never delay or fail a merge, and ships from the recovery path are posted too.
- 2026-09-23: a card first seen more than 6 hours after going live is not posted, and only the newest report is posted, so switching a lane on never floods the channel.
- 2026-09-23: ship posts are skipped while the studio is paused or the kill switch has fired. Pause is the moderator's only right, and it must also stop a post about an incident card.
- 2026-09-23: the floor names its sizes "big" ($5 or more) and "small" (under $2); every fundable card is already a goal card by shape. The defaults are 6 open, at least 1 big and at least 1 small: the six matches the six open today and fills two rows of the three-column grid, and the big and small minimums are PG-10's.
- 2026-09-23: a short supply is a Needs-you item with Draft to the floor, because drafting is board-started and attended until an operations percentage exists.
- 2026-09-23: the webhook addresses stay on the dispatcher's host, the Mac's `.env`. They never go on the public site's Netlify host, where card-built code runs.
