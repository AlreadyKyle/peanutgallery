// Signs a synthetic checkout.session.completed event with STRIPE_WEBHOOK_SECRET
// and POSTs it to the deployed stripe-webhook function as a dry run.
//   pnpm --filter @backseat/supabase exec tsx scripts/sign-synthetic-event.ts [--url <function url>] [--split 8020] [--amount-cents 100]
// The function verifies the signature, parses the session, tries the fee
// lookup (which fails for a synthetic session id) and never calls the RPC.

import { functionUrl, loadRepoEnv } from "../lib/client.js";
import { requireEnv } from "../lib/env.js";
import { signPayload, syntheticEvent } from "../lib/synthetic-event.js";

interface Options {
  url: string | undefined;
  split: string;
  amountCents: number;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { url: undefined, split: "8020", amountCents: 100 };
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
    } else throw new Error(`Unknown argument ${key}`);
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
  const payload = JSON.stringify(syntheticEvent(nonce, options.amountCents, options.split, now));
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
  console.log(`event evt_synthetic_${nonce}, split ${options.split}, amount_total ${options.amountCents}`);
  console.log(`status ${res.status}`);
  console.log(text);
  process.exit(res.status === 200 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(`sign-synthetic-event failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
