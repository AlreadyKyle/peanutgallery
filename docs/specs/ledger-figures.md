# Ledger figures: one definition of each money figure, and figures a reader can add up

Status: agreed. Card: none (kernel work). Owner: studio.

Draft: written, not yet agreed. Agreed: the contract for the work, settled by the session or role that owns it (docs/PLAN.md §10 decision 74). Built: merged, and every criterion a test can prove is ticked; live verification is still to run. Done: every Verification line has been run and its output quoted. A criterion replaced by a later spec is struck through and names that spec.

## Problem

A live audit of /goals, /ledger and the card pages (20 October 2026) found money figures that disagree with each other, though the stored books are consistent (the Controller's `ledger_identity` holds on every run, and the pool equals agent credit less agent spend to the cent). Each disagreement is in what a public view counts or what a page says it means:

1. /goals says $6.00 raised; /ledger says Received $5.00. `community.lifetime_cents()` counts the studio's own $1.00 test payment, which every money-in figure leaves out (`docs/specs/money-logic.md`).
2. /ledger's Funding band shows balances that include the test payment's shares (In the pool $0.48, Held in reserve $0.52, Emergency fund $0.19) beside Money in figures that leave it out (To the reserve $0.45, To the emergency fund $0.16, Agent credit $3.08). Agent spend says $2.84, but the pool has paid $3.10: `public_ledger_totals` is `security_invoker`, so the ledger's row policy hides the $0.26 spent drafting a card that is not public yet. Nothing on the page says how $0.48 is made up, so $3.08 − $2.84 = $0.24 cannot be squared with it.
3. A card's money is counted on every card it passes through. `public_card_funding.credited_usd` is everything that reached a card from counted payments, money released on to other cards included (so a shipped card keeps its funders). Four Didn't ship rows say "funded by $1.50 from 1 supporter" (or $0.50), and across all cards $9.20 is "credited" from one $5.00 payment. A card's page says "Funded $0.50 of $0.50" for a card that spent $0.11 and passed $0.39 on, and an open card says Funded $0.52 while $0.28 of it already paid for its drafting.
4. /ledger says "Not yet reconciled with Stripe." `public_money` reads only the latest Controller run, and `ok` there is false whenever any check fails. Since 13 October 2026 every run's books checks pass and only `minimum_balance` fails: Stripe holds 1.00 CAD against the Controller's Minimum balance of 1.45 CAD (the reserve, held money and 30 days of fees). That is a Stripe setting the operator raises after a payout (docs/PLAN.md §4 The Board), not a disagreement between the books and Stripe.

## Scope

In:
- A migration, `20261020100000_ledger_figures.sql`, that redefines, with the same columns in the same order and new columns only at the end:
  - `community.lifetime_cents()`: the money-in definition.
  - `public_ledger_totals`: every studio-billed and overhead row, whether or not its card is public, plus `unlisted_usd`.
  - `public_money`: the reconciliation columns read from the books checks, plus `test_paid_usd`, `test_reserve_usd` and `test_incident_usd`.
  - `public_stopped_cards`: plus `from_cards_usd`.
- The site: /ledger's Funding band (the pool's make-up, the test payment line), Agent work's spend note, the Stopped rows' money line, and a card page's money facts. `lib/source.ts` reads every new column as optional, so the site works before and after the migration is applied.
- The words "board" in the money strings this changes (the test payment line, corrections, a paused card's money).

Out:
- Any money logic: the waterfall, allocations, the split, the reserves, caps, holds, refunds, the sweep and the drain are unchanged, and so is every stored row. `money.not_on_card_usd()`, `money.board_test_usd()` and `public_card_funding` are not redefined.
- The Controller (`platform/ops/jobs/controller.mjs`): its checks, its `ok` and its alerts are unchanged; `minimum_balance` still fails and alerts until the Minimum balance is raised in Stripe.
- The card face (`Card.tsx`, which another change is editing): its Funded row and "left to fund it" are unchanged; the card's own page carries the extra facts.
- /goals' words (`copy.ts`, which another change is editing): only the figure changes.

## Behaviour

Every figure below is computed from the four-decimal values and shown rounded to the cent, so a sum of rounded figures can differ from the rounded total by a cent.

### Money in (unchanged)

The supporters' money, the test payment left out:

received − Stripe fees − refunded − disputed + corrections = to the reserve + to the studio + to the emergency fund + held + agent credit.

Production: 5.0000 − 0.4905 − 0 − 0 + 0 = 4.5095 = 0.4510 + 0.8117 + 0.1623 + 0 + 3.0845.

### /goals

`lifetime_cents` = received − refunded − disputed (disputes net of any won back), from the same rows as Money in, so the test payment's family is left out. Production: 500 cents, $5.00, the ledger's Received with nothing refunded.

### The Funding band

The balances are what the studio holds, so they include the test payment's shares. The page now says by how much, and how the pool is made up:

- Held in reserve = to the reserve + the test payment's reserve: 0.4510 + 0.0734 = 0.5244.
- Emergency fund = to the emergency fund + the test payment's: 0.1623 + 0.0264 = 0.1887.
- In the pool = agent credit + the test payment's agent credit − agent spend: 3.0845 + 0.5019 − 3.1048 = 0.4816.
- In the pool = unspent on card bars + the test payment's agent credit + Not on a card yet − the shortfall: 0.2428 + 0.5019 + 0 − 0.2631 = 0.4816. Unspent on card bars is the pool less the test payment's credit less `money.not_on_card_usd()` (by that function's definition), so it is computed on the page from `pool.balance_usd`, `board_test_usd`, `not_on_card_usd` and `short_usd`.

The test payment line names the payment and each share: "The pool, the reserve and the emergency fund include the studio's own $1.00 test payment: $0.50, $0.07 and $0.03. It funds no card." A document without the new columns keeps the old one-figure line, in the new words.

The shortfall line says what the shortfall is: Not on a card yet is below zero by that much, because agent work spent it before any card's money covered it, or a refund took back money already spent (docs/PLAN.md §5, Refunds and disputes). In production it is the $0.2631 spent drafting a card that is not public yet.

### Agent work

Agent spend is every studio-billed row: 3.1048 in production. When some of it is on cards the site does not show yet, the note under it says so: "Includes $0.26 spent drafting cards not shown yet." The total and the tokens never name such a card.

### A card's money

On every card, what reached it = what it spent + what is unspent on its bar + what moved on to other cards or to Not on a card yet. Money that moves from one card to another is counted on each card it reaches, so these add up card by card, not across cards; Money in's agent credit is the total.

- A Didn't ship row says "{spent} spent · {reached} reached it from N supporters", with ", {x} of it from other cards" when some of it was released to it from another card, then where its unspent money went, card by card. Production, "Stop the unlock count…": 0.2332 spent, 1.5000 reached it, 1.1298 and 0.1370 went on: 1.5000 = 0.2332 + 1.2668.
- A card's own page keeps Funded (what reached it) and its cost, and adds "Unspent on its bar" when the bar holds money not yet spent and "Moved on" when money that reached it went on. Production: the open card shows Funded $0.52, Drafting cost $0.28, Unspent on its bar $0.24; the first live card shows Funded $0.50, Cost $0.11, Moved on $0.39.

### The reconciliation line

"Reconciled with Stripe on {date}." when the latest Controller run's books checks all passed, with the date of the latest run whose did; else "Not yet reconciled with Stripe." The books checks are every check of the run but `minimum_balance`. Production: the 20 October 2026 run, so "Reconciled with Stripe on 20 October 2026."

### Before and after, production on 20 October 2026

| Figure | Before | After | Why |
|---|---|---|---|
| /goals raised | $6.00 | $5.00 | test payment left out, as in Received |
| Received | $5.00 | $5.00 | unchanged |
| Stripe fees | $0.49 | $0.49 | unchanged |
| To the reserve | $0.45 | $0.45 | unchanged |
| To the studio | $0.81 | $0.81 | unchanged |
| To the emergency fund | $0.16 | $0.16 | unchanged |
| Agent credit | $3.08 | $3.08 | unchanged |
| In the pool | $0.48 | $0.48 | unchanged; its make-up is now shown |
| Held in reserve | $0.52 | $0.52 | unchanged; = $0.45 + test $0.07 shown |
| Emergency fund | $0.19 | $0.19 | unchanged; = $0.16 + test $0.03 shown |
| Not on a card yet | $0.00 | $0.00 | unchanged |
| Shortfall | $0.26 | $0.26 | unchanged; now said what it is |
| Unspent on card bars | not shown | $0.24 | new |
| Agent spend | $2.84 | $3.10 | the $0.26 drafting a card not yet public counted |
| Reconciliation | not yet | 20 October 2026 | books checks only |
| A Didn't ship card | "funded by $1.50" | "$1.50 reached it", moved on shown | flows, not balances |

## Acceptance criteria

- [ ] `community.lifetime_cents()` leaves out the test payment's family and equals `public_money`'s received − refunded − disputed in cents (`ledger_figures_test.ts`).
- [ ] As anon, `public_ledger_totals.usd_total` counts studio-billed rows on a card that is not public, and `unlisted_usd` is their sum (`ledger_figures_test.ts`).
- [ ] `public_money` has every earlier column in the same order, then `test_paid_usd`, `test_reserve_usd`, `test_incident_usd`; `pool.reserve_usd` = `reserve_usd` + `test_reserve_usd` and `pool.incident_reserve_usd` = `incident_usd` + `test_incident_usd` (`ledger_figures_test.ts`).
- [ ] `public_money.last_run_ok` is true and `reconciled_at` set for a latest run whose only failing check is `minimum_balance`; false for a latest run with another failing check, and `reconciled_at` then is the latest run whose books checks passed; both null with no run (`ledger_figures_test.ts`).
- [ ] `public_stopped_cards.from_cards_usd` is the counted money released to the card from other cards (`ledger_figures_test.ts`).
- [ ] The migration applies twice and the migration list includes it (`ledger_figures_test.ts`, `migration_test.ts`).
- [ ] /ledger's Funding band shows the pool's two sums, the test payment's three shares and the shortfall's meaning, and the figures shown add up (`MoneyIn.test.tsx`).
- [ ] Agent spend's note shows only when `unlisted_usd` is above zero (`Ledger.test.tsx`).
- [ ] A Didn't ship row says "reached it", the part from other cards, and where it went (`Stopped.test.tsx`).
- [ ] A card's page shows Unspent on its bar and Moved on only when above zero (`CardPage.test.tsx`).
- [ ] A document without the new columns draws the page as before, in the new words (`source.test.ts`, `MoneyIn.test.tsx`).
- [ ] After the migration and the deploy, production's /goals says $5.00, /ledger's Agent spend $3.10 and the reconciliation line a date (the `live-check` workflow, and the API read).

## Verification

- `deno test --config platform/supabase/functions/deno.json --allow-read --allow-env platform/supabase/functions/_shared/ledger_figures_test.ts platform/supabase/functions/_shared/money_logic_test.ts platform/supabase/functions/_shared/migration_test.ts platform/supabase/functions/_shared/community_core_test.ts`
- `pnpm --filter @backseat/site test`
- `E2E_PORT=4450 npx playwright test e2e/money.spec.ts e2e/design.spec.ts` in `platform/site`
- `pnpm verify`
- The before and after table above, from production with read-only SELECTs.

## Evidence

## Decisions

- 2026-10-20: the balances keep the test payment's shares and say so, rather than leave them out. The money is in Stripe and in the pool, and the pool paid for the drafting the shortfall names; a pool shown without it would read below zero while the studio holds $0.48.
- 2026-10-20: a card's funding keeps "what reached it" (the funders a shipped card keeps, `docs/specs/supporter-pages.md`) and adds where it went, rather than redefine `credited_usd`. Per card the figures add up; across cards, Money in's agent credit is the one total.
- 2026-10-20: the public reconciliation line reads the books checks. `minimum_balance` compares Stripe's balance with a buffer the operator sets in Stripe; it alerts the operator as before and is not a disagreement between the books and Stripe.
- 2026-10-20: found and not changed (money logic, out of scope): spend on a card before it has bar money comes off Not on a card yet, and the drain later puts bar money on that card that its earlier spend has already used. So an open card's bar includes its drafting cost while its target is the build estimate (production: $0.28 of the open card's $0.52). Whether drafting should count against a card's own bar is a money-logic decision for its own spec.
