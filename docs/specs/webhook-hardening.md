# Webhook hardening: the dry-run gate, unusable sessions, dispute inquiries, reserve alerts

Status: agreed. Card: none. Owner: board.

## Problem

The stripe-webhook function has five gaps found in the audit.
1. A request with `x-dry-run: 1` and a wrong or legacy bearer runs live. `sign-synthetic-event.ts` falls back to the legacy service-role JWT, which the function runtime does not match, so a "dry run" of `charge.refunded` or `charge.dispute.created` reverses a real contribution.
2. A paid Checkout session the handler cannot parse (an unknown split value, a currency other than USD) answers 500 with no alert. Stripe retries for days and the contribution is never credited, and nobody is told.
3. Every `charge.dispute.created` reverses, including inquiries, which withdraw no funds.
4. A refund or dispute can push the 10% reserve or the emergency fund (`incident_reserve_usd`) below zero, and the alert only checks the pool balance.
5. A contribution that names a goal card the RPC does not credit goes to the pool silently. The SDK import floats on `npm:stripe@^19`.

## Scope

In:
- The dry-run gate in `_shared/handler.ts`, and `scripts/sign-synthetic-event.ts` with `--wrong-bearer` and `--status`.
- An alert for an unusable session on `checkout.session.completed`.
- Dispute inquiries, and `charge.dispute.funds_withdrawn` added to the handler and to `WEBHOOK_EVENTS`.
- Alert lines for the reserve and the emergency fund below zero, and for a goal card the RPC did not credit.
- The Stripe SDK pinned to 19.3.1.

Out:
- The reversal math and the SQL migrations. A separate change makes `reverse_contribution` return `pool_reserve_usd` and `pool_incident_reserve_usd`, and makes `apply_contribution` credit a goal card only in an open stage. Until then the two reserve lines never fire.
- Disputes won (`charge.dispute.funds_reinstated`), as in `refunds-and-holds.md`.

## Behaviour

**Dry-run gate.**
- The gate runs right after the method check, before the body is read or the signature verified.
- No `x-dry-run` header is a live request, as before.
- With the header, a bearer other than the function's service key, or an empty service key, answers 401 `x-dry-run needs the service key as the bearer`. The bearers are compared in constant time.
- With the header and the right bearer, any value but `1` answers 400.
- A request carrying `x-dry-run` never runs live.

**The dry-run script.**
- `sign-synthetic-event.ts` requires `SUPABASE_SECRET_KEY` and no longer falls back to `SUPABASE_SERVICE_ROLE_KEY`. When the function answers 401 it prints a hint.
- `--wrong-bearer`, allowed only with the default `checkout.session.completed` event, sends a bearer that is not the key. It exits 0 only on 401.
- `--status` sets a dispute's status (default `needs_response`) for `charge.dispute.created` and `charge.dispute.funds_withdrawn`.

**Unusable sessions.**
- A paid session that cannot be parsed still answers 500, so a fixed handler can credit it on Stripe's retry.
- On `checkout.session.completed`, unless it is a dry run, the board gets one line naming the session, the event, the parse error and that Stripe retries for up to 3 days: fix the handler to credit it, or refund it.
- `charge.updated` parses the same session and stays silent, so there is one alert per Stripe retry of the completed event.

**Disputes.**
- `charge.dispute.created` with status `warning_needs_response`, `warning_under_review` or `warning_closed` is an inquiry. It answers 200 ignored, reverses nothing and, unless it is a dry run, tells the board that no funds were withdrawn and nothing was reversed.
- `charge.dispute.created` with any other status reverses as before. Reversing before the funds leave under-credits, which is the safe direction.
- `charge.dispute.funds_withdrawn` always reverses through the same path. The RPC takes the dispute's cumulative total, so whichever of the two events arrives second reverses nothing.
- A `funds_withdrawn` with nothing left to reverse sends no alert, so a normal dispute alerts once.

**Alerts.**
- The reversal line adds "the 10% reserve is below zero" when the RPC's `pool_reserve_usd` is negative, and "the emergency fund is below zero" when `pool_incident_reserve_usd` is.
- A newly inserted contribution whose session named a goal card, where the RPC's `goal_card_id` comes back null, posts "Contribution <session> named card <id>, which is not open for funding; it went to the pool". A replay does not.

