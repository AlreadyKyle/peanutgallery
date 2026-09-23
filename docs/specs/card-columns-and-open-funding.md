# Card columns and open funding

Status: done. Card: none. Owner: board.

## Problem

`apply_contribution` credits any goal card a payment names, whatever its stage. Money for a card that is already funded, building or live raises a bar that no longer means anything, and on a live card it moves `updated_at`, which the site reads as the ship date. Anon and authenticated also read `cards` at table level, so the API hands anyone `actual_usd`, which counts founder-billed turns, and `severity` and `priority`, which mark incidents. PLAN.md §4 keeps both private to the board. Several reversal paths have no test either, and `reverse_contribution` does not report a reserve that a refund or dispute took below zero.

## Scope

In:
- Migration `20260921000000_open_goal_funding.sql`: `apply_contribution` credits open goal cards only, and `reverse_contribution` returns the pool's reserves and the kind's totals.
- Migration `20260921000100_public_card_columns.sql`: `cards.live_at`, its backfill and trigger, and column grants on `cards` for anon and authenticated.
- PGlite and text tests for both, and tests for the reversal paths that had none.
- `scripts/anon-negative-test.ts` probes the withheld columns.

Out:
- The site. It keeps reading `updated_at` as the ship date. A separate change moves it to `live_at` after these migrations are live.
- The split, hold and reversal arithmetic, which stay exactly as `refunds-and-holds.md` defines them.
- `credit_held_contributions`, which is unchanged.
- The realtime publication, which is unchanged.
- A webhook alert for a reserve below zero. The function now returns the figure; alerting on it is a later change.

## Behaviour

**Open funding.**
- A payment credits a goal card's bar only while the card is `proposed`, `designing` or `voted`. These are the stages the site lists under Fund what's next.
- Money that names a card in any other stage, or a card that is not a goal, funds the pool as if it named none. Its row's `goal_card_id` is null, and the result's `goal_card_id`, `goal_stage` and `goal_funded_usd` are null. A refund or dispute of that payment leaves the card alone, and its row's `goal_card_id` is null too.
- The stage is checked when the payment is credited, not when the supporter paid (see Decisions).
- A replay (the same event or Checkout session again) reports the `goal_card_id` stored on the payment row, so it names the card the money went to even after that card has closed, and names none for money that went to the pool.
- A `proposed` or `voted` card that reaches its target still moves to `funded`. A `designing` card is credited and keeps its stage.
- ~~Money already held for a card that was open when it was paid still reaches that card's bar when the hold is released, whatever the card's stage by then. The payment row carries the card id, and `credit_held_contributions` credits the card named on the row without checking its stage (`refunds-and-holds.md`). The pledge was made while the card was open.~~ Superseded by `money-logic.md` (2026-09-23): a released hold enters the waterfall at step 1 only while its card still takes money, and otherwise at step 2.
- The split, the daily hold, the lock order and every reversal figure are unchanged.

**Reversal result.** `reverse_contribution` returns four more figures, with no change to what it moves:
- `pool_reserve_usd` and `pool_incident_reserve_usd`, read from the pool row after an inserted reversal. A refund can leave the 10% reserve below zero, and the figure shows it.
- `kind_reversed_usd`: what this payment had already reversed for the call's kind (refund or dispute) before the call.
- `kind_total_usd`: the kind's cumulative total the call asked for, rounded to four places.
- Both kind figures are returned when a reversal is inserted and when nothing is left to reverse (not on a replay of the same event id). With nothing left, `kind_reversed_usd >= kind_total_usd` means this kind already reversed it, for example the other event for the same dispute; a smaller `kind_reversed_usd` means the other kind took it, for example a dispute after a full refund.

