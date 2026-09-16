// The Stripe events the webhook handles, shared by the handler and the scripts
// that create or update the live endpoint, so the two cannot drift.
export const COMPLETED_EVENT = "checkout.session.completed";
export const CHARGE_UPDATED_EVENT = "charge.updated";
export const REFUNDED_EVENT = "charge.refunded";
export const DISPUTE_CREATED_EVENT = "charge.dispute.created";
export const WEBHOOK_EVENTS = [
  COMPLETED_EVENT,
  CHARGE_UPDATED_EVENT,
  REFUNDED_EVENT,
  DISPUTE_CREATED_EVENT,
] as const;
