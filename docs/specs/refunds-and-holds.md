# Refunds, disputes and the daily credit hold

Status: built. Card: none. Owner: board.

## Problem

The webhook ignores `charge.refunded` and `charge.dispute.created`. A refunded or disputed payment therefore stays on the meter and on any card bar it funded, and the ledger stops matching the money. PLAN.md §5 also says contributions credit the meter immediately only up to $50 per contributor per day, with the rest credited after 14 days. That hold is not built, so one large disputed payment could fund agent work that is later clawed back.

## Scope

In:
- Handling `charge.refunded` and `charge.dispute.created`.
- A `reverse_contribution` RPC.
- A per-contributor daily immediate-credit cap with a 14-day hold, and an hourly release job.
- The endpoint's event list.
- A held amount on the Funding figures.
- The ledger identity restated so it stays exact through holds, releases, refunds and disputes.

Out:
- Partial-refund proration beyond the refunded share.
- Chargeback evidence submission.
- Disputes won (`charge.dispute.funds_reinstated`) and failed refunds (`charge.refund.updated`). Both leave the pool under-credited, the safe direction, and the board corrects them by hand.
- Stripe's fee on a refund and its dispute fee. They come out of the studio share, not the pool.

## Behaviour

**Rows.**
- A payment row is never changed after it is written.
- Every later movement for that payment is a child row (`entry` release, refund or dispute, linked by `parent_id`) with signed amounts, so the ledger stays append-only.
- A refund or dispute row is keyed by its Stripe event id and has no session id.
- A payment has at most one release row.

**Daily hold.**
- `apply_contribution` credits immediately at most $50 of pool credit (the agents' share after the incident carve-out) per contributor per New York day. The contributor is the hashed email.
- The rest is recorded as `held_usd` on the payment with `hold_until` 14 days later, and added to `pool.held_usd`. It stays out of the balance and the card bar.
- The 10% reserve and the incident reserve are credited in full at once.
- Refunds do not free room under the cap.
- `credit_held_contributions()` runs hourly through pg_cron (minute 17). For each payment whose hold has ended, it writes one release row and moves the held amount to the balance and the card bar. A card that reaches its target moves to `funded`.
- The cap and the hold length live in `studio_state` (`credit_daily_cap_usd`, `credit_hold_days`).
- The site's Funding figures show "Held for 14 days" with a description.

**Reversal.**
- `reverse_contribution` takes the kind's cumulative total from Stripe: a charge's `amount_refunded`, or a dispute's `amount`.
- It reverses only what is still due: the smaller of that total minus what this kind already reversed, and the payment minus everything already reversed. A replay, several partial refunds and events that arrive out of order each change nothing twice.
- The reversed share is split in the payment's own proportions, rounded cumulatively so a full reversal returns every column to zero.
- Held money is cancelled before credited money.
- A dispute draws the 10% reserve first. The reserve covers the reversed pool and incident amounts up to its balance, and only the rest comes off the balance, the incident reserve and the card bar. A refund comes off all of them in the original proportions.
- The negative row records exactly what moved. A card keeps its stage.
- The webhook finds the Checkout session through the payment intent. A payment the webhook never credited (its fee never arrived) is credited first under `<event id>.credit` and then reversed.
- Every inserted reversal and every new dispute posts one line to `NTFY_TOPIC_URL` when that function secret is set. The line has no email or name, and it warns when a card past voting falls below its target or the pool balance goes below zero.

**Ledger identity.** Sums run over every contribution row and the studio-billed ledger rows:
- **I1:** `pool.reserve_usd = sum(contributions.reserve_usd)`
- **I2:** `pool.balance_usd + pool.incident_reserve_usd + pool.held_usd = sum(contributions.agents_usd) - sum(ledger.usd where billed_to = 'studio')`
- **I3:** `pool.held_usd = sum(contributions.held_usd)`

An S1 draw moves money from the balance to the incident reserve side of the same sum, and founder-billed rows never touch the pool, so I2 holds through both. This replaces the formula in `live-cut.md`.

## Acceptance criteria

- [x] A refund event for a credited session writes one negative row, moves the pool, reserve, incident reserve and card bar back by the refunded share, and a replay of the same event changes nothing.
- [x] A dispute draws the reserve first and alerts.
- [x] A $120 contribution credits $50 immediately and holds the rest; the release job credits it once 14 days have passed.
- [x] The ledger identity holds after refunds and releases (I1–I3 above).
- [ ] The live endpoint lists `checkout.session.completed`, `charge.updated`, `charge.refunded` and `charge.dispute.created`.
- [ ] The live database runs `credit-held-contributions` hourly, and `scripts/ledger-identity.ts` prints `PASS:` after the migration.

## Verification

- `pnpm verify` at the repository root.
- Deno handler tests for both events, and the PGlite steps for the hold, the release, the refund, the dispute and the identity offsets (`pnpm test:functions`).
- The migration applied to the live project through the Management API, then `select jobname, schedule, active from cron.job` quoted.
- The function deployed from `platform/`: `npx supabase functions deploy stripe-webhook --project-ref lyxndueoeisyqzewflpu --use-api`.
- `scripts/update-webhook-events.ts --id we_1UFd0XICmyTP81VUCeACUWhc` output, then the endpoint retrieved from the Stripe API.
- Dry runs against the live function for the board's $1 payment intent: `sign-synthetic-event.ts --event charge.refunded --payment-intent <pi>` and `--event charge.dispute.created`, each returning 200 with `dry_run: true` and the session id. There is no test-mode endpoint, so these stand in for a test-mode refund.
- `pnpm --filter @backseat/supabase exec tsx scripts/ledger-identity.ts` prints `PASS:`.

## Evidence

2026-09-15, branch `refunds-and-holds`:
- **Criteria 1–4:** `platform/supabase/functions/_shared/migration_test.ts` steps:
  - "a $120 payment credits $50 today, holds the rest, and the release credits it once after 14 days"
  - "a refund cancels the hold first, follows Stripe's cumulative total and a replay changes nothing"
  - "a dispute draws the reserve first and only the rest comes off the pool and the bar"
  - "reverse_contribution refuses bad inputs"
  - Each asserts the identity offsets are unchanged.
- **Criterion 2 alert:** `handler_test.ts` "charge.dispute.created reverses the disputed amount and alerts, even when nothing is left".
- **Identity:** `platform/supabase/test/ledger-identity.test.ts`.
- **Static checks:** `platform/supabase/test/migration.test.ts` "refunds-and-holds migration".
- **Site:** `platform/site/src/pages/Landing.test.tsx` (Held for 14 days).
- **Pending live:** criteria 5 and 6.

## Decisions

- 2026-09-14: reversals are negative rows, never deletes; the ledger is kernel.
- 2026-09-15: held money is a column on the payment plus a release row, not a second row with a future `credited_at`. The unique event and session keys cannot sit on two rows, a future `credited_at` would claim money is credited before the job moves it, and child rows keep every figure a plain sum (board, with the plan of 15 September 2026).
- 2026-09-15: a dispute draws the reserve first; a refund reverses in the original proportions (board).
- 2026-09-15: partial refunds follow Stripe's cumulative `amount_refunded`, so replays and several partial refunds reverse only what is still due.
- 2026-09-15: the held total lives in `pool.held_usd`, which anon already reads and realtime already publishes, rather than a new view.
- 2026-09-15: payment alerts go to ntfy from the function through an optional `NTFY_TOPIC_URL` secret, set with the VPS topic in `vps.md`.
- 2026-09-15: pg_cron is installed by the migration only where the database ships it, so the PGlite test runs the same file and calls the release function directly.
