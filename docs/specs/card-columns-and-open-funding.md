# Card columns and open funding

Status: agreed. Card: none. Owner: board.

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
- Money that names a card in any other stage, or a card that is not a goal, funds the pool as if it named none. Its row's `goal_card_id` is null, and the result's `goal_card_id`, `goal_stage` and `goal_funded_usd` are null.
- A `proposed` or `voted` card that reaches its target still moves to `funded`. A `designing` card is credited and keeps its stage.
- Money already held for a card that was open when it was paid still reaches that card's bar when the hold is released, whatever the card's stage by then. The payment row carries the card id, and `credit_held_contributions` credits the card named on the row without checking its stage (`refunds-and-holds.md`). The pledge was made while the card was open.
- The split, the daily hold, the lock order and every reversal figure are unchanged.

**Reversal result.** `reverse_contribution` returns four more figures, with no change to what it moves:
- `pool_reserve_usd` and `pool_incident_reserve_usd`, read from the pool row after an inserted reversal. A refund can leave the 10% reserve below zero, and the figure shows it.
- `kind_reversed_usd`: what this payment had already reversed for the call's kind (refund or dispute) before the call.
- `kind_total_usd`: the kind's cumulative total the call asked for, rounded to four places.
- Both kind figures are returned when a reversal is inserted and when nothing is left to reverse (not on a replay of the same event id). With nothing left, `kind_reversed_usd >= kind_total_usd` means this kind already reversed it, for example the other event for the same dispute; a smaller `kind_reversed_usd` means the other kind took it, for example a dispute after a full refund.

**Ship stamp.**
- `cards.live_at` is set to the current time when a card is inserted at `live` or its stage changes to `live`.
- An update that leaves the stage alone, sets `live` again on a live card, or moves money onto its bar keeps the stamp. A card that leaves `live` keeps its stamp until it ships again, which stamps it again.
- The migration stamps each card already live with the time of its last `ship` agent event, or its `updated_at` when it has none. The backfill leaves `updated_at` as it was.

**Public columns of cards.**
- Anon and authenticated may select these columns of `cards` and no others: `id`, `bucket`, `source`, `shape`, `lane`, `board_reason`, `folder`, `executor_role_id`, `title`, `summary`, `intent`, `acceptance_test`, `design_spec_url`, `funding_target_usd`, `funded_usd`, `estimate_usd`, `confidence`, `proposer_role_id`, `director_stance`, `veto_reason`, `stage`, `branch`, `commit_sha`, `failing_check`, `created_at`, `updated_at`, `live_at`.
- `actual_usd`, `severity` and `priority` are withheld, and `select *` is refused because it names them.
- A column added to `cards` later is private until a migration grants it.
- The site's card queries name only granted columns (`source.ts` selects `id,title` and `id,title,summary,intent,source,stage,shape,bucket,folder,funding_target_usd,funded_usd,created_at,updated_at`, filters on `stage` and orders by `created_at`).
- No view in `public` reads `cards`. Every function authenticated may run is security definer, so the board's RPCs read `cards` with the owner's rights. The dispatcher, the webhook, `deploy.sh` and the filing scripts use the service role, which keeps its table-level grant.
- The realtime publication still carries `cards`. Supabase Realtime filters the columns of each change by the subscriber's select privilege and needs the primary key to be selectable. `id` is granted, and the site ignores payloads and reloads on any change. Both are to be probed live, because the PGlite test has no Realtime.

## Acceptance criteria

