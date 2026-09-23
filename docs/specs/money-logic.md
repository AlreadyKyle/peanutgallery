# Money logic: one waterfall, allocations, supporter numbers, the terms stamp and the fees Stripe keeps

Status: built. Card: none. Owner: board.

Part of the launch series, built on the merge of legal-copy (the order and each spec's status are in `docs/ROADMAP.md`, "The launch series"). The cross-PR contracts it relies on are in its Decisions under "Reconciled with the series".

## Problem

`apply_contribution` credits only the card a payment names in `client_reference_id`, with no cap, and only while that card is proposed, designing or voted. "Pick for me" money, and money beyond a card's target, sits in the pool and funds nothing unless the board steps in (PG-01). Nothing records which cards a payment reached, so a refund can only come off the card the payment named.

A card that ships under budget, or is rejected, keeps its unspent money on its bar, and `cancel_card` refuses any card that holds money, so the published wind-down rule cannot run. The dispatcher can also spend money that no bar holds: a card's ceiling is 150% of its estimate, a directive has no bar, and metering can arrive after a card ships. Nothing counts that money.

Stripe keeps its processing fee on every refund and dispute, but `reverse_contribution` takes the net off pro rata. After the first refund (the board's own $1 test payment included), the Controller's `stripe_costs_booked` check fails on every run.

Supporters get no number (PG-05). No payment records the Terms version it was given under, so a Terms change cannot be limited to new money (L03, L12). Nothing public says:
- the order money fills cards in;
- what money came in;
- whether the books reconcile with Stripe;
- where a stopped card's money went;
- why the studio is paused (R14, L02, L04).

## Scope

In:
- **One migration**, `platform/supabase/migrations/20260924200000_money_logic.sql`, after legal-copy's `20260924100000_terms_versions.sql`. It holds:
  - a `money` schema the API does not expose, for the internal helpers;
  - `contribution_allocations`, the waterfall and the one predicate that decides which cards take money;
  - spend attribution (a card's oldest money is spent first), the refund unwind, the card release, the drain, and `waterfall_sweep()` on pg_cron;
  - the fee Stripe keeps, booked on every refund and dispute row, and `record_stripe_fee` for dispute fees;
  - `supporters`, `contributions.requested_card_id` and the `contributions.terms_version` stamp;
  - `board_test_payments`, keeping the board's test payment apart;
  - `apply_contribution`, `reverse_contribution`, `credit_held_contributions`, `record_dispute_reinstated`, `record_adjustment` and `cancel_card` routed through the waterfall;
  - `studio_state.pause_reason` and `set_paused(p_paused, p_reason)`;
  - append-only triggers on the new tables, identity lines I4 and I5, and a closing identity check;
  - a `board_test` flag in `controller_figures`;
  - the public reads: `public_money`, `public_card_funding`, `public_stopped_cards`, `public_studio.pause_reason`.
- **The webhook** passes the Checkout Session's `created` time.
- **The Controller** books dispute fees through `record_stripe_fee` and leaves the board's test payment out of the agent money a credit purchase may use.
- **The dispatcher**: `pauseStudio` writes its reason.
- **`ledger-identity.ts`** (lib and script) with I4 and I5, and **`anon-negative-test.ts`** covering the new tables, functions and views.
- **The board site**: the cancel confirmation and a reason picker on Pause.
- **Docs**: PLAN.md §4 Funding a card, §5 Refunds and disputes, §6 Build 1, one §10 decision and Appendix A; ROADMAP.md; the superseded criteria struck through in `card-columns-and-open-funding.md`, `launch-db.md` and `refunds-and-holds.md`; BOARD-SETUP step 12.

Out:
- **Showing it on the public site**: `money-surfaces.md`.
- **Later pages**: /thanks, /card/:id and the supporter lists (supporter-pages).
- **An operations bucket.** There is no operations share until a percentage exists. When one does, a new spec adds the bucket as a waterfall step with the Terms version that introduces it. Until then, operations work is billed `overhead`, which the pool does not pay.
- **Agent-system-core's additions** to `money.card_takes_money` (the board's veto and a current approval).
- **Legal-copy's part**: `terms_versions`, `terms_version_at` and the Terms and Refunds wording.
- **A wind-down read** (per-payment unspent money for shutdown refunds). The allocations hold everything it needs; it is written when a wind-down is attended.
- **Any Stripe request**, including a synthetic webhook event.

## Behaviour

**Credit.** A payment's credit is as today: the agents' share, less the incident carve-out, less any hold. Held money once its hold is released, a won dispute's reinstatement and a board adjustment's agents amount are credit too. One waterfall places every piece of credit, and each placement is a row in `contribution_allocations` naming the payment the money belongs to.

**Which cards take money.** One predicate, `money.card_takes_money`, is used by every step and by the public funding order. A card takes money when all of these hold:
- it is a goal card on horizon now, with a target above zero and room under it;
- its stage is proposed, designing or voted, or it is funded but below its target (after a refund);
- the dispatcher could start it once funded: it is not vetoed, its source is board, agent or decision, it has an executor, and it is not in the closed platform code lane (`runnable()` in `platform/dispatcher/src/select.ts`).

**The waterfall.** Credit goes, in order:
1. to the card the payment named, up to its target, if that card takes money;
2. to the cards that take money, in the Studio Head's rank order (rank ascending, unranked last, then oldest, then id), each up to its target;
3. whatever is left, to Not on a card yet.

A card whose bar reaches its target moves from proposed or voted to funded. A payment naming a card that takes no money records it in `requested_card_id`, names no card in `goal_card_id`, and starts at step 2.

**The terms stamp.** A new payment is stamped with the latest Terms version posted at or before its Checkout Session's `created` time, through legal-copy's `public.terms_version_at`. The time comes from Stripe (the signed event's session, or for `charge.updated` the session the webhook retrieves), never from the client. A future time counts as now. With no time, or no posted version, nothing is stamped.

**Spend.** A card's studio-billed spend uses its oldest money first. A payment's unspent money on a card is its allocation there less its share of that spend. Attended builds are billed to the founder and spend none of a bar.

**Refunds and disputes.** A refund or dispute takes its credit off that payment's own allocations, newest first, from every card it reached and from Not on a card yet. Each place gives up only that payment's unspent money there. The rest is money already spent: it comes off Not on a card yet, which can go below zero. The reserve cover and the cancelling of held money are unchanged.

**The fees Stripe keeps.** Stripe returns none of its processing fee on a refund or dispute. A refund or dispute row takes off the whole amount reversed as its net, and the fee part (the amount reversed less its pro-rata share of the payment's net) comes off the studio share, so no supporter's money covers it. A won dispute's reinstatement puts the whole row back. Stripe's dispute fee is booked by the Controller through `record_stripe_fee`, once per balance transaction; a returned dispute fee is booked back the same way. The Controller's per-payment check then balances with nothing for the board to do.

**Not on a card yet** is the pool balance less every card's unspent bar, less the board's test money. Below zero it is a shortfall: money the studio spent that no bar held (an overrun up to a card's 150% ceiling, a directive, late metering, or a refund of spent money). `reverse_contribution`'s `shortfall_usd` is this figure; the old earmarked calculation is removed. The drain never moves more than Not on a card yet, less the studio reserve, less what building cards can still draw beyond their bars up to their ceilings, so it never puts spent money on a bar.

**The sweep.** `waterfall_sweep()` runs every five minutes on pg_cron. It moves a live or rejected card's unspent money back in at step 2, newest money first; moves a proposed or voted card on now whose bar is at its target to funded; and drains Not on a card yet onto the cards that take money, oldest payment first.

**Cancelling.** `cancel_card` now cancels a proposed, designing, voted, funded or paused card that holds money. It is rejected with the board's reason and its unspent money moves at once to the next cards in line. A building or gated card is still refused. A payment still on hold for it enters at step 2 when released.

**The board's test payment.** The board paid $1 of its own on 15 September 2026, session `cs_live_a1OkB7xDSosjVf25TF8aNhbzy8PoWHrjEpeRGDtUSMaFK0tG0NU5Zl5oOh`, still unrefunded on 23 September 2026. That session is the one row of `board_test_payments`. Its credit ($0.5019) is placed on `board_test`, never on a card or in Not on a card yet; it gets no supporter number; it is in no money-in figure; the Controller leaves it out of the agent money a credit purchase may use; its refund takes it off. The board refunds it before the cutover (BOARD-SETUP step 12).

**Supporter numbers.** Each contributor, identified by the hashed receipt email, gets one number at their first payment, from 1 with no gaps, and keeps it. It is a founding number when `launched_at` is unset or later than that payment's Checkout Session time (else the row's own time). There is no name and no free text.

**Why the studio is paused.** `studio_state.pause_reason` is one of `awaiting_credit`, `spend_limit`, `incident` or `board`. `set_paused` takes an optional reason, `board` by default; the board site offers all four. The dispatcher writes its own: Console credit needed is `awaiting_credit`, the usage tier cap is `spend_limit`, a failed revert is `incident`. A pause written with no reason is `board`. Resuming clears it. The migration backfills production's pause as `awaiting_credit` while `launched_at` is null and no Console credit purchase is recorded, else `board`. It never says who paused or when.

**Guards.** `contribution_allocations`, `supporters` and `board_test_payments` are append-only like the other money tables, and service_role can only read them. Every function that places money takes one transaction-scoped advisory lock, then locks the cards it may touch in id order, then the pool (`record_usage` locks one card then the pool, so they cannot deadlock). The migration ends by checking `ledger_identity()` and rolls back entirely if it does not hold.

**The ledger identity** gains I4 (every payment's allocations equal its family's credit) and I5 (every card's bar equals its allocations). `ledger-identity.ts` checks the same lines. A shortfall is not an identity failure: it is reported in `public_money` and the webhook's existing shortfall alert.

**Public reads.** Each is select-only for anon, and none names a contributor, an email, a name, a session or a supporter's single payment.

`public_money` is one row. The money-in columns are over contribution rows whose family is not the board's test payment (PLAN §10 decision 23):
- `payments` = count(*) where entry = 'payment';
- `received_usd` = sum(amount_usd) where entry = 'payment';
- `stripe_fees_usd` = sum(amount_usd − net_usd) where entry <> 'adjustment', plus sum(−net_usd) over Stripe fee rows (entry = 'adjustment' with a `stripe_event_id`);
- `refunded_usd` = −sum(amount_usd) where entry = 'refund';
- `disputed_usd` = −sum(amount_usd) where entry in ('dispute', 'reinstated');
- `corrections_usd` = sum(net_usd) over the board's adjustments (entry = 'adjustment' with no `stripe_event_id`);
- `studio_pct_avg` = sum(studio_pct_chosen × net_usd) / sum(net_usd) over payment rows, rounded to 2 places, null with no payment;
- `reserve_usd`, `studio_usd`, `incident_usd`, `held_usd`: each column's sum;
- `agent_credit_usd` = sum(agents_usd − incident_usd − held_usd);
- `not_on_card_usd` and `short_usd`: the positive and negative parts of Not on a card yet;
- `board_test_usd`: the board's own test payment's credit, shown apart;
- `reconciled_at` and `last_run_ok`: the latest reconcile run's finish time when it passed (else null), and whether it passed (null before the first run);
- `funding_order`: the cards step 2 fills, in order, with their room, as a jsonb array of `{position, card_id, room_usd}`.

They add up: received − fees − refunded − disputed + corrections = reserve + studio + incident + held + agent credit.

The other reads:
- `public_card_funding (card_id, contributors, credited_usd, on_card_usd)`. A payment's money on a card is every positive allocation there less the unwinds there; money released on to other cards still counts, so a shipped card keeps its funders. A contributor counts while one of their payments that reached the card counts (`money.payment_counts`: not the board's test payment, not fully reversed). `on_card_usd` is the bar.
- `public_stopped_cards (card_id, title, stage, failing_check, spent_usd, funded_usd, credited_usd, moved, stopped_at)`: the rejected and paused cards on now; for a rejected card, `moved` lists where its money went (a card with its title, or null for Not on a card yet) and how much.
- `public_studio.pause_reason`: null while the studio is not paused.

## Acceptance criteria

Migration:
- [ ] The migration applies on PGlite after every earlier file. On a fixture in production's state of 23 September 2026 (one unrefunded board test payment, every bar $0, paused by the board, `launched_at` null, no credit purchase) it books $0.5019 to `board_test`, creates no supporter, sets `pause_reason` to `awaiting_credit`, and `ledger_identity()` holds. A drift forged before the apply makes the whole migration roll back.
- [ ] After the migration, the deployed webhook's call with nine named arguments and the deployed board site's `set_paused({p_paused})` still resolve.

The waterfall:
- [ ] `money.card_takes_money` is false for a vetoed card, a community card, a card with no executor, a platform code card in the closed lane, a full card, a card off now, and a live, building, gated, rejected or paused card; it is true for a proposed, designing or voted card with room and for a funded card below its target. `public_money.funding_order` lists exactly the cards that take money, in rank order (unranked last, then oldest, then id), with their room.
- [ ] A payment naming a card that takes money credits it up to its target; the rest fills `funding_order`'s cards in order, each up to its target; the remainder goes to Not on a card yet. Each placement is one allocation row, a payment's rows sum to its credit to 0.0001, and a proposed or voted card whose bar reaches its target is funded.
- [ ] A payment naming no card starts at step 2. A payment naming a card that takes no money starts at step 2, with `requested_card_id` set to that card and `goal_card_id` null.
- [ ] Released held money and a won dispute's reinstatement enter at step 1, or at step 2 when their card no longer takes money (a cancelled card included); a positive board adjustment enters at step 2 and a negative one unwinds.

Spend, refunds and releases:
- [ ] A card with payments of $1 then $2 that spends $1.50 leaves the first payment $0 unspent there and the second $1.50.
- [ ] A refund or dispute unwinds only that payment's allocations, newest first, each place giving up only that payment's unspent money there, and the spent remainder comes off Not on a card yet and is returned in `shortfall_usd`. A refund of a Pick for me payment, of an overflow payment, and of a payment whose money was released, moved by a cancellation or reinstated each lowers every bar it reached by exactly its unspent allocation there, and no bar goes below zero.
- [ ] `waterfall_sweep()` is scheduled every five minutes. It moves a live or rejected card's unspent money in at step 2, newest money first (a live card with studio spend releases only its unspent part); it makes a designing card that filled funded once it is voted; it drains Not on a card yet onto cards that take money, oldest payment first; a second sweep with nothing new moves nothing.
- [ ] `cancel_card` cancels a proposed, designing, voted, funded or paused card that holds money: the card is rejected, its unspent money moves at once to the next cards in line, and the result returns the amount moved. It still refuses building and gated cards.

Not on a card yet:
- [ ] Not on a card yet equals the pool balance less the unspent bars and the board test money. A card spending past its bar, a directive's spend and metering after a release each lower it; below zero its negative part is `public_money.short_usd`, equal to `reverse_contribution`'s `shortfall_usd`, which no longer returns `earmarked_usd`. The drain never moves more than Not on a card yet less the studio reserve less building cards' remaining ceiling beyond their bars, so after an overrun a newly opened card receives only what is left.

The fees Stripe keeps:
- [ ] A refund or dispute row's net is minus the whole amount reversed, the fee part comes off the studio share, and net = reserve + agents + studio still holds. For the production test payment ($1.00, net $0.7338), a full refund's row has net −1.0000 and studio −0.3983. A reinstatement puts the whole row back.
- [ ] `record_stripe_fee` books a dispute fee as net −fee and studio −fee once per balance transaction (a replay inserts nothing; a negative fee books it back), and the Controller calls it for every dispute fee Stripe reports. On fixtures built from the database's rows, `stripe_costs_booked` passes after a partial then a full refund, and after a dispute, its reinstatement and its fee.

The terms stamp:
- [ ] `apply_contribution` stamps the latest version posted at or before the session's `created` time, treats a future time as now, and stamps null with no time or no posted version; no argument lets a caller choose a version. The webhook sends `p_session_created_at` from the session's `created` for both `checkout.session.completed` and `charge.updated`.

The board's test payment:
- [ ] The board's test payment reaches no card and not Not on a card yet (through drains, releases and sweeps), gets no supporter number, is in no money-in column of `public_money` (on the production-shaped fixture `payments` is 0 and `board_test_usd` is 0.5019), is flagged in `controller_figures` and left out of the Controller's paid-out agent money, and its refund removes its `board_test` allocation.

Supporter numbers:
- [ ] Each contributor gets one number, sequential from 1 with no gaps, kept across later payments. It is founding when `launched_at` is null or later than the first payment's Checkout Session time, and not founding otherwise.

Why the studio is paused:
- [ ] `set_paused(true, reason)` stores the reason, `board` when none is given, and refuses an unknown one; `set_paused(false)` clears it; a pause written directly with no reason is `board`; the dispatcher's credit, tier-cap and revert pauses write `awaiting_credit`, `spend_limit` and `incident`. `public_studio.pause_reason` is null while not paused, and the view shows neither `paused_by` nor `paused_at`.

Public reads:
- [ ] `public_money`'s columns equal the SQL in Behaviour, and its identity holds after each of: a payment, a partial refund, a dispute with its reinstatement, a Stripe fee row and a board correction. `reconciled_at` and `last_run_ok` are null before the first reconcile run and follow the latest one after.
- [ ] `money.payment_counts` is false for the board's test payment and for a fully refunded or fully disputed payment, and true again after a reinstatement. `public_card_funding.contributors` counts only payers with a counted payment that reached the card, a shipped card keeps its funders and total after the sweep, and `on_card_usd` equals the bar.
- [ ] `public_stopped_cards` lists the rejected and paused cards on now, and each rejected card's moves (destination card or Not on a card yet, and amount) sum to the unspent money it released.

Guards and kernel checks:
- [ ] UPDATE, DELETE and TRUNCATE on `contribution_allocations`, `supporters` and `board_test_payments` are refused for every role; service_role can select and not insert them; no API role can execute a `money` function. Every public function that places money takes the money lock before any row lock and locks cards before the pool (static test).
- [ ] `ledger_identity()` returns I1 to I5 and holds through every test sequence, and a forged allocation row makes it name the line that drifts. `ledger-identity.ts` checks the same lines.
- [ ] Anon can read each public view, is refused with 42501 on the three new tables and every new public function, and cannot reach the `money` schema; `anon-negative-test.ts` covers all of them with probes that change nothing even if a grant were wrong. No public view has a contributor id, email, name, session or a supporter's single payment.

The board site:
- [ ] The cancel confirmation says the card's unspent money goes to the next cards in line, and Pause offers the four reasons with the default sending only `p_paused`.

Production:
- [ ] Production: a pg_dump is taken and listed before the apply; after it, `ledger_identity()` holds with I1 to I5, `cron.job` lists `waterfall-sweep */5 * * * *`, `anon-negative-test.ts` and `ledger-identity.ts` print PASS, and the new `stripe-webhook` version is deployed.

## Verification

- `pnpm verify`
- `deno test --config platform/supabase/functions/deno.json --allow-read --allow-env platform/supabase/functions/_shared/money_logic_test.ts`
- `pnpm test:functions`
- `pnpm test:ops`
- `pnpm --filter @backseat/supabase test`
- `pnpm --filter @backseat/dispatcher test`
- `pnpm --filter @backseat/board test`
- Production, after the production steps, each quoted:
  - `select public.ledger_identity()` holds, with I1 to I5;
  - `pnpm --filter @backseat/supabase exec tsx scripts/ledger-identity.ts` prints PASS;
  - `pnpm --filter @backseat/supabase exec tsx scripts/anon-negative-test.ts` prints PASS;
  - `select jobname, schedule from cron.job` lists `waterfall-sweep */5 * * * *`;
  - `npx supabase@2.117.0 functions list --project-ref lyxndueoeisyqzewflpu` shows the new `stripe-webhook` version.

## Production steps

1. Confirm the studio is paused (`select paused from studio_state`) and no dispatcher is ticking (`dispatcher_seen_at` older than three minutes).
2. Dump with the read-only backup login: `pg_dump "$BACKUP_DB_URL" --no-owner --format=custom --file ~/peanutgallery-dumps/<UTC stamp>-before-money-logic.dump`; run `pg_restore --list` on it and quote the size and the money-table lines.
3. Quote read-only checks: `select public.ledger_identity()`; `select count(*), max(created_at) from contributions`; the board's test payment row and whether it has refund rows; that `terms_versions` exists.
4. Apply the migration through the Management API query endpoint in one request. If its closing identity check fails, it rolls back and nothing has changed.
5. Quote: `select public.ledger_identity()`; `select destination, card_id, amount_usd, reason from contribution_allocations order by seq` (one `board_test` row of 0.5019 unless the board refunded first); `select count(*) from supporters` (0); `select jobname, schedule from cron.job`; `select * from public_money` (`payments` 0), `public_stopped_cards` and `public_studio` (`pause_reason` `awaiting_credit`).
6. If a step 5 check fails, the studio stays paused, the webhook is not deployed, the fix goes forward as a new migration, and the dump is never restored over rows newer than step 3's newest row.
7. Deploy the webhook (`npx supabase@2.117.0 functions deploy stripe-webhook --project-ref lyxndueoeisyqzewflpu`) and quote `functions list`. Send no synthetic event.
8. Run `anon-negative-test.ts` and `ledger-identity.ts` and quote both PASS lines.
9. After the board site's Netlify deploy of the merge sha, confirm its bundle carries the new cancel confirmation and the pause reasons.
10. The dispatcher and Controller changes arrive with the cutover's `install.sh --start` (`platform/ops/mac/deploy.sh` refuses before the cutover). Until then a pause with no reason is `board`, and the Controller does not run (no `STRIPE_READ_KEY`).
11. Record the quoted outputs in Evidence and set this spec to done.

Board items (listed, not blocking):
- Refund the $1 test payment in Stripe before the cutover (BOARD-SETUP step 12). Until then it is booked apart and funds nothing; the fee Stripe keeps on it is booked to the studio share automatically.
- Create `STRIPE_READ_KEY` (BOARD-SETUP step 4) so the Controller can run; until its first passing reconcile, `last_run_ok` is null.

## Evidence

Added when the status moves to built or done.

## Decisions

- 2026-09-23, Trimmed (board: "better to be simple and delete than add more convoluted bespoke"; good normal modern standards): 76 criteria became 25. Every Problem outcome is kept, and so is the money kernel: the waterfall, allocations, refund unwinding across every card reached, the fee Stripe keeps, idempotent fee booking, append-only money tables, RLS and select-only grants, the dump before the production write, `anon-negative-test.ts` and the ledger identity. Cut:
  - the operations bucket at 0% (the old waterfall step 2, the `operations` destination, the `terms_versions` zero check, `money.operations_unspent`, and `public_money`'s `operations_usd`, `operations_pct` and `operations_since`), because it shipped switched off. The waterfall is now named card, ranked cards, Not on a card yet. What depended on it is listed in the build plan's Contracts;
  - the immediate drains in `file_card`, `set_card_horizon` and `resume_card` and before every placement (the five-minute sweep drains), so those three functions are not redefined, and `skip locked` in step 2;
  - the `cards.funded_usd` guard trigger and its session flag (I5 finds any drift, and the Controller reports it);
  - the preconditions block on `terms_versions` (the foreign key and the stamp tests fail without legal-copy's shape);
  - `payment_unspent()` (written when a wind-down is attended; the allocations hold what it needs);
  - the board site's "Correct a payment" control and both Needs you lines, with `board_needs_you`'s new fields (refund and dispute fees now book themselves; `record_adjustment` still exists for an attended session);
  - the pause reason derived from the dispatcher's pause text and its static prefix test (the old dispatcher does not run before the cutover; a pause with no reason is `board`);
  - the new webhook alert wording (the existing shortfall alert reads the new `shortfall_usd`);
  - `controller_figures.fee_refs` (`record_stripe_fee` is idempotent, so the Controller calls it for every dispute fee);
  - the `public_funding_order` view (one read: `public_money.funding_order`), the shared `takes-money-cases.json` fixture (money-surfaces no longer mirrors the predicate), the sum-level identity line (implied by the per-payment line), and `ceiling_top_up` added ahead of agent-system-core;
  - criteria that tested implementation rather than behaviour (applying twice, a static test of fixture writes, the decision link regression, which `pnpm verify` already covers).
- 2026-09-23, reconciled with the series (these override any line that disagrees):
  - `contributions.terms_version` is `integer references public.terms_versions(version)`, stamped with legal-copy's `public.terms_version_at(timestamptz) returns integer`. Nothing here reads `terms_versions.operations_pct`.
  - The migration is `20260924200000_money_logic.sql`, after legal-copy's; if main holds a later file at build, bump the stamp and keep the order.
  - The ledger-truth SQL is here (money in without the board's test payment, the reconciliation fields, the average split, the pause reason); its pages and strings are money-surfaces'.
  - `money.payment_counts(p_payment)` is the one definition of a payment that still credits its payer. `public_card_funding` uses it here and supporter-pages' public supporter list uses it later, so the list and the count agree.
  - PLAN §6 Build 1's "no badge or queue position" sentence becomes founding supporter numbers here, once.
- 2026-09-23: one predicate decides which cards take money at every step, step 1 included: `runnable()`'s conditions plus the stage and the room. Money never waits on a card the dispatcher would never start, and a supporter's ask for such a card is kept in `requested_card_id` so /thanks can explain where the money went. A change to `runnable()` updates the SQL predicate in the same pull request.
- 2026-09-23: the stamp uses the Checkout Session's `created` time from Stripe and treats a future time as now; with no time it stamps nothing.
- 2026-09-23: card naming at checkout is the Payment Link's `client_reference_id`, already on main (`payment.ts` `fundLink`, `split.ts` `goalCardId`); the redirect to /thanks is a board step (BOARD-SETUP step 12).
- 2026-09-23: Stripe's kept fee is booked on the refund or dispute row itself (net is the whole amount reversed; the fee part comes off the studio share), so a won dispute's reinstatement puts it back with the rest. The dispute fee is booked by the Controller from Stripe's balance transactions, as it already books reinstatements.
- 2026-09-23: Not on a card yet is computed from the pool rather than from the allocations, because the dispatcher can spend beyond a bar and only the pool shows that. The allocations attribute money to payments for refunds, and the drain is capped by the pool figure.
- 2026-09-23: spend is attributed to a card's oldest money first; unwinds and releases take only a payment's own unspent money; refunded money that was spent comes off Not on a card yet (PLAN §5). An S1 incident draw counts as spend, so the bar keeps that much.
- 2026-09-23: the board's $1 test payment is kept apart by its documented session id, so the drain never puts founder money on a bar (decisions 7 and 35) and the board never holds supporter 1 (ROADMAP criterion 1). It stays in the pool balance until refunded, so the Controller leaves it out of credit purchases and the refund comes before the cutover.
- 2026-09-23: the backfill does not re-route old money: it mirrors today's bars. On production every bar was $0 on 23 September 2026, so the first sweep moves nothing; old unnamed money drains as cards open.
- 2026-09-23 (supersedes `card-columns-and-open-funding.md`'s release to the named card whatever its stage): released and reinstated credit enters at step 1.
- 2026-09-23: a funded card that a refund leaves below its target takes money again at steps 1 and 2; it keeps its stage and nothing touches the dispatcher.
- 2026-09-23: leftovers are released by a pg_cron sweep every five minutes rather than a trigger on the dispatcher's stage write, which could deadlock against a refund on the same card; the sweep runs even when the dispatcher is down.
- 2026-09-23: locking follows one rule: the advisory money lock, then cards in id order, then the pool. `record_usage` locks one card then the pool, so the two cannot deadlock.
- 2026-09-23: a shortfall is shown and alerted but not repaid from new money.
- 2026-09-23: supporter numbers key on `contributor_id` (the hashed receipt email), not `payer_key`, which changes with the card used. One sequence covers everyone; founding is a flag.
- 2026-09-23: the pause reason is stored when the pause is set, never guessed at read time, and never shows who paused or when (`board-site.md`). Production's pause is backfilled `awaiting_credit` because the data proves it (not launched, no credit purchase).
- 2026-09-23: the helpers live in a `money` schema the API does not expose, and the new tables are select-only even for service_role, so a leaked service key cannot forge allocations or supporter numbers.
- 2026-09-23: the migration checks the identity before it commits. Production fixes forward and never restores a dump over newer payments.