**SDK.** `stripe-webhook/index.ts` imports `npm:stripe@19.3.1`, whose `ApiVersion` is `2025-10-29.clover`, the version in `stripe_api_version.ts`.

## Acceptance criteria

- [x] `x-dry-run: 1` with no bearer, `another-key` or the key plus a character answers 401 on a completed and a refunded event, and makes no fee lookup, session lookup, credit, reversal or alert.
- [x] `x-dry-run: true` with the right bearer answers 400 and runs nothing.
- [x] A wrong bearer with a bad signature answers 401.
- [x] An empty service key refuses every dry run.
- [x] `checkout.session.completed` for a CAD session or a split of `9999` answers 500 with exactly one alert naming the session.
- [x] The same unusable session on `charge.updated`, or in a dry run, answers 500 with no alert.
- [x] A dispute inquiry in each `warning_*` status reverses nothing and sends one alert (none in a dry run).
- [x] `charge.dispute.funds_withdrawn` reverses and alerts; with nothing left to reverse it sends no alert.
- [x] `WEBHOOK_EVENTS` is exactly the five events.
- [x] The reversal line names the reserve and the emergency fund when either is below zero.
- [x] The dropped-goal alert fires on an insert and not on a replay.
- [x] `sign-synthetic-event.ts` refuses to run without `SUPABASE_SECRET_KEY`, and `--wrong-bearer` exits 0 only on 401.
- [x] `deno check` passes with `npm:stripe@19.3.1`.
- [ ] The live endpoint lists the five events.
- [ ] Against the deployed function, the dry run answers 200 and `--wrong-bearer` answers 401.

## Verification

- `pnpm test:functions`
- `pnpm --filter @backseat/supabase test`
- `pnpm --filter @backseat/supabase typecheck`
- `deno check --config platform/supabase/functions/deno.json platform/supabase/functions/stripe-webhook/index.ts`
- `pnpm verify`
- The production steps below, each with its output quoted.

## Production steps (need the board's allow)

Run in this order from the repository root unless a step says otherwise.

1. `git pull` on main after the merge.
2. From `platform/`: `npx supabase functions deploy stripe-webhook --project-ref lyxndueoeisyqzewflpu --use-api`. The refunds deploy first shipped a stale checkout, so confirm step 1 first.
3. The dry run, expecting 200 with `dry_run: true`:
   `pnpm --filter @backseat/supabase exec tsx scripts/sign-synthetic-event.ts`
4. Only once the new deploy is confirmed live, because a function without the gate treats a wrong bearer as a live request. To confirm it, run the inquiry dry run from step 6 first. It is a dry run on either version, and only the new function answers `ignored: true` with `reason: "dispute inquiry warning_needs_response"`; the old one answers `dry_run: true` with a reversal. Then, expecting 401 and `refused as expected`:
   `pnpm --filter @backseat/supabase exec tsx scripts/sign-synthetic-event.ts --wrong-bearer`
