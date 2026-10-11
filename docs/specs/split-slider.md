# Split slider on the site, in place of the checkout dropdown

Status: agreed. Card: none (the board's backlog entry, Next rank 1). Owner: board.

## Problem

A supporter chooses the Agents/Studio split of a contribution in a dropdown on the Stripe Payment Link, after leaving the site. The board asked for the choice on the site itself, as a Humble Bundle style slider on /contribute, without the site holding a Stripe secret or creating a Checkout Session (`docs/PLAN.md` §5 Rails).

## Scope

In: a slider on /contribute that sets one payment's Agents/Studio split; the split carried on the Payment Link's `client_reference_id` beside the card id; the webhook reading it there; copy that said the split is chosen at checkout.

Out: the pool's weekly bucket allocation; the 10% chargeback reserve and the incident share, which stay fixed (`docs/PLAN.md` §4 Kernel); the default 80/20, which stays the default and is not votable; home's Fund this card buttons, which keep the bare card id and so the dropdown, or the default once the dropdown is gone; any Stripe API call or edit of the Payment Link, which is the board's (Production steps, below); the Terms text, which is versioned and unchanged.

## Behaviour

/contribute shows Choose your split above the choices: a native range input labelled Agents and studio split, with Agents N% at its left end and Studio M% at its right, starting at 80/20. It stops only at the eleven splits `SPLIT_MAP` allows (0 to 100 in tens), moves with the arrow keys, Home and End, and reads out as "N% to the agents, M% to the studio" (`aria-valuetext`). It has no animation. Under it, the reserve and the emergency fund are said as fixed, whatever the supporter chooses.

Every checkout link on /contribute carries the choice on `client_reference_id`: `<card uuid>_split<studio pct>` for a card, `split<studio pct>` for Fund the next card in line. The longest reference is 46 characters, inside Stripe's 200 and its allowed characters (letters, digits, dashes and underscores).

The webhook reads the reference with `parseReference` (`platform/supabase/functions/_shared/split.ts`). The studio percent is the reference's split when it is one of the eleven; otherwise the old dropdown's value as before (missing is 80/20, an unknown dropdown value is still refused); so a reference with an invalid split falls back to the default. A split on the reference wins over a dropdown still on the Payment Link. A bare uuid, the reference from before the slider, still credits its card. A reference that is not a string, is empty, is over 200 characters or is not in the site's form names no card and carries no split.

## Acceptance criteria

- [x] The slider starts at 80/20, stops at the eleven splits, and carries the split on every /contribute checkout link beside the card id.
- [x] It works from the keyboard, has a visible label and visible Agents and Studio values, reads out as words, is at least 44px tall and has no animation.
- [x] The reserve and the emergency fund are shown as fixed beside it.
- [x] The webhook takes a valid split from `client_reference_id`, falls back to the dropdown or the default for an invalid one, and credits old dropdown sessions as before.
- [x] Malformed, hostile and oversized references (over 200 characters) credit no card and change no split.
- [x] The site holds no Stripe secret and creates no Checkout Session; no Stripe API call was made in building this.
- [ ] The board removes the dropdown from the Payment Link once this is live (Production steps).

## Verification

- `deno test --config platform/supabase/functions/deno.json --allow-read --allow-env platform/supabase/functions/_shared/split_test.ts platform/supabase/functions/_shared/session_test.ts platform/supabase/functions/_shared/handler_test.ts`
- `npx vitest run src/pages/Contribute.test.tsx src/lib/payment.test.ts` in `platform/site`
- `E2E_PORT=4420 npx playwright test e2e/money.spec.ts e2e/landing.spec.ts` in `platform/site`
- `pnpm verify`
- After deploy: `node platform/site/scripts/live-check.mjs`, first line `PASS ... failed=0`, which checks /contribute's links carry `split20`.
- After the board removes the dropdown: one test-mode or real payment through /contribute at a non-default split credits that split on /ledger.

## Production steps (need the board's allow)

1. Deploy the `stripe-webhook` function with this change before the site deploys, so no slider reference reaches a webhook that ignores its split: `npx supabase functions deploy stripe-webhook --project-ref lyxndueoeisyqzewflpu --use-api` from `platform/`.
2. Merge, so the site deploys and the live check runs.
3. In the Stripe dashboard, remove the `split` dropdown from the Payment Link. Until then a supporter who moves the slider still sees the dropdown at checkout, and the slider's choice wins.
4. Decide whether home's Fund this card buttons should open /contribute with that card instead, since once the dropdown is gone they credit the default 80/20.
5. The Terms say the split is chosen "at checkout"; a Terms version that says it is chosen before checkout is the board's call.

No migration: `apply_contribution` already takes the studio percent.

## Evidence

Added when the status moves to built or done.

## Decisions

- 2026-10-11: the slider's value is the agents' percent, so it reads left to right as Agents then Studio. The board asked for Agents/Studio.
- 2026-10-11: a valid split on the reference wins over the dropdown while both exist. The slider is the newer choice and the dropdown is coming off.
- 2026-10-11: an invalid split on the reference falls back, never clamps or refuses, so a hand-edited link still credits its card at a split the rules allow.