**Ship stamp.**
- A card inserted at `live` keeps the `live_at` it was given, or is stamped with the current time when it was given none.
- A card whose stage changes to `live` is stamped with the current time, even when the same update names a `live_at`.
- An update that leaves the stage alone, sets `live` again on a live card, or moves money onto its bar keeps the stamp. A card that leaves `live` keeps its stamp until it ships again, which stamps it again.
- The migration stamps each card already live with the time of its last `ship` agent event, or its `updated_at` when it has none. The backfill leaves `updated_at` as it was.
- `live_at` is for the site's ship date. Until the site reads it, a hold released onto a shipped card's bar or a refund taken off it still moves `updated_at`, and so the ship date the site shows.
- `set_live_at` runs with the caller's rights and an empty `search_path`, which the Supabase advisor asks of every function.
- Both migration files start with `set lock_timeout = '5s'`, so a lock wait fails the migration rather than queueing every reader of `cards` and `pool` behind it. `set` lasts for the connection; on a connection the Management API reuses, a later query would only fail a lock wait sooner.

**Public columns of cards.**
- Anon and authenticated may select these columns of `cards` and no others: `id`, `bucket`, `source`, `shape`, `lane`, `board_reason`, `folder`, `executor_role_id`, `title`, `summary`, `intent`, `acceptance_test`, `design_spec_url`, `funding_target_usd`, `funded_usd`, `estimate_usd`, `confidence`, `proposer_role_id`, `director_stance`, `veto_reason`, `stage`, `branch`, `commit_sha`, `failing_check`, `created_at`, `updated_at`, `live_at`.
- `actual_usd`, `severity` and `priority` are withheld, and `select *` is refused because it names them.
- Anon and authenticated hold no table-level privilege on `cards`. Before this change they held `SELECT` and, on Postgres 17, `MAINTAIN` (PGlite 17.5 shows `anon=rm/postgres`). Nothing relies on either beyond `SELECT` on the granted columns: every write to `cards` goes through the service role (the dispatcher, the filing scripts) or a security definer RPC (the board), and realtime needs `SELECT` only. The migration revokes everything and grants the columns.
- A column added to `cards` later is private until a migration grants it.
- The site's card queries name only granted columns (`source.ts` selects `id,title` and `id,title,summary,intent,source,stage,shape,bucket,folder,funding_target_usd,funded_usd,created_at,updated_at`, filters on `stage` and orders by `created_at`).
- No view in `public` reads `cards`. Every function authenticated may run is security definer, so the board's RPCs read `cards` with the owner's rights. The dispatcher, the webhook, `deploy.sh` and the filing scripts use the service role, which keeps its table-level grant.
- The realtime publication still carries `cards`. Supabase Realtime filters the columns of each change by the subscriber's select privilege and needs the primary key to be selectable. `id` is granted, and the site ignores payloads and reloads on any change. Both are to be probed live, because the PGlite test has no Realtime.

## Acceptance criteria

