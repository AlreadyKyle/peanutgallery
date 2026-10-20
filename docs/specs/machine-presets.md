# Machine card presets

Status: agreed. Card: none. Owner: studio.

## Problem

The Machine card on home and /contribute offers $5, $10, $25, $50 and $100. Picking one changed the button to "Fund $10", but the link was the bare Payment Link, so checkout opened on the link's own $5 preset and the page asked the reader to "enter $10 there". The button said one amount and checkout showed another.

## Scope

In: the Machine card's link and its note (`platform/site/src/components/MachineCard.tsx`, `copy.machine`), the link builder (`platform/site/src/lib/payment.ts` `fundLink`), and the waterfall line (`legal.waterfallLine`) under Fund this card on card pages and on the Machine card.
Out: the split, the webhook, the Payment Link's own settings (any amount from $2, $5 preset, PLAN.md §10 decision 77), the card choices' links, which carry no amount, and /contribute's split slider.

## Behaviour

Stripe's Payment Links take a `prefilled_amount` URL parameter on a pay-what-you-want link: "a positive integer in the custom price currency's smallest unit", which the customer "can still edit" before paying, and an invalid value falls back to the link's stored preset (https://docs.stripe.com/payment-links/customize, Customize checkout with URL parameters; read 20 October 2026). A load-only check of the live link (`buy.stripe.com/dRm28s4ie0zp6BU0qEafS01`) showed the amount field at $5.00 bare and at $10.00 with `prefilled_amount=1000&client_reference_id=test_split20`; nothing was entered or submitted.

The preset the reader picks is the amount checkout opens on. The link keeps every parameter it carried (the base link's own, then `client_reference_id` with the split when there is one) and adds `prefilled_amount` in cents last. An amount below the link's $2 minimum, or one that is not a finite number, is never sent, so checkout opens on the link's $5. The button keeps "Fund $10", which is now what checkout shows, and the note under it says "Checkout opens on $10, and you can change it there." The webhook credits what was paid, so the split and where the money goes do not change.

Under Fund this card on a card's page, and in the Machine card's note, the page says the line /contribute already says under its choices: "Anything beyond a card's target funds the next cards in line."

## Acceptance criteria

- [ ] `fundLink` adds `prefilled_amount` in cents after `client_reference_id`, keeps the base link's own parameters, and leaves the amount out below $2 or for a non-finite amount.
- [ ] On home and /contribute each Machine card preset sets the link's `prefilled_amount` to that amount in cents, and the button says the same amount.
- [ ] The Machine card no longer says "enter $10 there"; it says checkout opens on the amount and that it can be changed there.
- [ ] A card page with a live Fund this card says the waterfall line under it, above the agreement; a card with no live link does not.
- [ ] The Machine card's note includes the waterfall line.
- [ ] The live Payment Link opens with the amount prefilled (load only).

## Verification

- `pnpm verify:changed`
- `npx vitest run src/lib/payment.test.ts src/pages/Contribute.test.tsx src/components/Flow.test.tsx src/pages/Landing.test.tsx src/lib/copy.test.ts` in `platform/site`
- `E2E_PORT=4480 npx playwright test e2e/money.spec.ts e2e/card.spec.ts e2e/landing.spec.ts e2e/pages.spec.ts e2e/home-flow.spec.ts` in `platform/site`
- A headless load of the live Payment Link with `prefilled_amount=1000` whose amount field reads $10.00, with its screenshot.

## Evidence

Added when the status moves to built or done.

## Decisions

- 20 October 2026: prefill the amount rather than relabel the presets as suggestions. Stripe documents `prefilled_amount` for pay-what-you-want links and the live link honours it, so the button can say the amount it opens on.
