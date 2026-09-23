// Stripe webhook: checkout.session.completed or charge.updated → apply_contribution RPC;
// charge.refunded, charge.dispute.created (not an inquiry) or
// charge.dispute.funds_withdrawn → reverse_contribution RPC.
// Deployed with verify_jwt = false (config.toml); the Stripe signature is the
// authentication. The request handling lives in ../_shared/handler.ts with
// these functions injected. A dry run (x-dry-run: 1 with SUPABASE_SERVICE_ROLE_KEY
// as the bearer) verifies, parses and looks the session up but never calls an
// RPC; x-dry-run with any other bearer answers 401 and runs nothing.
// NTFY_TOPIC_URL is optional: unset, alerts are not posted anywhere.

import Stripe from "npm:stripe@19.3.1";
import type { Amounts } from "../_shared/split.ts";
import { type ChargeFacts, chargeFromSession, type Parsed } from "../_shared/session.ts";
import {
  applyContributionArgs,
  type CheckoutSession,
  createHandler,
  type ReversalInput,
  reverseContributionArgs,
} from "../_shared/handler.ts";
import { STRIPE_API_VERSION } from "../_shared/stripe_api_version.ts";

const STRIPE_SECRET_KEY = requireEnv("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = requireEnv("STRIPE_WEBHOOK_SECRET");
const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const NTFY_TOPIC_URL = Deno.env.get("NTFY_TOPIC_URL") ?? "";
const SIGNATURE_TOLERANCE_SECONDS = 300;
const NOTIFY_TIMEOUT_MS = 3000;

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: STRIPE_API_VERSION,
  httpClient: Stripe.createFetchHttpClient(),
});
const cryptoProvider = Stripe.createSubtleCryptoProvider();

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function constructEvent(
  body: string,
  signature: string,
): Promise<Stripe.Event> {
  return stripe.webhooks.constructEventAsync(
    body,
    signature,
    STRIPE_WEBHOOK_SECRET,
    SIGNATURE_TOLERANCE_SECONDS,
    cryptoProvider,
  );
}

// One retrieve gives both the fee (the charge's balance transaction) and the
// card fingerprint (the same charge's payment_method_details.card).
async function lookupCharge(sessionId: string): Promise<ChargeFacts | null> {
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["payment_intent.latest_charge.balance_transaction"],
  });
  return chargeFromSession(session);
}

async function findSession(
  paymentIntentId: string,
): Promise<CheckoutSession | null> {
  const sessions = await stripe.checkout.sessions.list({
    payment_intent: paymentIntentId,
    limit: 1,
  });
  return (sessions.data[0] as CheckoutSession | undefined) ?? null;
}

async function rpc(
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${name} returned ${res.status}: ${text}`);
  }
  return JSON.parse(text) as Record<string, unknown>;
}

function reverseContribution(
  input: ReversalInput,
): Promise<Record<string, unknown>> {
  return rpc("reverse_contribution", reverseContributionArgs(input));
}

async function notify(message: string): Promise<void> {
  if (!NTFY_TOPIC_URL.startsWith("https://")) return;
  const res = await fetch(NTFY_TOPIC_URL, {
    method: "POST",
    headers: { Title: "Peanut Gallery payments" },
    body: message,
    signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
  });
  await res.body?.cancel();
}

function applyContribution(
  parsed: Parsed,
  amounts: Amounts,
  payerKey: string,
): Promise<Record<string, unknown>> {
  return rpc("apply_contribution", applyContributionArgs(parsed, amounts, payerKey));
}

Deno.serve(createHandler({
  constructEvent,
  lookupCharge,
  findSession,
  applyContribution,
  reverseContribution,
  notify,
  serviceKey: SUPABASE_SERVICE_ROLE_KEY,
}));
