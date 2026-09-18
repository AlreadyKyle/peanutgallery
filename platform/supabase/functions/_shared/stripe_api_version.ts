// The Stripe API version pinned on both sides of the webhook: the SDK client in
// the edge function and the webhook endpoint created by
// scripts/create-webhook-endpoint.ts, so event payloads and the SDK's types
// describe the same shapes. It is the version stripe@19.3.1, pinned exactly in
// stripe-webhook/index.ts, targets; `deno check` fails at the client
// constructor if a later SDK moves on.
export const STRIPE_API_VERSION = "2025-10-29.clover" as const;
