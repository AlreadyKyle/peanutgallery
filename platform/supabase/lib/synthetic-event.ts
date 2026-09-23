// Stripe webhook signing and the synthetic events used by
// scripts/sign-synthetic-event.ts for the dry run.

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
          // The webhook ignores this field and stores no name (docs/specs/legal-copy.md); it stays so a
          // dry run shows a session that still carries one is credited as before.
          { key: "displayname", type: "text", optional: true, text: { value: "Board dry run" } },
        ],
      },
    },
  };
}

export type ReversalEventType = "charge.refunded" | "charge.dispute.created" | "charge.dispute.funds_withdrawn";

/**
 * A charge.refunded, charge.dispute.created or charge.dispute.funds_withdrawn
 * event for a payment intent, with synthetic event, charge and dispute ids.
 * Pointed at a real payment intent, the dry run proves the live session lookup
 * without reversing anything. disputeStatus is ignored for a refund; a warning_
 * status makes charge.dispute.created an inquiry.
 */
export function syntheticReversalEvent(
  type: ReversalEventType,
  nonce: string,
  paymentIntent: string,
  amountCents: number,
  createdSeconds: number,
  disputeStatus = "needs_response",
): Record<string, unknown> {
  const object = type === "charge.refunded"
    ? {
        id: `ch_synthetic_${nonce}`,
        object: "charge",
        payment_intent: paymentIntent,
        amount: amountCents,
        amount_refunded: amountCents,
        currency: "usd",
        refunded: true,
        livemode: false,
      }
    : {
        id: `dp_synthetic_${nonce}`,
        object: "dispute",
        charge: `ch_synthetic_${nonce}`,
        payment_intent: paymentIntent,
        amount: amountCents,
        currency: "usd",
        status: disputeStatus,
        livemode: false,
      };
  return {
    id: `evt_synthetic_${nonce}`,
    object: "event",
    created: createdSeconds,
    livemode: false,
    type,
    data: { object },
  };
}
