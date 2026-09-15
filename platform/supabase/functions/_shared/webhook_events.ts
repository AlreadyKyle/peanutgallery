// The Stripe events the webhook handles, shared by the handler and the scripts
// that create or update the live endpoint, so the two cannot drift.
export const COMPLETED_EVENT = "checkout.session.completed";
export const CHARGE_UPDATED_EVENT = "charge.updated";
export const WEBHOOK_EVENTS = [COMPLETED_EVENT, CHARGE_UPDATED_EVENT] as const;
