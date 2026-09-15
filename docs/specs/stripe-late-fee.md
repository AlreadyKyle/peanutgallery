# Credit a contribution when Stripe's fee arrives

Status: agreed. Card: none. Owner: board.

## Problem

The first live $1 (15 Sep 2026, Link, event `evt_1UFkgOICmyTP81VUoYuDgI1X`) was charged but not credited. Stripe sent `checkout.session.completed` at 00:57:12 and retried at 00:57:29 while the charge's `balance_transaction` was still null; Stripe attached it in a `charge.updated` event at 00:58:31. The webhook answered 500 both times and the credit waited on Stripe's retry schedule, which misses the live-cut line that the site shows a contribution within 60 seconds.

## Scope

In: the stripe-webhook handler, the `apply_contribution` idempotency key, the webhook endpoint's event list.
Out: the split arithmetic, the site, founder credits, the endpoint's API version.

## Behaviour

A paid Checkout session is credited exactly once, as soon as its fee is known. When `checkout.session.completed` arrives with the fee already on the charge, it credits. When the fee is not there yet, the webhook acknowledges with 200 and a `deferred` note, and the `charge.updated` that attaches the balance transaction credits instead: the handler finds the Checkout session by the charge's payment intent and credits it through the same path. Both events can arrive in either order, and either can be retried; the contribution is keyed by the Checkout session, so the pool moves once. A `charge.updated` for a payment that is not a Checkout session, is not paid, or still has no balance transaction is acknowledged and ignored. The dry-run rule is unchanged for both event types.

## Acceptance criteria

- [ ] `checkout.session.completed` for a paid session whose fee is not yet available answers 200 with `deferred: true` and does not call `apply_contribution`.
- [ ] `charge.updated` with a balance transaction credits the matching paid Checkout session through `apply_contribution`.
- [ ] `charge.updated` with no matching session, an unpaid session, or a null balance transaction answers 200 ignored.
- [ ] `apply_contribution` called twice for the same Checkout session under two event ids inserts one row and moves the pool once.
- [ ] The live endpoint listens to `checkout.session.completed` and `charge.updated`.
- [ ] The 15 Sep $1 is credited: one contributions row with `studio_pct_chosen` 20 and the pool increased by agents minus incident.

## Verification

- `pnpm verify`
- Live SQL: `contributions.stripe_session_id` exists and is unique; `apply_contribution` takes `p_stripe_session_id`.
- Stripe GET `/v1/webhook_endpoints/we_1UFd0XICmyTP81VUCeACUWhc` lists both events.
- `pnpm --filter @backseat/supabase exec tsx scripts/sign-synthetic-event.ts` answers 200.
- After the event is resent: the contributions row and pool figures for session `cs_live_a1OkB7xDSosjVf25TF8aNhbzy8PoWHrjEpeRGDtUSMaFK0tG0NU5Zl5oOh`.

## Decisions

- 2026-09-15: key contributions by Checkout session, not event. Two different events can now credit the same payment. `stripe_event_id` stays unique and records the event that credited.
- 2026-09-15: `p_stripe_session_id` is the last argument with a null default, so founder-style and existing calls keep working; the webhook always sends it.
- 2026-09-15: the endpoint stays on the account default API version (2026-08-26.dahlia). Stripe cannot change `api_version` on an existing endpoint, so pinning would mean a new endpoint and a rotated signing secret. The handler reads only fields that are the same in both versions, and every lookup goes through the SDK pinned to `2025-10-29.clover`.
- 2026-09-15: answer 200 `deferred` rather than 500 when the fee is late. The `charge.updated` path is the credit, so a 500 would only add failed deliveries.
