# Launch DB: schema, money rules, webhook payer key, backlog parser

Status: built. Card: none. Owner: board.

## Problem

The launch plan (workstream B, with the audit amendments) needs the database to carry what the other workstreams build against: card horizons for the backlog, board RPCs for caps, horizons, cancelling, resuming and credit purchases, a dispatcher lease, stored patches, overhead billing and a public roles view. It also found money holes: the $50 daily window keys on email only, a parked card can strand supporters' money, a refund of spent money silently leaves waiting cards short, `founder_credit` can still raise the pool, and the per-card maximum caps funding targets that Kyle wants uncapped.

## Scope

In: six migrations (`20260922000000` to `20260922000500`), the webhook's payer key and shortfall alert, the role `description` field (agent JSON, README schema, parser, seed), `scripts/file-backlog.ts` and its parser, `scripts/ledger-identity.ts` and `scripts/anon-negative-test.ts`, and their tests.
Out: the site (SITE), the dispatcher's use of the lease, the credit bound and the patches (DISPATCHER, MANAGED), `docs/BACKLOG.md` and the docs (DOCS), the production cards (LIVE CARDS), and every production step, which the orchestrator runs with the board's allow.

## Behaviour

- **Migrations, in order, each re-runnable.** `000000` adds the ledger label `overhead` and nothing else, so no file uses it in the transaction that adds it. `000100` money fixes, `000200` the dispatcher lease and stored patches, `000300` horizons and the board's card controls, `000400` `public_roles` and the public pause. `000500` closes `roles` to anon and authenticated and is applied only after the site reads `public_roles`. Every new argument is defaulted and every new column nullable or defaulted, so the deployed site, webhook and dispatcher keep working between merges.
- **Overhead.** `record_usage(..., p_billed_to => 'overhead')` records spend on the studio's key that belongs to no card: the unattended startup probe. It names no card, and it leaves the pool, the day's spend and the incident reserve alone because the studio share pays it. Anon reads studio and overhead rows and never founder rows; `public_ledger_totals` keeps its studio-only columns and gains `overhead_usd`.
- **Payer key.** Each payment records `payer_key`: `card:` and a SHA-256 of the card's Stripe fingerprint, read from the charge the webhook already expands for the fee, or `email:` and the contributor id when there is no card (Link, buy-now-pay-later). Existing payments are backfilled with their email key. The $50 window counts every payment today that shares the payer key or the contributor id, so neither a second email nor a second card opens a second $50.
- **Studio-wide room.** Immediate credit is also bounded by `studio_state.credit_studio_daily_cap_usd` (default $500) across all payments today; the rest is held like any other hold.
- **Horizons.** `cards.horizon` is `now`, `next` or `later` (default `now`) with `cards.rank`; anon reads both. A payment credits a card's bar only while it is open and on `now`; a released hold moves a card to funded only on `now`.
- **Board RPCs.** `set_caps`, `record_credit_purchase`, `set_card_horizon`, `cancel_card`, `resume_card` and the twelve-argument `file_card` each refuse anyone but a board member (a moderator included, at aal1 or aal2), then a session without the second factor, and each writes a `board_actions` row with the board's reason. Anon cannot execute them.
  - `set_caps` changes the daily cap, per-card maximum, hourly rate, monthly cap and studio-wide room; a null argument leaves a cap alone. Caps are zero or more and at most $10,000, the rate is above zero, and the per-card maximum fits inside the daily cap, which fits inside the monthly cap.
  - `record_credit_purchase` records Console credit the board bought. `board_studio_state` returns every cap and the credit bought and spent.
  - `set_card_horizon` moves an open card between horizons or re-ranks it. A move off `now` is refused while the card has money on its bar or on hold. A move to `now` takes a target and may supply the acceptance test, executor, lane and intent, and the card must then meet the definition of ready. The platform code lane is refused on `now`.
  - `cancel_card` rejects a proposed, designing, voted, funded or paused card; a building or gated card is refused with the instruction to pause the studio first.
  - `resume_card` sends a paused card on `now` back to funded with an estimate of at least its cost so far.
  - `file_card` takes `p_horizon` (default `now`); its target is no longer capped by the per-card maximum, which stays the per-card spend ceiling. The eleven-argument signature is dropped.
- **Lease and patches.** `claim_dispatcher_lease(p_holder, p_ttl_seconds)` returns true when the lease was free, expired or already held by `p_holder`; `release_dispatcher_lease(p_holder)` frees it. `card_patches` keeps each submitted patch with its base sha, a checked SHA-256 and byte count. Both are for the service role only.
- **Refund shortfall.** `reverse_contribution` also returns `earmarked_usd` (money on the bars of funded, voted and paused cards, less their studio spend) and `shortfall_usd`; the webhook's board alert says when waiting cards are left short and by how much. The reversal arithmetic is unchanged: money that names no card goes first.
- **Public views.** `public_roles` (id, name, title, description, species_note, avatar_url, model, write_access, state, hired_at) and `public_studio` (launched_at, paused) are readable by anon and not writable. `founder_credit` is gone.
- **Roles.** Every role JSON carries a one-sentence `description`; Host, Scout and Community say they are not running yet. The seed writes it to `roles.description`.
- **Backlog.** `scripts/file-backlog.ts` parses `docs/BACKLOG.md` in the fixed format, dry run by default, and with `--apply` inserts each entry as a board goal card at proposed on its horizon with no target, or updates the planned card with that title. A card the board has moved to `now` or past proposed is left alone.