5. `pnpm --filter @backseat/supabase exec tsx scripts/update-webhook-events.ts --id we_1UFd0XICmyTP81VUCeACUWhc`, then `GET /v1/webhook_endpoints/we_1UFd0XICmyTP81VUCeACUWhc` to confirm `enabled_events` is `checkout.session.completed`, `charge.updated`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.funds_withdrawn`.
6. Dry runs against the board's $1 payment intent:
   - `pnpm --filter @backseat/supabase exec tsx scripts/sign-synthetic-event.ts --event charge.dispute.funds_withdrawn --payment-intent pi_3UFkgKICmyTP81VU0oegNKiq`, expecting 200 with `dry_run: true` and the session id.
   - `pnpm --filter @backseat/supabase exec tsx scripts/sign-synthetic-event.ts --event charge.dispute.created --payment-intent pi_3UFkgKICmyTP81VU0oegNKiq --status warning_needs_response`, expecting 200 with `ignored: true` and `reason: "dispute inquiry warning_needs_response"`.

## Evidence

2026-09-16, branch `webhook-hardening`.

**Tests first.** With the new tests and the old handler, `deno test platform/supabase/functions/_shared/handler_test.ts` printed `FAILED | 35 passed | 11 failed`. The failures were the dry-run gate (4), the unusable-session alert, the dropped-goal alert, the inquiry, both `funds_withdrawn` tests, the five events and the reserve lines. The no-alert guard on `charge.updated` and dry runs passed on the old handler, as it should. `test/synthetic-event.test.ts` printed `Tests  2 failed | 5 passed (7)` before `lib/synthetic-event.ts` took a status.

**Criteria, by test.** In `platform/supabase/functions/_shared/handler_test.ts`:
- **Criteria 1 and 4:** "x-dry-run without the service bearer answers 401 and runs nothing"; "x-dry-run answers 401 when the function has no service key".
- **Criterion 2:** "the service bearer without x-dry-run is a live request, and any value but 1 answers 400".
- **Criterion 3:** "x-dry-run with a wrong bearer answers 401 before the signature is checked".
- **Criterion 5:** "a completed session it cannot parse answers 500 and alerts once".
- **Criterion 6:** "an unusable session answers 500 without an alert on charge.updated or in a dry run".
- **Criterion 7:** "a dispute inquiry reverses nothing and tells the board".
- **Criterion 8:** "charge.dispute.funds_withdrawn reverses the disputed amount and alerts"; "charge.dispute.funds_withdrawn with nothing left to reverse sends no alert".
- **Criterion 9:** "the webhook listens to exactly the five events".
- **Criterion 10:** "the reversal message warns when the 10% reserve or the emergency fund goes below zero".
- **Criterion 11:** "a new contribution whose goal card was not credited alerts, and a replay does not".

`platform/supabase/test/synthetic-event.test.ts` covers the `funds_withdrawn` event and the status parameter.

**Criterion 12.** The script was run against a local stub server with no live key:
- `SUPABASE_SECRET_KEY` unset (legacy key present): `sign-synthetic-event failed: SUPABASE_SECRET_KEY is not set in .env. A dry run must present the project's sb_secret_ key; the legacy SUPABASE_SERVICE_ROLE_KEY is refused`, exit 1.
- `--wrong-bearer`, stub answers 401: `status 401`, `refused as expected`, exit 0.
- `--wrong-bearer`, stub answers 200: `expected 401: the function did not refuse a wrong bearer`, exit 1.
- The dry run, stub answers 401: prints the hint, exit 1.
- `--wrong-bearer --event charge.refunded`: `--wrong-bearer runs only with the default checkout.session.completed event`, exit 1.

**Criterion 13.** `ApiVersion = '2025-10-29.clover'` is in `stripe/19.3.1/esm/apiVersion.js` in the Deno npm cache. The cached registry lists no stable 19.x above 19.3.1, so `^19` already resolved to it. `deno check --config platform/supabase/functions/deno.json platform/supabase/functions/stripe-webhook/index.ts` exits 0.

**Commands:**
- `pnpm test:functions`: `ok | 67 passed (33 steps) | 0 failed` (58 before).
- `pnpm --filter @backseat/supabase test`: `Test Files  11 passed (11)`, `Tests  124 passed (124)` (122 before).
- `pnpm --filter @backseat/supabase typecheck`: `tsc -p tsconfig.json --noEmit`, exit 0.
- `pnpm verify`: exit 0. The output includes `ok | 67 passed (33 steps) | 0 failed`, `GATE PASS folder=seed-1 lane=code`, `GATE PASS folder=platform lane=code` and `PASS: secret-scan files=296`.

The last two criteria wait on the production steps.

## Decisions

- 2026-09-16: a request that carries `x-dry-run` is refused rather than run live when its bearer is wrong. A mistaken dry run must never move money.
- 2026-09-16: an unusable session keeps its 500 so a fixed handler can still credit it on Stripe's retry. Only the completed event alerts, so each retry alerts once.
- 2026-09-16: `charge.dispute.created` still reverses for every status but the three inquiry statuses, and `charge.dispute.funds_withdrawn` also reverses. The cumulative dispute total makes the second one a no-op, and reversing early under-credits, the safe direction.
- 2026-09-16: the Stripe SDK is pinned exactly, so a deploy cannot pick up an SDK whose default API version differs from `stripe_api_version.ts`.