- [x] A payment naming a `live`, `funded` or `building` goal card funds the pool by its full credit, its row's `goal_card_id` is null, and the card's `funded_usd` and `estimate_usd` do not move.
- [x] A payment naming a `designing` goal card raises its bar and leaves it at `designing`.
- [x] A second payment to a voted card that the first payment funded goes to the pool, and the card's bar stays where the first payment left it.
- [x] A replay of a payment to a card that has since closed names the card; a replay of a payment that went to the pool names none, even when an open card's id is passed.
- [x] A refund of a payment that went to the pool because its card was closed leaves the card's bar alone, and the refund row's `goal_card_id` is null.
- [x] `apply_contribution` and `reverse_contribution` in the new migration equal their refunds-and-holds definitions apart from the goal lookup, the replay's goal and the lines that return the reserves and the kind's totals. Each new file holds nothing beyond its function blocks, grants, trigger statements, the `live_at` column and backfill, the lock timeout and comments.
- [x] ~~A hold paid while a card was open is released onto the card's bar after the card has gone live.~~ Superseded by `money-logic.md` (2026-09-23): a live card takes no money, so the release goes on at step 2.
- [x] `reverse_contribution` returns the pool's reserve and incident reserve after the update, including a reserve below zero.
- [x] `reverse_contribution` returns `kind_reversed_usd` and `kind_total_usd` on insert and when nothing is left: a second dispute event with the same total returns `kind_reversed_usd >= kind_total_usd`, and a dispute after a full refund returns `kind_reversed_usd` 0.
- [x] Below the incident cap at a 20% studio share, a refund row carries negative shares in the payment's proportions, the balance and the bar fall by the agents' credit share, and a dispute for the rest is covered by the reserve. The identity offsets do not move.
- [x] A refund before a hold's release cancels part of the hold, the release credits the rest, and refunds after it return every column of the payment to zero with the identity offsets unchanged.
- [x] A dispute on a payment with money still held cancels the held part and the reserve covers only the credited part; with a reserve too small to cover it, the reserve goes to zero and the rest comes off the balance and the bar.
- [x] A payment that fills only part of the incident reserve's room reverses that part exactly, and a full refund returns every column to zero.
- [x] A payment timestamped one second before New York midnight does not count toward today's cap; one timestamped at midnight does.
- [x] `live_at` is stamped on the move to live and on an insert at live without one, keeps an explicit `live_at` on an insert at live, is kept by other updates and a hold release, and is stamped again after the card leaves live and returns. `set_live_at` has `search_path=""` and is not security definer.
- [x] The backfill stamps a live card with its last ship event, a live card without one with its `updated_at`, leaves a card that is not live unstamped, keeps existing stamps and leaves `updated_at` alone. Both card triggers are enabled afterwards.
- [x] `information_schema.column_privileges` lists exactly the granted columns for anon and authenticated; the table's columns they may not select are exactly `actual_usd`, `priority` and `severity`; neither holds any table-level privilege on `cards`, `MAINTAIN` included, and `relacl` has no entry for either.
- [x] As anon, `select id, title, live_at from cards` works and `select actual_usd`, `select severity`, `select priority` and `select *` are refused with "permission denied".
- [x] No view reads `cards`, and `set_live_at` and `set_updated_at` are the only functions in `public` that are not security definer. Neither is executable by anon or authenticated.
- [x] The realtime publication still lists `cards`, `deploys` and `pool`.
- [x] `scripts/anon-negative-test.ts` reads `cards` with `select=id,title,stage,funded_usd,live_at` and expects `actual_usd`, `severity`, `priority` and `*` refused with 42501.
- [x] Live: both migrations are applied, the privilege and trigger checks below hold, every live card has `live_at`, `anon-negative-test.ts` and `ledger-identity.ts` print `PASS:`, and the site's live check passes.
- [x] Live: an anon realtime subscription to `cards` still receives changes.

## Verification

- `pnpm test:functions`
- `pnpm --filter @backseat/supabase test`
- `pnpm --filter @backseat/supabase typecheck`
- `pnpm --filter @backseat/site test` (unchanged)
- `pnpm verify` at the repository root.
- The production steps below, once the board allows them.

## Production steps (need the board's allow)

Before:
1. `pnpm --filter @backseat/supabase exec tsx scripts/ledger-identity.ts` prints `PASS:`. Keep its output as the baseline.
2. Optional: run both migrations on a local `supabase start` stack and probe realtime there as in step 10, before production.

Apply:

3. Apply `20260921000000_open_goal_funding.sql`, then `20260921000100_public_card_columns.sql`, each as one request to the Management API query endpoint. A lock wait over five seconds fails the request; retry when the dispatcher is idle.

After:

