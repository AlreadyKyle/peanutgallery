// Turns a Stripe checkout session into the apply_contribution inputs. Pure:
// no I/O, no environment. The types below name only the fields the webhook
// reads, so a Stripe.Checkout.Session is accepted and fixtures stay small.

import {
  contributorId,
  feeToUsd,
  goalCardId,
  mapSplit,
  sanitizeDisplayName,
} from "./split.ts";

export interface CustomField {
  key: string;
  type: string;
  dropdown?: { value: string | null } | null;
  text?: { value: string | null } | null;
  numeric?: { value: string | null } | null;
}

export interface BalanceTransactionLike {
  fee: number;
  currency: string;
  exchange_rate: number | null;
}

export interface ChargeLike {
  balance_transaction: string | BalanceTransactionLike | null;
}

export interface PaymentIntentLike {
  latest_charge: string | ChargeLike | null;
}

export interface SessionLike {
  id: string;
  amount_total: number | null;
  currency: string | null;
  customer: string | { id: string } | null;
  customer_details: { email: string | null } | null;
  client_reference_id: string | null;
  metadata: Record<string, string> | null;
  custom_fields: CustomField[];
  payment_intent: string | PaymentIntentLike | null;
}

export interface Parsed {
  event_id: string;
  session_id: string;
  amount_total: number;
  currency: string;
  studio_pct: number;
  display_name: string | null;
  contributor_id: string;
  goal_card_id: string | null;
}

export function customFieldValue(
  session: SessionLike,
  key: string,
): string | null {
  const field = session.custom_fields.find((f) => f.key === key);
  if (!field) return null;
  if (field.type === "dropdown") return field.dropdown?.value ?? null;
  if (field.type === "text") return field.text?.value ?? null;
  if (field.type === "numeric") return field.numeric?.value ?? null;
  return null;
}

export async function parseSession(
  eventId: string,
  session: SessionLike,
): Promise<Parsed> {
  if (session.amount_total === null) {
    throw new Error("Checkout session has no amount_total");
  }
  const currency = (session.currency ?? "").toLowerCase();
  if (currency !== "usd") {
    throw new Error(
      `Checkout session currency is ${currency || "missing"}, expected usd`,
    );
  }
  const customer = typeof session.customer === "string"
    ? session.customer
    : session.customer?.id ?? null;
  return {
    event_id: eventId,
    session_id: session.id,
    amount_total: session.amount_total,
    currency,
    studio_pct: mapSplit(customFieldValue(session, "split")),
    display_name: sanitizeDisplayName(customFieldValue(session, "displayname")),
    contributor_id: await contributorId({
      email: session.customer_details?.email ?? null,
      customerId: customer,
      sessionId: session.id,
    }),
    goal_card_id: goalCardId(
      session.client_reference_id,
      session.metadata?.goal_card_id,
    ),
  };
}

/** Fee in USD from the charge's expanded balance transaction; null while any link in the chain is a bare id or missing. */
export function feeFromSession(session: SessionLike): number | null {
  const intent = session.payment_intent;
  if (!intent || typeof intent === "string") return null;
  const charge = intent.latest_charge;
  if (!charge || typeof charge === "string") return null;
  const tx = charge.balance_transaction;
  if (!tx || typeof tx === "string") return null;
  return feeToUsd(tx.fee, tx.currency, tx.exchange_rate);
}