## Acceptance criteria

- [x] The six migrations apply in order on PGlite, each run twice in a row, and upgrade a database holding payments, cards and roles in production order.
- [x] `founder_credit` does not exist.
- [x] An overhead row leaves the pool, the day's spend and the incident reserve unchanged, is refused with a card, is readable by anon and counted in `overhead_usd`; a founder row is invisible to anon.
- [x] One card across two emails, and one email across two cards, share $50; a payment with no fingerprint keys on the email; the deployed webhook's eight named arguments still credit.
- [x] The studio-wide room holds what is left once it is used.
- [x] A card on `later` takes no credit; a release never moves a card off `now` to funded.
- [x] A target above the per-card maximum is accepted; `file_card` refuses the platform code lane on `now`; only the twelve-argument `file_card` exists.
- [x] `set_card_horizon` refuses a move to `now` without a target or any definition-of-ready field, refuses parking a card with money on its bar or on hold, allows parking a voted card with none, and records the move.
- [x] `cancel_card` rejects the five allowed stages and refuses building, gated, live and rejected cards.
- [x] `resume_card` refuses an estimate below the card's cost and resumes with one above it.
- [x] `set_caps`, `record_credit_purchase`, `set_card_horizon`, `cancel_card`, `resume_card` and `file_card` refuse a moderator at aal1 and aal2, an outsider, a board session at aal1 and anon.
- [x] `set_caps` keeps the caps within their bounds and records the reason; `record_credit_purchase` records the purchase and `board_studio_state` reports credit bought and spent.
- [x] The dispatcher lease has one holder at a time, renews, expires to the next claimant, and anon and authenticated can neither call it nor touch the table.
- [x] `card_patches` refuses a patch whose digest or length is wrong, and anon and authenticated cannot read it.
- [x] Anon reads `public_roles`, `public_studio.paused` and `cards.horizon, rank`, cannot read `paused_by`, `roles` (after `000500`), `board_actions`, `credit_purchases`, `dispatcher_lease` or `card_patches`, and cannot write through `public_roles`.
- [x] A refund of spent money reports the shortfall of the waiting cards, and the board alert says so.
- [x] The webhook reads the fingerprint from the same retrieve as the fee, for card and wallet payments, and none for Link.
- [x] Every role JSON has a description; the three roles without write tools say they are not running yet; the parser and seed carry it.
- [x] The backlog parser reads the fixture and refuses every malformed entry; the planner inserts, updates, leaves unchanged and skips as described.
- [x] The ledger identity leaves overhead and founder rows out.
- [ ] Production: the migrations applied, the webhook deployed, anon-negative-test and ledger-identity PASS (production steps below).
- [ ] `set_caps` and `set_card_horizon` called from /board in production (waits on: the board's TOTP).
- [ ] A credit purchase recorded with `record_credit_purchase` (waits on: Console credit).
- [ ] An overhead row written by the unattended probe (waits on: the cutover).

## Verification

- `pnpm verify`
- `pnpm test:functions`: the PGlite steps named in Evidence and the upgrade test.
- `pnpm --filter @backseat/supabase test`
- `pnpm test:agents`
- `pnpm --filter @backseat/supabase exec tsx scripts/anon-negative-test.ts --before-roles-revoke` after `000400`, and without the flag after `000500`: PASS.
- `pnpm --filter @backseat/supabase exec tsx scripts/ledger-identity.ts`: PASS.
- `pnpm --filter @backseat/supabase file-backlog` (dry run): counts per horizon and folder match `docs/BACKLOG.md`.
- /board: `set_caps` and `set_card_horizon` succeed at aal2 (waits on: the board's TOTP).
- /board: `record_credit_purchase` after the first purchase (waits on: Console credit).
- The unattended probe writes an overhead row and the pool is unchanged (waits on: the cutover).

## Production steps (need the board's allow)

Before each apply, pause the studio from /board and make sure no dispatcher is running on the Mac.

1. After this pull request merges: apply `20260922000000_ledger_overhead.sql`, `20260922000100_money_fixes.sql`, `20260922000200_dispatcher_lease.sql`, `20260922000300_backlog.sql` and `20260922000400_public_roles.sql` through the Management API query endpoint, one request per file, in that order. Do not apply `000500` yet.
2. Deploy the webhook from `platform/`: `npx supabase functions deploy stripe-webhook --project-ref lyxndueoeisyqzewflpu --use-api`.
3. Run `pnpm --filter @backseat/supabase exec tsx scripts/anon-negative-test.ts --before-roles-revoke` and quote PASS.
4. After the site that reads `public_roles` is deployed and its live check passes: apply `20260922000500_roles_revoke.sql`, then run `anon-negative-test.ts` without the flag and quote PASS.
5. After `docs/BACKLOG.md` is on `main` and the site lists only cards on `now` as open: `pnpm --filter @backseat/supabase file-backlog`, quote the counts, then `pnpm --filter @backseat/supabase file-backlog -- --apply` and quote the result.
6. After the env edits: `pnpm --filter @backseat/supabase seed` to write the role descriptions, then `pnpm --filter @backseat/supabase exec tsx scripts/ledger-identity.ts` and quote PASS.

## Evidence

`pnpm verify` at the head of this branch exits 0; its last lines:

```
GATE PASS folder=platform lane=code
$ bash platform/gate/secret-scan.sh --tracked
PASS: secret-scan files=332
$ node --test docs/docs.test.mjs
ℹ tests 4
ℹ pass 4
ℹ fail 0
```

`pnpm test:functions`:

```
running 2 tests from ./platform/supabase/functions/_shared/migration_test.ts
migrations on PGlite ...
  founder_credit is gone, so nothing but a customer payment raises the pool ... ok
  an overhead row is public, names no card and leaves the pool alone, and a founder row stays private ... ok
  the board files Next cards, stamps the launch, sets the agent mode and reads studio_state ... ok
  every board RPC added for launch refuses a moderator at aal1 and aal2, an outsider, a board session without the second factor, and anon ... ok
  set_caps changes only the caps it names, within their bounds, and records the board's reason ... ok
  record_credit_purchase records Console credit the board bought, and /board reads credit bought and spent ... ok
  anon and authenticated read public_roles, the pause and every card's horizon and rank, and not roles, the lease or the patches ... ok
  the $50 window keys on the card and the email: one card across two emails, or one email across two cards, shares $50 ... ok
  the studio-wide room on immediate credit holds what is left once the day's room is used ... ok
  a card off now takes no credit, and a card moves to now only when it meets the definition of ready ... ok
  cancel_card rejects a card no agent is working on, with the board's reason, and refuses the rest ... ok
  resume_card sends a paused card back to funded with an estimate of at least what it has cost ... ok
  a refund of money already spent leaves waiting cards short, and reverse_contribution says by how much ... ok
  the dispatcher lease has one holder at a time, and only the service role can take it ... ok
  card_patches keeps a submitted patch only with its true digest and length, for the service role only ... ok
migrations on PGlite ... ok
the launch migrations upgrade a live database in production order ...
  the schema before launch holds a payment, a card and a role ... ok
  000000 to 000400 apply one file at a time, and the old callers keep working ... ok
  000500, once the site reads public_roles, closes roles to anon and leaves public_roles open ... ok
a card payment keys the $50 window on its hashed fingerprint, and a Link payment on the email ... ok
the reversal message says when waiting cards are left short, and by how much ... ok
a card payment's fingerprint comes from the same expanded charge as the fee ... ok
an Apple Pay or Google Pay payment is a card payment, read the same way ... ok
a Link payment, or any method without a card, has no fingerprint and still has its fee ... ok
payerKey is card: and the hashed fingerprint, or email: and the contributor id ... ok
ok | 79 passed (63 steps) | 0 failed
```

`pnpm --filter @backseat/supabase test` (static migration tests, backlog parser and planner, role parser, ledger identity):

```
 Test Files  12 passed (12)
      Tests  184 passed (184)
```

`pnpm test:agents`:

```
ℹ tests 67
ℹ pass 67
ℹ fail 0
```

## Decisions

- 22 September 2026: the migrations re-run test runs each file twice in a row, as a retried apply does, instead of re-running the whole list after the last file. `public_studio` gains a column, and Postgres refuses to replace a view with fewer columns, so an older file can no longer run after a newer one; production never does that.
- 22 September 2026: a released hold still credits the bar of the card the payment named, whatever its stage, and only the move to funded requires horizon `now`. Sending a release to the pool would take a later refund off a bar that never held the money (audit F29), and the 16 September decision keeps held money with its card. `set_card_horizon` refusing to park a card with money on hold keeps held money off parked cards.
- 22 September 2026: $10,000 is the upper bound on caps, targets, estimates and credit purchases, as a guard against a mistyped amount; it is not a policy limit.
- 22 September 2026: a card needs a `check:` line in its acceptance test to move to `now`, whatever its lane, as the definition of ready says; `file_card` keeps its existing rule (a check line on the config lane only).
- 22 September 2026: the payer key is prefixed and the window matches the payer key or the contributor id, so one email with several cards, and one card with several emails, each share $50 (audit F30).
- 22 September 2026: planned backlog cards are filed on the code lane; the board sets the lane with `set_card_horizon` when a card moves to `now`.