4. `select grantee, column_name from information_schema.column_privileges where grantee in ('anon', 'authenticated') and table_schema = 'public' and table_name = 'cards' and privilege_type = 'SELECT' order by 1, 2;` returns the 27 granted columns for each role and nothing else.
5. `select relacl from pg_class where oid = 'public.cards'::regclass;` has no `anon=` or `authenticated=` entry, and `select has_table_privilege('anon', 'public.cards', 'SELECT'), has_table_privilege('authenticated', 'public.cards', 'SELECT');` returns `false, false`. On Postgres 17 add `has_table_privilege(..., 'MAINTAIN')`, also false.
6. `select tgname, tgenabled from pg_trigger where tgrelid = 'public.cards'::regclass and not tgisinternal order by 1;` returns `cards_set_live_at O` and `cards_set_updated_at O`.
7. `select pg_get_functiondef('public.apply_contribution(text, text, text, numeric, numeric, integer, uuid, text)'::regprocedure) like '%and stage in (''proposed'', ''designing'', ''voted'') for update%';` returns true.
8. `select id, stage, live_at from cards where stage = 'live';` shows a `live_at` on every row.
9. `scripts/anon-negative-test.ts` and `scripts/ledger-identity.ts` both print `PASS:`, with the identity drift unchanged from step 1.
10. Probe realtime payloads as anon: subscribe to `postgres_changes` on `cards` with the anon key, change a card as the service role, and check that the change arrives, carries `id`, and has no `actual_usd`, `severity` or `priority`.
11. `node platform/site/scripts/live-check.mjs https://peanutgallery.games` prints `PASS`.
12. Only then merge the site change that reads `live_at`.

Rollback, if a check fails:
1. Re-run `20260920000000_refunds_and_holds.sql`, which is written to run twice. It restores `apply_contribution` and `reverse_contribution` as they were, so payments credit any goal card again and the four new result keys disappear. A webhook that reads `kind_reversed_usd` or `kind_total_usd` must be rolled back first.
2. `drop trigger if exists cards_set_live_at on public.cards;` The `live_at` column and `set_live_at` may stay; nothing else reads them.
3. `revoke all on public.cards from anon, authenticated; grant select on public.cards to anon, authenticated;` This restores table-level read, and with it anon's read of `actual_usd`, `severity` and `priority`, the exposure this change closed.
4. Run `anon-negative-test.ts` from the commit before this change and `ledger-identity.ts`; both print `PASS:`.

## Evidence

2026-09-16, branch `card-columns-and-open-funding`, not merged. The production steps and the two Live criteria have not run.

- **Open funding.** `platform/supabase/functions/_shared/migration_test.ts` steps:
  - "a voted goal that reaches its target moves to funded with the estimate seeded from the target": the second payment returns `goal_card_id` null, the bar stays at 1.4107, and the pool still rises by 1.8963.
  - "only an open goal is credited: live, funded and building goals send the money to the pool", with the designing case.
  - "as anon, the public window works…": `public_card_funding` shows the voted card with 1 contributor and 1.4107.
- **Unchanged math.** `platform/supabase/test/migration.test.ts` "open-goal-funding migration": each function block, with the changed lines put back, equals its refunds-and-holds block character for character; `credit_held_contributions` is not redefined.
- **Held money after a card ships.** Step "live_at is stamped when a card goes live and moves with nothing else": the release returns `{ released: 1, released_usd: 40 }` onto a live card, whose bar goes to 90.0000.
- **Reversal result and the reversal paths.** Steps:
  - "below the incident cap at a 20% studio share, a refund and a dispute keep the payment's proportions": refund row -10 / -10 / -1 / -7.2 / -1.8 / -0.36; balance and bar -6.84; dispute cover 21.6; `pool_reserve_usd` 103 then 78.4.
  - "a refund before and after the hold's release returns every column to zero".
  - "a dispute on a payment with money still held cancels the hold and covers only the credited part": held 40 cancelled, cover 50.
  - "reverse_contribution reports the kind's earlier reversals and the total asked, so nothing left to reverse can be told apart": a second dispute event returns `kind_reversed_usd` 20 and `kind_total_usd` 20; a dispute after a full refund returns 0 and 10.
  - "a refund larger than the reserve takes the reserve below zero and reports it": `pool_reserve_usd` -0.5.
  - "the daily cap counts payments from New York midnight on, not the second before": 18 credited after a payment at midnight minus 1 second, 0 credited and 18 held after one at midnight.
  - Each money step asserts the identity offsets are unchanged.
