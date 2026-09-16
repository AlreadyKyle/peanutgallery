// Signs a synthetic Stripe event with STRIPE_WEBHOOK_SECRET and POSTs it to the
// deployed stripe-webhook function as a dry run.
//   pnpm --filter @backseat/supabase exec tsx scripts/sign-synthetic-event.ts [--url <function url>] [--split 8020] [--amount-cents 100]
//   pnpm --filter @backseat/supabase exec tsx scripts/sign-synthetic-event.ts --event charge.refunded --payment-intent pi_... [--amount-cents 100]
//   pnpm --filter @backseat/supabase exec tsx scripts/sign-synthetic-event.ts --event charge.dispute.created --payment-intent pi_... [--status warning_needs_response]
//   pnpm --filter @backseat/supabase exec tsx scripts/sign-synthetic-event.ts --wrong-bearer
// For checkout.session.completed the function verifies the signature, parses
// the session, tries the fee lookup (which fails for a synthetic session id)
// and never calls the RPC. For charge.refunded, charge.dispute.created or
// charge.dispute.funds_withdrawn it verifies, looks the Checkout session up for
// the payment intent and returns the reversal it would make, without calling
// the RPC. A dispute inquiry (--status warning_...) is acknowledged as ignored.
//
// --wrong-bearer sends x-dry-run: 1 with a bearer that is not the service key
// and exits 0 only when the function answers 401. It proves the deployed
// function refuses the request. Run it only against a function that has the
// dry-run gate (docs/specs/webhook-hardening.md): an older one treats it as a
// live request, which is why it is limited to the synthetic completed event.

import { functionUrl, loadRepoEnv } from "../lib/client.js";
import { requireEnv } from "../lib/env.js";
import { type ReversalEventType, signPayload, syntheticEvent, syntheticReversalEvent } from "../lib/synthetic-event.js";

const EVENTS = [
  "checkout.session.completed",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.funds_withdrawn",
] as const;
type EventType = (typeof EVENTS)[number];

const WRONG_BEARER = "not-the-service-key";

interface Options {
  url: string | undefined;
  split: string;
  amountCents: number;
  event: EventType;
  paymentIntent: string | undefined;
  status: string | undefined;
  wrongBearer: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    url: undefined,
    split: "8020",
    amountCents: 100,
    event: "checkout.session.completed",
    paymentIntent: undefined,
    status: undefined,
    wrongBearer: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === "--wrong-bearer") {
      options.wrongBearer = true;
      continue;
    }
    const value = argv[++i];
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
    else if (key === "--status") options.status = value;
    else throw new Error(`Unknown argument ${key}`);
  }
  if (options.wrongBearer && options.event !== "checkout.session.completed") {
    throw new Error("--wrong-bearer runs only with the default checkout.session.completed event");
  }
  if (options.event !== "checkout.session.completed" && !options.paymentIntent) {
    throw new Error(`--event ${options.event} needs --payment-intent pi_...`);
  }
  if (options.status !== undefined && !options.event.startsWith("charge.dispute.")) {
    throw new Error("--status applies only to charge.dispute.created and charge.dispute.funds_withdrawn");
  }
  return options;
}

function serviceKeyFrom(env: Record<string, string | undefined>): string {
  const key = env.SUPABASE_SECRET_KEY?.trim();
  if (!key) {
    // The function runtime supplies SUPABASE_SERVICE_ROLE_KEY in the sb_secret_ format. The legacy
    // service-role JWT does not match it, and the function refuses a dry run with it (401).
    throw new Error(
      "SUPABASE_SECRET_KEY is not set in .env. A dry run must present the project's sb_secret_ key; the legacy SUPABASE_SERVICE_ROLE_KEY is refused",
    );
  }
  return key;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const env = loadRepoEnv();
  const secret = requireEnv(env, "STRIPE_WEBHOOK_SECRET");
  const bearer = options.wrongBearer ? WRONG_BEARER : serviceKeyFrom(env);
  const url = options.url ?? functionUrl(env, "stripe-webhook");

  const now = Math.floor(Date.now() / 1000);
  const nonce = now.toString(16);
  const event = options.event === "checkout.session.completed"
    ? syntheticEvent(nonce, options.amountCents, options.split, now)
    : syntheticReversalEvent(
        options.event as ReversalEventType,
        nonce,
        options.paymentIntent!,
        options.amountCents,
        now,
        options.status,
      );
  const payload = JSON.stringify(event);
  const signature = signPayload(payload, secret, now);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": signature,
      authorization: `Bearer ${bearer}`,
      "x-dry-run": "1",
    },
    body: payload,
  });
  const text = await res.text();
  console.log(`POST ${url}${options.wrongBearer ? " (wrong bearer)" : ""}`);
  console.log(
    options.event === "checkout.session.completed"
      ? `event evt_synthetic_${nonce} ${options.event}, split ${options.split}, amount_total ${options.amountCents}`
      : `event evt_synthetic_${nonce} ${options.event}, payment_intent ${options.paymentIntent}, amount ${options.amountCents}${
          options.status ? `, status ${options.status}` : ""
        }`,
  );
  console.log(`status ${res.status}`);
  console.log(text);
  if (options.wrongBearer) {
    console.log(res.status === 401 ? "refused as expected" : "expected 401: the function did not refuse a wrong bearer");
    process.exit(res.status === 401 ? 0 : 1);
  }
  if (res.status === 401) {
    console.log("hint: 401 means the bearer is not the function's service key; set SUPABASE_SECRET_KEY to the sb_secret_ key");
  }
  process.exit(res.status === 200 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(`sign-synthetic-event failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
