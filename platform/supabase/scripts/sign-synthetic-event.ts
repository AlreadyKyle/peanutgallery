// Signs a synthetic Stripe event with STRIPE_WEBHOOK_SECRET and POSTs it to the
// deployed stripe-webhook function as a dry run.
//   pnpm --filter @backseat/supabase exec tsx scripts/sign-synthetic-event.ts [--url <function url>] [--split 8020] [--amount-cents 100]
//   pnpm --filter @backseat/supabase exec tsx scripts/sign-synthetic-event.ts --event charge.refunded --payment-intent pi_... [--amount-cents 100]
// For checkout.session.completed the function verifies the signature, parses
// the session, tries the fee lookup (which fails for a synthetic session id)
// and never calls the RPC. For charge.refunded or charge.dispute.created it
// verifies, looks the Checkout session up for the payment intent and returns
// the reversal it would make, without calling the RPC.

import { functionUrl, loadRepoEnv } from "../lib/client.js";
import { requireEnv } from "../lib/env.js";
import { signPayload, syntheticEvent, syntheticReversalEvent } from "../lib/synthetic-event.js";

const EVENTS = ["checkout.session.completed", "charge.refunded", "charge.dispute.created"] as const;
type EventType = (typeof EVENTS)[number];

interface Options {
  url: string | undefined;
  split: string;
  amountCents: number;
  event: EventType;
  paymentIntent: string | undefined;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    url: undefined,
    split: "8020",
    amountCents: 100,
    event: "checkout.session.completed",
    paymentIntent: undefined,
  };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`${key} needs a value`);
    if (key === "--url") options.url = value;
    else if (key === "--split") options.split = value;
    else if (key === "--amount-cents") {
      options.amountCents = Number(value);
      if (!Number.isInteger(options.amountCents) || options.amountCents <= 0) {
        throw new Error("--amount-cents must be a positive integer");
      }
    } else if (key === "--event") {
      if (!(EVENTS as readonly string[]).includes(value)) {
        throw new Error(`--event must be one of ${EVENTS.join(", ")}`);
      }
      options.event = value as EventType;
    } else if (key === "--payment-intent") options.paymentIntent = value;
    else throw new Error(`Unknown argument ${key}`);
  }
  if (options.event !== "checkout.session.completed" && !options.paymentIntent) {
    throw new Error(`--event ${options.event} needs --payment-intent pi_...`);
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const env = loadRepoEnv();
  const secret = requireEnv(env, "STRIPE_WEBHOOK_SECRET");
  // The function runtime supplies SUPABASE_SERVICE_ROLE_KEY in the new sb_secret_ format, so a dry
  // run must present that key; the legacy service-role JWT is treated as a live request.
  const serviceKey = env.SUPABASE_SECRET_KEY?.trim() || requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY");
  const url = options.url ?? functionUrl(env, "stripe-webhook");

  const now = Math.floor(Date.now() / 1000);
  const nonce = now.toString(16);
  const event = options.event === "checkout.session.completed"
    ? syntheticEvent(nonce, options.amountCents, options.split, now)
    : syntheticReversalEvent(options.event, nonce, options.paymentIntent!, options.amountCents, now);
  const payload = JSON.stringify(event);
  const signature = signPayload(payload, secret, now);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": signature,
      authorization: `Bearer ${serviceKey}`,
      "x-dry-run": "1",
    },
    body: payload,
  });
  const text = await res.text();
  console.log(`POST ${url}`);
  console.log(
    options.event === "checkout.session.completed"
      ? `event evt_synthetic_${nonce} ${options.event}, split ${options.split}, amount_total ${options.amountCents}`
      : `event evt_synthetic_${nonce} ${options.event}, payment_intent ${options.paymentIntent}, amount ${options.amountCents}`,
  );
  console.log(`status ${res.status}`);
  console.log(text);
  process.exit(res.status === 200 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(`sign-synthetic-event failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