- **Ship stamp.** Steps "live_at is stamped when a card goes live and moves with nothing else" and "the backfill stamps a live card with its last ship event, or its updated_at, and leaves updated_at alone". Removing the trigger switch from the backfill fails the second step, because `updated_at` moves.
- **Column grants.** Steps "anon holds select on four public tables, the six views and the public columns of cards, and nothing else" (column privileges exact, no view reads `cards`) and "as anon…" (the four refusals). The function-privileges step lists `set_live_at` and checks that only the two trigger functions are not security definer. Granting `actual_usd` fails both grant steps. `migration.test.ts` "public-card-columns migration" checks the list against every cards column in the migrations, the revoke before the grant, and no publication change.
- **Script.** `scripts/anon-negative-test.ts` passes `pnpm --filter @backseat/supabase typecheck`. It was not run against production.
- **Suites.**
  - Before: `pnpm test:functions` `ok | 58 passed (33 steps) | 0 failed`; `@backseat/supabase` `Tests 122 passed (122)`.
  - After: `pnpm test:functions` `ok | 58 passed (41 steps) | 0 failed`; `@backseat/supabase` `Tests 132 passed (132)`; `@backseat/site` `Tests 123 passed (123)`, unchanged.
  - `pnpm verify` exit 0: supabase 132, site 123, seed-1 77, dispatcher 207, Deno 58 passed (41 steps), `GATE PASS folder=seed-1 lane=code`, `GATE PASS folder=platform lane=code`, `PASS: secret-scan files=296`.

2026-09-16, after the independent review of 6f2345b:
- **Table privileges.** Before the change PGlite 17.5 shows `relacl` `{postgres=arwdDxtm/postgres,anon=rm/postgres,authenticated=rm/postgres,service_role=arwdDxtm/postgres}` and `has_table_privilege('anon', 'public.cards', 'MAINTAIN')` true. The grants step now checks every table-level privilege, `MAINTAIN` included, false for both roles, no `relacl` entry for either, and the ungranted columns read from the table equal `actual_usd`, `priority`, `severity`. It failed on `MAINTAIN` before `revoke all`.
- **Replay.** Step "a replay names the card stored on the payment, even after the card has closed" failed before the replay read `goal_card_id` from the row.
- **More reversal paths.** Steps "a refund of a payment that went to the pool because its card was closed leaves the card alone", "a dispute on held money with a short reserve cancels the hold, covers what the reserve holds and takes the rest off the pool and the bar" (held 40 cancelled, cover 20, balance and bar -30, reserve 0) and "a payment that fills only part of the incident reserve's room reverses that part exactly" (incident 0.5 of 0.9, half refund 0.25).
- **Ship stamp.** Step "live_at is stamped when a card goes live and moves with nothing else" adds an insert at live with `live_at` 2026-08-01T09:00:00Z kept, a move to live that names a `live_at` stamped now, and `proconfig` `['search_path=""']`. It failed before the trigger change.
- **File contents.** `migration.test.ts` removes each file's expected statements and requires nothing but comments to remain; appending `update public.cards set title = title;` or `select cron.schedule(1);` fails it. Both files start with `set lock_timeout = '5s';`, and the PGlite run applies each twice with it.
- **Suites.** `pnpm test:functions` `ok | 58 passed (45 steps) | 0 failed`; `@backseat/supabase` `Tests 132 passed (132)`; `pnpm verify`: supabase 132, site 123, seed-1 77, dispatcher 207, Deno 58 passed (45 steps), `GATE PASS folder=seed-1 lane=code`, `GATE PASS folder=platform lane=code`, `PASS: secret-scan files=299`.


2026-09-20, the two live lines, re-run against production from `main` at ef352a2.

- **Both migrations are applied, and the column split holds.** `scripts/anon-negative-test.ts`, all
  eight lines `ok`: `public_studio`, `public_card_funding` and `public_card_spend` readable;
  `cards(id,title,stage,funded_usd,live_at)` readable; and `cards(actual_usd)`, `cards(severity)`,
  `cards(priority)` and `cards(*)` each refused with `42501 permission denied for table cards`.
