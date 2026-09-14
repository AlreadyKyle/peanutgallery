// Creates the Stripe webhook endpoint for checkout.session.completed.
//   pnpm --filter @backseat/supabase exec tsx scripts/create-webhook-endpoint.ts --url <function url>
// Prints the endpoint id and, once, the signing secret. Writes nothing to disk.
// This creates a live Stripe resource; run it only with the board's yes.

import { loadRepoEnv } from "../lib/client.js";
import { requireEnv } from "../lib/env.js";
import { STRIPE_API_VERSION } from "../functions/_shared/stripe_api_version.ts";

function parseArgs(argv: string[]): { url: string } {
  let url: string | undefined;
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--url" && value) url = value;
    else throw new Error(`Unknown argument ${key}`);
  }
  if (!url || !/^https:\/\//.test(url)) {
    throw new Error("--url <https function url> is required");
  }
  return { url };
}

interface WebhookEndpoint {
  id: string;
  url: string;
  status: string;
  enabled_events: string[];
  secret?: string;
}

async function main(): Promise<void> {
  const { url } = parseArgs(process.argv.slice(2));
  const env = loadRepoEnv();
  const key = requireEnv(env, "STRIPE_SECRET_KEY");

  const form = new URLSearchParams();
  form.set("url", url);
  form.append("enabled_events[]", "checkout.session.completed");
  form.set("description", "Backseat contributions");
  form.set("api_version", STRIPE_API_VERSION);

  const res = await fetch("https://api.stripe.com/v1/webhook_endpoints", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  const body = (await res.json()) as WebhookEndpoint | { error: { message: string } };
  if (!res.ok || "error" in body) {
    const message = "error" in body ? body.error.message : `status ${res.status}`;
    throw new Error(`Stripe refused the endpoint: ${message}`);
  }

  console.log(`endpoint id: ${body.id}`);
  console.log(`url: ${body.url}`);
  console.log(`status: ${body.status}`);
  console.log(`events: ${body.enabled_events.join(", ")}`);
  console.log("The signing secret below is shown once and is not stored anywhere. Set it as STRIPE_WEBHOOK_SECRET in .env and as the function secret, then clear this terminal.");
  console.log(`signing secret: ${body.secret ?? "(not returned)"}`);
}

main().catch((err: unknown) => {
  console.error(`create-webhook-endpoint failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
