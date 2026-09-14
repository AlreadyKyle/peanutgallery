// Stripe webhook signing and the synthetic checkout.session.completed event
// used by scripts/sign-synthetic-event.ts for the dry run.

import { createHmac } from "node:crypto";

/** The Stripe-Signature header for a payload: HMAC-SHA256 of "<timestamp>.<payload>". */
export function signPayload(payload: string, secret: string, timestampSeconds: number): string {
  const signature = createHmac("sha256", secret).update(`${timestampSeconds}.${payload}`).digest("hex");
  return `t=${timestampSeconds},v1=${signature}`;
}

/** A checkout.session.completed event carrying only the fields the function reads, with synthetic ids. */
export function syntheticEvent(nonce: string, amountCents: number, split: string, createdSeconds: number): Record<string, unknown> {
  return {
    id: `evt_synthetic_${nonce}`,
    object: "event",
    created: createdSeconds,
    livemode: false,
    type: "checkout.session.completed",
    data: {
      object: {
        id: `cs_synthetic_${nonce}`,
        object: "checkout.session",
        amount_total: amountCents,
        currency: "usd",
        payment_status: "paid",
        status: "complete",
        mode: "payment",
        livemode: false,
        client_reference_id: null,
        customer: null,
        customer_details: null,
        metadata: {},
        payment_intent: null,
        custom_fields: [
          { key: "split", type: "dropdown", optional: false, dropdown: { value: split } },
          { key: "displayname", type: "text", optional: true, text: { value: "Board dry run" } },
        ],
      },
    },
  };
}