- **Every live card has `live_at`.** 6 live cards, 0 with a null `live_at`.
- **An anon realtime subscription still receives changes.** An anonymous client subscribed to
  `postgres_changes` on `cards` received a no-op update within the timeout. It was delivered 27
  columns — `acceptance_test, board_reason, branch, bucket, commit_sha, confidence, created_at,
  design_spec_url, director_stance, estimate_usd, executor_role_id, failing_check, folder,
  funded_usd, funding_target_usd, id, intent, lane, live_at, proposer_role_id, shape, source, stage,
  summary, title, updated_at, veto_reason` — and none of `actual_usd`, `priority` or `severity`.
- **The ledger and the site.** `scripts/ledger-identity.ts`:
  `PASS: ledger identity holds over 1 contribution rows and 0 studio ledger rows`, with I1, I2 and I3
  each at `drift 0.0000`. `platform/site/scripts/live-check.mjs`:
  `PASS live-check https://peanutgallery.games passed=111 failed=0 skipped=0`.

Note on `information_schema.role_column_grants`: it returns 0 rows for `anon` on `cards`, as it did
on 18 September. That is a visibility quirk of the catalog view under this role, not a missing grant
— the direct privilege test above is what proves the split, in both directions.

## Decisions

- 2026-09-16: the open stages are `proposed`, `designing` and `voted`, the stages the site offers for funding. Money that names any other card funds the pool rather than being refused, because the payment has already been taken and the pool is where unassigned money goes.
- 2026-09-16: held money keeps the card it was paid toward. The supporter pledged while the card was open, and changing the release job would move money that the hold rules already settled. Superseded by `money-logic.md` (2026-09-23): released and reinstated credit enters at step 1 of the waterfall.
- 2026-09-16: the backfill turns off the `updated_at` trigger for its one update. Without that, every live card's `updated_at` would become the migration time, and the live site reads `updated_at` as the ship date until the site change lands.
- 2026-09-16: `actual_usd` is withheld because it counts founder-billed turns; `severity` and `priority` because priority 1 is an S1 and the incident list is private until its post-mortem (PLAN.md §4). The card row itself stays public.
- 2026-09-16: the grants name columns, so a new card column is private until granted. A table-level revoke also removes column grants, so the migration can run twice.
- 2026-09-16: the realtime publication is unchanged. Realtime filters change payloads by the subscriber's column privileges and needs the primary key granted, which it is.
- 2026-09-16: the stage is checked when the payment is credited, not when the supporter paid. A payment's credit can come later than the payment: the webhook credits on `charge.updated` when Stripe attaches the fee after `checkout.session.completed` (`stripe-late-fee.md`), and a refund of a payment never credited credits it first. If the named card closes in between, for example because another payment filled its bar, the money funds the pool. Accepted (independent review, 16 September 2026): it can only under-credit the card, never over-credit it; the money stays in the pool, where the dispatcher can spend it; and the webhook branch alerts on a payment whose named card is no longer open.
- 2026-09-16: anon and authenticated lose every table-level privilege on `cards`, not only `SELECT`. On Postgres 17 a `revoke select` would leave `MAINTAIN`, and nothing uses it.
- 2026-09-16: a replay reports the goal card stored on the payment row. A fresh lookup named no card once the card had closed, although the money had gone to it.
- 2026-09-16: `set_live_at` keeps an explicit `live_at` on insert, so a card filed as already shipped keeps its ship time, and stamps a move to live with the current time.
- 2026-09-16: `reverse_contribution` returns `kind_reversed_usd` and `kind_total_usd`, requested by the webhook workstream's review, so the webhook can tell a second event for the same dispute from a dispute after a refund without a second query. The figures are read from values the function already computes; nothing it moves changes.
- 2026-09-16: the site keeps `updated_at` until these migrations are live, and a separate change moves it to `live_at`.
