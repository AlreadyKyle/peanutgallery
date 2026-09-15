# Refunds, disputes and the daily credit hold

Status: draft. Card: none. Owner: board.

## Problem

The webhook ignores `charge.refunded` and `charge.dispute.created`. A refunded or disputed payment therefore stays on the meter and on any card bar it funded, and the ledger stops matching the money. PLAN.md §5 also says contributions credit the meter immediately only up to $50 per contributor per day, with the rest credited after 14 days. That hold is not built, so one large disputed payment could fund agent work that is later clawed back.

## Scope

In:
- Handling `charge.refunded` and `charge.dispute.created`.
- A `reverse_contribution` RPC.
- A per-contributor daily immediate-credit cap with a 14-day hold, and an hourly release job.
- The endpoint's event list.
- A held amount on the Funding figures.

Out: partial-refund proration beyond the refunded share, chargeback evidence submission.

## Behaviour

**Reversal.**
- A refund or dispute on a credited Checkout session writes one negative `contributions` row, so the ledger stays append-only and each reversal is idempotent on event id.
- The refunded share comes off `pool.balance_usd`, `incident_reserve_usd`, `reserve_usd` and the goal card's `funded_usd` in the original proportions.
- A dispute draws `reserve_usd` first.
- A card already moved to `funded` keeps its stage; the board is alerted.
- A refund of a still-held contribution cancels the hold instead.

**Daily hold.**
- `apply_contribution` credits immediately at most $50 of the agents' net per contributor per New York day. The remainder is stored with `credited_at` 14 days later.
- `credit_held_contributions()` runs hourly via pg_cron and credits rows whose time has come.
- The site's Funding figures show "Held for 14 days" with a description.

## Acceptance criteria

- [ ] A refund event for a credited session writes one negative row, moves the pool, reserve, incident reserve and card bar back by the refunded share, and a replay of the same event changes nothing.
- [ ] A dispute draws the reserve first and alerts.
- [ ] A $120 contribution credits $50 immediately and holds the rest; the release job credits it once 14 days have passed.
- [ ] The ledger identity holds after refunds and releases (formula updated in this spec).
- [ ] The live endpoint lists `checkout.session.completed`, `charge.updated`, `charge.refunded` and `charge.dispute.created`.

## Verification

- Deno handler tests for both events; PGlite steps for the reversal, idempotency, the cap split and the release.
- The signed synthetic script extended with `--event charge.refunded` for a dry run.
- A Stripe test-mode refund against a test-mode session if a test endpoint exists; otherwise the dry run.
- `scripts/update-webhook-events.ts` output, then `stripe webhook_endpoints retrieve` quoted.
- The function deployed from `platform/`: `npx supabase functions deploy stripe-webhook --project-ref lyxndueoeisyqzewflpu --use-api`.

## Decisions

- 2026-09-14: reversals are negative rows, never deletes; the ledger is kernel.
