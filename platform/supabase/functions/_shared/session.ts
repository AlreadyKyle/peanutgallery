// Turns a Stripe checkout session into the apply_contribution inputs. Pure:
// no I/O, no environment. The types below name only the fields the webhook
// reads, so a Stripe.Checkout.Session is accepted and fixtures stay small.

import {
  contributorId,
  feeToUsd,
  goalCardId,
  mapSplit,
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

/**
 * The card a charge was paid with. Stripe's fingerprint identifies the card
 * number within this Stripe account. A wallet payment (Apple Pay, Google Pay)
 * is a card payment with card.wallet set, and its fingerprint may be of the
 * device's token rather than the card itself.
 */
export interface CardDetailsLike {
  fingerprint?: string | null;
  wallet?: { type: string } | null;
}

/** Link, buy-now-pay-later and other methods without a card carry no card object. */
export interface PaymentMethodDetailsLike {
  type?: string;
  card?: CardDetailsLike | null;
  link?: { country?: string | null } | null;
}

export interface ChargeLike {
  balance_transaction: string | BalanceTransactionLike | null;
  payment_method_details?: PaymentMethodDetailsLike | null;
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
  /** When Stripe created the Checkout Session, in Unix seconds. */
  created?: number | null;
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
  /**
   * The Checkout Session's created time from Stripe, as ISO 8601, or null when it is missing or not
   * a positive whole number of seconds. apply_contribution stamps the payment with the Terms version
   * posted at or before it (docs/specs/money-logic.md); the client never supplies it.
   */
  session_created_at: string | null;
}

/** ISO 8601 from a positive whole number of Unix seconds, else null. */
export function sessionCreatedAt(created: unknown): string | null {
  if (typeof created !== "number" || !Number.isInteger(created) || created <= 0) return null;
  const at = new Date(created * 1000);
  return Number.isFinite(at.getTime()) ? at.toISOString() : null;
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
    // The studio stores no name (docs/specs/legal-copy.md; the Privacy page says so). A session
    // that still carries a displayname field is credited as any other, with no name.
    display_name: null,
    contributor_id: await contributorId({
      email: session.customer_details?.email ?? null,
      customerId: customer,
      sessionId: session.id,
    }),
    goal_card_id: goalCardId(
      session.client_reference_id,
      session.metadata?.goal_card_id,
    ),
    session_created_at: sessionCreatedAt(session.created),
  };
}

/** What the webhook reads from the charge behind a session: the fee, and the card's fingerprint when it was paid by card. */
export interface ChargeFacts {
  fee_usd: number;
  card_fingerprint: string | null;
}

/** The session's latest charge when the payment intent and the charge are both expanded; otherwise null. */
function expandedCharge(session: SessionLike): ChargeLike | null {
  const intent = session.payment_intent;
  if (!intent || typeof intent === "string") return null;
  const charge = intent.latest_charge;
  if (!charge || typeof charge === "string") return null;
  return charge;
}

/** Fee in USD from the charge's expanded balance transaction; null while any link in the chain is a bare id or missing. */
export function feeFromSession(session: SessionLike): number | null {
  const tx = expandedCharge(session)?.balance_transaction;
  if (!tx || typeof tx === "string") return null;
  return feeToUsd(tx.fee, tx.currency, tx.exchange_rate);
}

/** The card's Stripe fingerprint from the expanded charge; null for Link and other methods without a card. */
export function cardFingerprintFromSession(session: SessionLike): string | null {
  const fingerprint = expandedCharge(session)?.payment_method_details?.card?.fingerprint;
  return typeof fingerprint === "string" && fingerprint.trim() !== "" ? fingerprint.trim() : null;
}

/** The fee and the card fingerprint, from the one retrieve; null while the fee is not available. */
export function chargeFromSession(session: SessionLike): ChargeFacts | null {
  const fee = feeFromSession(session);
  if (fee === null) return null;
  return { fee_usd: fee, card_fingerprint: cardFingerprintFromSession(session) };
}