- [x] A payment naming a `live`, `funded` or `building` goal card funds the pool by its full credit, its row's `goal_card_id` is null, and the card's `funded_usd` and `estimate_usd` do not move.
- [x] A payment naming a `designing` goal card raises its bar and leaves it at `designing`.
- [x] A second payment to a voted card that the first payment funded goes to the pool, and the card's bar stays where the first payment left it.
- [x] `apply_contribution` and `reverse_contribution` in the new migration equal their refunds-and-holds definitions apart from the goal lookup and the lines that return the reserves and the kind's totals.
- [x] A hold paid while a card was open is released onto the card's bar after the card has gone live.
- [x] `reverse_contribution` returns the pool's reserve and incident reserve after the update, including a reserve below zero.
- [x] `reverse_contribution` returns `kind_reversed_usd` and `kind_total_usd` on insert and when nothing is left: a second dispute event with the same total returns `kind_reversed_usd >= kind_total_usd`, and a dispute after a full refund returns `kind_reversed_usd` 0.
- [x] Below the incident cap at a 20% studio share, a refund row carries negative shares in the payment's proportions, the balance and the bar fall by the agents' credit share, and a dispute for the rest is covered by the reserve. The identity offsets do not move.
- [x] A refund before a hold's release cancels part of the hold, the release credits the rest, and refunds after it return every column of the payment to zero with the identity offsets unchanged.
- [x] A dispute on a payment with money still held cancels the held part and the reserve covers only the credited part.
- [x] A payment timestamped one second before New York midnight does not count toward today's cap; one timestamped at midnight does.
- [x] `live_at` is stamped on the move to live and on an insert at live, is kept by other updates and a hold release, and is stamped again after the card leaves live and returns.
- [x] The backfill stamps a live card with its last ship event, a live card without one with its `updated_at`, leaves a card that is not live unstamped, keeps existing stamps and leaves `updated_at` alone. Both card triggers are enabled afterwards.
- [x] `information_schema.column_privileges` lists exactly the granted columns for anon and authenticated, and neither holds a table-level privilege on `cards`.
- [x] As anon, `select id, title, live_at from cards` works and `select actual_usd`, `select severity`, `select priority` and `select *` are refused with "permission denied".
- [x] No view reads `cards`, and `set_live_at` and `set_updated_at` are the only functions in `public` that are not security definer. Neither is executable by anon or authenticated.
- [x] The realtime publication still lists `cards`, `deploys` and `pool`.
- [x] `scripts/anon-negative-test.ts` reads `cards` with `select=id,title,stage,funded_usd,live_at` and expects `actual_usd`, `severity`, `priority` and `*` refused with 42501.
- [ ] Live: both migrations are applied, anon's column privileges on `cards` are the granted list, every live card has `live_at`, and `anon-negative-test.ts` and `ledger-identity.ts` print `PASS:`.
- [ ] Live: an anon realtime subscription to `cards` still receives changes.

## Verification

- `pnpm test:functions`
- `pnpm --filter @backseat/supabase test`
- `pnpm --filter @backseat/supabase typecheck`
- `pnpm --filter @backseat/site test` (unchanged)
- `pnpm verify` at the repository root.
- The production steps below, once the board allows them.

## Production steps (need the board's allow)

1. Apply `20260921000000_open_goal_funding.sql`, then `20260921000100_public_card_columns.sql`, through the Management API query endpoint.
2. `select column_name from information_schema.column_privileges where grantee='anon' and table_name='cards' and privilege_type='SELECT' order by 1;` returns the 27 granted columns.
3. `select id, stage, live_at from cards where stage='live';` shows a `live_at` on every row.
4. `pnpm --filter @backseat/supabase exec tsx scripts/anon-negative-test.ts` and `scripts/ledger-identity.ts` both print `PASS:`.
5. Probe realtime payloads as anon: subscribe to `postgres_changes` on `cards` with the anon key, change a card as the service role, and check that the change arrives, carries `id`, and has no `actual_usd`, `severity` or `priority`.
6. Only then merge the site change that reads `live_at`.

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

## Decisions

- 2026-09-16: the open stages are `proposed`, `designing` and `voted`, the stages the site offers for funding. Money that names any other card funds the pool rather than being refused, because the payment has already been taken and the pool is where unassigned money goes.
- 2026-09-16: held money keeps the card it was paid toward. The supporter pledged while the card was open, and changing the release job would move money that the hold rules already settled.
- 2026-09-16: the backfill turns off the `updated_at` trigger for its one update. Without that, every live card's `updated_at` would become the migration time, and the live site reads `updated_at` as the ship date until the site change lands.
- 2026-09-16: `actual_usd` is withheld because it counts founder-billed turns; `severity` and `priority` because priority 1 is an S1 and the incident list is private until its post-mortem (PLAN.md §4). The card row itself stays public.
- 2026-09-16: the grants name columns, so a new card column is private until granted. A table-level revoke also removes column grants, so the migration can run twice.
- 2026-09-16: the realtime publication is unchanged. Realtime filters change payloads by the subscriber's column privileges and needs the primary key granted, which it is.
- 2026-09-16: `reverse_contribution` returns `kind_reversed_usd` and `kind_total_usd`, requested by the webhook workstream's review, so the webhook can tell a second event for the same dispute from a dispute after a refund without a second query. The figures are read from values the function already computes; nothing it moves changes.
- 2026-09-16: the site keeps `updated_at` until these migrations are live, and a separate change moves it to `live_at`.
